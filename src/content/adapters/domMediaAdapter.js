import { applySnapshotStrategy, readMediaSessionSnapshot } from "@/content/adapters/mediaSession";
import {
  SOURCE_MIN_DURATION_SEC_DISABLED,
  normalizeSourceMinDurationSec,
} from "@/shared/webMediaSettings";

const CONTROL_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "seek",
  "volume",
  "mute",
  "unmute",
  "muteToggle",
  "next",
  "previous",
];
const STRICT_METADATA_RECOVERY_WINDOW_MS = 1000;
const EMBED_FRAME_MIN_MEDIA_WIDTH = 360;
const EMBED_FRAME_MIN_MEDIA_HEIGHT = 200;
const EMBED_FRAME_MIN_MEDIA_ASPECT = 1.1;
const EMBED_FRAME_MAX_MEDIA_ASPECT = 2.4;
const TOP_FRAME_ANONYMOUS_VIDEO_MAX_MEDIA_COUNT = 4;
const PLAYBACK_CONTEXT_URL_HINTS = [
  "/watch",
  "/video",
  "/view_video.php",
  "/embed",
  "/player",
  "/stream",
  "/movie/",
  "viewkey=",
  "autoplay=1",
];

function normalizeControlCapabilities(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const capabilities = {};
  for (const action of CONTROL_ACTIONS) {
    capabilities[action] = source[action] === true;
  }
  return capabilities;
}

function unsupportedResult(action, reason = "capability-missing") {
  return {
    ok: false,
    reason: "unsupported",
    unsupportedReason: reason,
    path: "unsupported",
    message: `unsupported action ${action}`,
  };
}

function mediaTagName(node) {
  return String(node?.tagName || "")
    .toLowerCase()
    .trim();
}

function absoluteUrl(rawHref, win = null) {
  const href = String(rawHref || "").trim();
  if (!href) return "";
  const windowRef = win || globalThis?.window || { location: { href: "https://example.invalid/" } };
  try {
    return new URL(href, String(windowRef?.location?.href || "https://example.invalid/")).toString();
  } catch (_) {
    return "";
  }
}

function isTinyTransparentDataCover(rawUrl) {
  const url = String(rawUrl || "").trim().toLowerCase();
  if (!url.startsWith("data:image/")) return false;
  return (
    url.includes("r0lgodlhaqabaiaaaaaaap///") ||
    url.includes("1x1") ||
    url.length < 140
  );
}

function isLikelyPageCoverUrl(rawUrl, win = null) {
  const absolute = absoluteUrl(rawUrl, win);
  if (!absolute) return false;

  let parsed = null;
  try {
    parsed = new URL(absolute);
  } catch (_) {
    return false;
  }

  const pathname = String(parsed.pathname || "").toLowerCase();
  if (pathname.includes("/view_video.php") || pathname.includes("/watch")) return true;
  if (/\.(php|html|htm|asp|aspx|jsp)$/i.test(pathname)) return true;
  if (parsed.searchParams.has("viewkey") || parsed.searchParams.has("watch")) return true;
  return false;
}

function normalizeMediaCoverUrl(rawUrl, win = null) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (isTinyTransparentDataCover(url)) return "";
  if (isLikelyPageCoverUrl(url, win)) return "";
  return url;
}

function mediaAreaScore(node) {
  if (!node) return 0;

  const rect = node.getBoundingClientRect?.();
  const rectWidth = finiteNumber(rect?.width);
  const rectHeight = finiteNumber(rect?.height);
  if (Number.isFinite(rectWidth) && Number.isFinite(rectHeight) && rectWidth > 0 && rectHeight > 0) {
    return rectWidth * rectHeight;
  }

  const clientWidth = finiteNumber(node?.clientWidth);
  const clientHeight = finiteNumber(node?.clientHeight);
  if (Number.isFinite(clientWidth) && Number.isFinite(clientHeight) && clientWidth > 0 && clientHeight > 0) {
    return clientWidth * clientHeight;
  }

  const videoWidth = finiteNumber(node?.videoWidth || node?.width);
  const videoHeight = finiteNumber(node?.videoHeight || node?.height);
  if (Number.isFinite(videoWidth) && Number.isFinite(videoHeight) && videoWidth > 0 && videoHeight > 0) {
    return videoWidth * videoHeight;
  }

  return 0;
}

function mediaDimensions(node) {
  if (!node) return { width: 0, height: 0 };

  const rect = node.getBoundingClientRect?.();
  const rectWidth = finiteNumber(rect?.width);
  const rectHeight = finiteNumber(rect?.height);
  if (Number.isFinite(rectWidth) && Number.isFinite(rectHeight) && rectWidth > 0 && rectHeight > 0) {
    return { width: rectWidth, height: rectHeight };
  }

  const clientWidth = finiteNumber(node?.clientWidth);
  const clientHeight = finiteNumber(node?.clientHeight);
  if (Number.isFinite(clientWidth) && Number.isFinite(clientHeight) && clientWidth > 0 && clientHeight > 0) {
    return { width: clientWidth, height: clientHeight };
  }

  const videoWidth = finiteNumber(node?.videoWidth || node?.width);
  const videoHeight = finiteNumber(node?.videoHeight || node?.height);
  if (Number.isFinite(videoWidth) && Number.isFinite(videoHeight) && videoWidth > 0 && videoHeight > 0) {
    return { width: videoWidth, height: videoHeight };
  }

  return { width: 0, height: 0 };
}

function pickLargestVideo(mediaList) {
  const videos = mediaList
    .map((node, index) => ({ node, index, tag: mediaTagName(node) }))
    .filter((item) => item.tag === "video");
  if (!videos.length) return null;

  const scored = videos.map((item) => ({
    ...item,
    area: mediaAreaScore(item.node),
  }));
  scored.sort((a, b) => b.area - a.area || a.index - b.index);

  const biggest = scored[0] || null;
  if (!biggest) return null;
  if (biggest.area > 0) return biggest.node;

  return (
    videos.find((item) => item.node && item.node.paused === false && item.node.ended !== true)?.node || videos[0].node
  );
}

function pickPrimaryMedia(provider, doc = document, preferredMedia = null) {
  const list = [...doc.querySelectorAll("audio,video")];
  if (!list.length) return null;

  if (preferredMedia && list.includes(preferredMedia) && preferredMedia.isConnected !== false) {
    const hasAlternativeNonEnded = list.some((node) => node !== preferredMedia && node?.ended !== true);
    if (!(preferredMedia.ended && hasAlternativeNonEnded)) return preferredMedia;
  }

  if (String(provider?.primaryMediaStrategy || "").trim() === "largest-video") {
    const largestVideo = pickLargestVideo(list);
    if (largestVideo) return largestVideo;
  }

  return list.find((node) => !node.paused && !node.ended) || list[0];
}

function inferMediaSnapshot(context, provider, resolvedMedia = null) {
  const doc = context?.document || document;
  const media = resolvedMedia || pickPrimaryMedia(provider, doc);
  if (!media) {
    return {
      durationSec: 0,
      positionSec: 0,
      playbackState: "idle",
      volume: 1,
      title: "",
      artist: "",
      coverUrl: "",
    };
  }

  let playbackState = "paused";
  if (media.ended) playbackState = "ended";
  else if (!media.paused) playbackState = "playing";

  return {
    durationSec: Number.isFinite(media.duration) ? media.duration : 0,
    positionSec: Number.isFinite(media.currentTime) ? media.currentTime : 0,
    playbackState,
    volume: Number.isFinite(media.volume) ? media.volume : 1,
    muted: Boolean(media.muted),
    coverUrl: normalizeMediaCoverUrl(media.poster || "", context?.window),
    title: "",
    artist: "",
  };
}

function isElementVisible(node) {
  if (!node || typeof node.getClientRects !== "function") return false;
  if (node.getClientRects().length === 0) return false;

  const style = window.getComputedStyle(node);
  if (!style) return true;
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function isElementDisabled(node) {
  if (!node) return true;
  if ("disabled" in node && node.disabled) return true;
  const ariaDisabled = String(node.getAttribute?.("aria-disabled") || "")
    .toLowerCase()
    .trim();
  return ariaDisabled === "true";
}

function clickSelector(selector, root = document) {
  if (!selector) return false;
  const nodes = [...root.querySelectorAll(selector)];
  if (!nodes.length) return false;

  const enabled = nodes.filter((node) => !isElementDisabled(node));
  const visibleEnabled = enabled.filter((node) => isElementVisible(node));
  const target = visibleEnabled[0] || enabled[0] || nodes[0];

  if (!target) return false;
  target.click();
  return true;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function hasPlaybackProgressEvidence(snapshot) {
  const position = finiteNumber(snapshot?.positionSec);
  if (Number.isFinite(position) && position > 0.25) return true;

  const progress = finiteNumber(snapshot?.progress);
  if (Number.isFinite(progress) && progress > 0.1) return true;

  return false;
}

function hasPlaybackStartEvidence(snapshot) {
  const state = String(snapshot?.playbackState || "").toLowerCase().trim();
  if (state === "playing" || state === "ended") return true;
  return hasPlaybackProgressEvidence(snapshot);
}

function normalizeSeekLabel(node) {
  return String(
    node?.getAttribute?.("aria-valuetext") ||
      node?.getAttribute?.("aria-label") ||
      node?.getAttribute?.("title") ||
      node?.textContent ||
      ""
  )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseClockTokenToSec(raw) {
  const token = String(raw || "").trim();
  if (!token) return Number.NaN;
  const parts = token.split(":").map((chunk) => Number(chunk));
  if (parts.some((chunk) => !Number.isFinite(chunk) || chunk < 0)) return Number.NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

function durationFromAriaValueText(node) {
  const raw = String(node?.getAttribute?.("aria-valuetext") || "");
  if (!raw) return Number.NaN;
  const tokens = raw.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
  if (tokens.length < 2) return Number.NaN;
  return parseClockTokenToSec(tokens[tokens.length - 1]);
}

function seekScale(node, max) {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const durationSec = durationFromAriaValueText(node);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const ratio = max / durationSec;
    if (ratio > 900 && ratio < 1100) return 1000;
  }
  if (max > 20000) return 1000;
  return 1;
}

function hasPlaybackContextUrlHint(locationRef) {
  const pathname = String(locationRef?.pathname || "").toLowerCase();
  const search = String(locationRef?.search || "").toLowerCase();
  return PLAYBACK_CONTEXT_URL_HINTS.some((token) => pathname.includes(token) || search.includes(token));
}

function mediaNodeCount(doc = document) {
  try {
    const list = doc?.querySelectorAll?.("audio,video");
    return Number(list?.length) || 0;
  } catch (_) {
    return 0;
  }
}

function isAnonymousPlaybackLikelyPrimary({
  snapshot,
  primaryMedia,
  primaryMediaDims,
  isEmbeddedFrame = false,
  mediaCount = 0,
  locationRef = null,
  minDurationSec = SOURCE_MIN_DURATION_SEC_DISABLED,
} = {}) {
  if (hasPlaybackProgressEvidence(snapshot)) return true;

  const normalizedMinDurationSec = normalizeSourceMinDurationSec(
    minDurationSec,
    SOURCE_MIN_DURATION_SEC_DISABLED
  );
  const durationSec = finiteNumber(snapshot?.durationSec);
  const hasFiniteDuration = Number.isFinite(durationSec);
  if (hasFiniteDuration && durationSec < normalizedMinDurationSec) return false;
  if (hasFiniteDuration && durationSec >= normalizedMinDurationSec) return true;

  const tag = mediaTagName(primaryMedia);
  const width = Number(primaryMediaDims?.width) || 0;
  const height = Number(primaryMediaDims?.height) || 0;
  const aspect = height > 0 ? width / height : 0;
  const hasVideoLikeGeometry =
    width >= EMBED_FRAME_MIN_MEDIA_WIDTH &&
    height >= EMBED_FRAME_MIN_MEDIA_HEIGHT &&
    aspect >= EMBED_FRAME_MIN_MEDIA_ASPECT &&
    aspect <= EMBED_FRAME_MAX_MEDIA_ASPECT;
  const hasUrlHint = hasPlaybackContextUrlHint(locationRef);

  if (tag === "audio") {
    return mediaCount <= 3 || hasUrlHint;
  }

  if (tag === "video") {
    if (!hasVideoLikeGeometry) return false;
    if (isEmbeddedFrame) return true;
    if (mediaCount <= TOP_FRAME_ANONYMOUS_VIDEO_MAX_MEDIA_COUNT) return true;
    return hasUrlHint;
  }

  return false;
}

function isLikelyTimeSeekNode(node) {
  if (!node) return false;
  const label = normalizeSeekLabel(node);
  const signals = `${label} ${String(node?.getAttribute?.("data-testid") || "")} ${String(node?.className || "")}`
    .toLowerCase()
    .trim();
  if (signals.includes("громк") || signals.includes("volume") || signals.includes("звук")) return false;

  const max = finiteNumber(node.getAttribute?.("aria-valuemax") ?? node.max);
  if (Number.isFinite(max) && max <= 1.5) return false;

  if (/\d{1,2}:\d{2}(?::\d{2})?/.test(label)) return true;
  if (Number.isFinite(max) && max > 100) return true;

  return false;
}

function findSeekTarget(provider, doc = document) {
  const roots = findControlRoots(provider, doc);
  const selector = '[role="slider"], input[type="range"], [role="progressbar"]';

  let fallback = null;
  for (const root of roots) {
    const nodes = [...root.querySelectorAll(selector)];
    for (const node of nodes) {
      if (!fallback) fallback = node;
      if (isLikelyTimeSeekNode(node)) return node;
    }
  }

  return fallback;
}

function dispatchSeekClick(node, ratio) {
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;

  const safeRatio = Math.max(0, Math.min(1, ratio));
  const clientX = rect.left + rect.width * safeRatio;
  const clientY = rect.top + rect.height / 2;
  const mouseInit = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

  if (typeof PointerEvent !== "undefined") {
    node.dispatchEvent(
      new PointerEvent("pointerdown", { ...mouseInit, pointerType: "mouse", isPrimary: true })
    );
  }
  node.dispatchEvent(new MouseEvent("mousedown", mouseInit));
  node.dispatchEvent(new MouseEvent("click", mouseInit));
  node.dispatchEvent(new MouseEvent("mouseup", mouseInit));
  if (typeof PointerEvent !== "undefined") {
    node.dispatchEvent(new PointerEvent("pointerup", { ...mouseInit, pointerType: "mouse", isPrimary: true }));
  }

  return true;
}

function seekViaDomTarget(provider, targetSec, doc = document) {
  const node = findSeekTarget(provider, doc);
  if (!node) return false;

  const min = finiteNumber(node.getAttribute?.("aria-valuemin") ?? node.min);
  const max = finiteNumber(node.getAttribute?.("aria-valuemax") ?? node.max);
  const hasRange = Number.isFinite(max) && max > 0;
  const lower = Number.isFinite(min) ? min : 0;
  const unit = hasRange ? seekScale(node, max) : 1;
  const target = Number(targetSec) * unit;
  const nextValue = hasRange ? Math.max(lower, Math.min(max, target)) : target;

  if (node instanceof HTMLInputElement && node.type === "range") {
    node.value = String(nextValue);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    if (hasRange) {
      const ratio = (nextValue - lower) / Math.max(1, max - lower);
      dispatchSeekClick(node, ratio);
    }
    return true;
  }

  if (hasRange) {
    const ratio = (nextValue - lower) / Math.max(1, max - lower);
    if (dispatchSeekClick(node, ratio)) return true;
  }

  return false;
}

function normalizeNodeSignals(node) {
  const label = normalizeSeekLabel(node);
  const className = String(node?.className || "").toLowerCase();
  const id = String(node?.id || "").toLowerCase();
  return `${label} ${className} ${id}`.trim();
}

function nodeRange(node) {
  const minRaw = finiteNumber(node?.getAttribute?.("aria-valuemin") ?? node?.min);
  const maxRaw = finiteNumber(node?.getAttribute?.("aria-valuemax") ?? node?.max);
  const currentRaw = finiteNumber(node?.getAttribute?.("aria-valuenow") ?? node?.value);

  let min = Number.isFinite(minRaw) ? minRaw : 0;
  let max = Number.isFinite(maxRaw) ? maxRaw : Number.NaN;

  if (!Number.isFinite(max) || max <= min) {
    if (Number.isFinite(currentRaw) && currentRaw > 1) max = 100;
    else max = 1;
  }

  return { min, max, current: currentRaw };
}

function isLikelyVolumeNode(provider, node) {
  if (!node) return false;
  const signals = normalizeNodeSignals(node);

  const keywords = (provider.controlActionKeywords?.volume || [])
    .map((word) => normalizeControlText(word))
    .filter(Boolean);

  if (keywords.length && keywords.some((word) => signals.includes(word))) return true;
  if (signals.includes("volume") || signals.includes("громк") || signals.includes("звук")) return true;

  const { min, max } = nodeRange(node);
  if (min >= 0 && max <= 1) return true;
  return false;
}

function findVolumeTarget(provider, doc = document, options = {}) {
  const allowFallback = Boolean(options?.allowFallback);
  const roots = findControlRoots(provider, doc);
  const selector = '[role="slider"], input[type="range"]';

  let fallback = null;
  for (const root of roots) {
    const nodes = [...root.querySelectorAll(selector)];
    for (const node of nodes) {
      if (!fallback) fallback = node;
      if (isLikelyVolumeNode(provider, node)) return node;
    }
  }

  return allowFallback ? fallback : null;
}

function setDomVolume(provider, value01, doc = document) {
  const node = findVolumeTarget(provider, doc, { allowFallback: true });
  if (!node) return false;

  const target = Math.max(0, Math.min(1, Number(value01)));
  const { min, max } = nodeRange(node);
  const nextValue = min + target * (max - min);

  if (node instanceof HTMLInputElement && node.type === "range") {
    node.value = String(nextValue);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    const ratio = (nextValue - min) / Math.max(1e-9, max - min);
    dispatchSeekClick(node, ratio);
    return true;
  }

  const ratio = (nextValue - min) / Math.max(1e-9, max - min);
  return dispatchSeekClick(node, ratio);
}

function setMediaVolume(doc = document, value01) {
  const target = Math.max(0, Math.min(1, Number(value01)));
  const mediaList = [...doc.querySelectorAll("audio,video")];
  if (!mediaList.length) return false;

  for (const media of mediaList) {
    media.volume = target;
    if (target > 0 && media.muted) media.muted = false;
  }

  return true;
}

function setMediaMuted(doc = document, mutedValue) {
  const mediaList = [...doc.querySelectorAll("audio,video")];
  if (!mediaList.length) return false;

  const muted = Boolean(mutedValue);
  for (const media of mediaList) {
    media.muted = muted;
  }

  return true;
}

function inferVolumeFromDom(provider, doc = document) {
  const node = findVolumeTarget(provider, doc, { allowFallback: false });
  if (!node) return Number.NaN;

  const { min, max, current } = nodeRange(node);
  if (!Number.isFinite(current) || max <= min) return Number.NaN;
  return Math.max(0, Math.min(1, (current - min) / (max - min)));
}

function normalizeControlText(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function actionLabelOf(node) {
  return normalizeControlText(
    node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || node?.textContent || ""
  );
}

function findControlRoots(provider, doc = document) {
  if (!provider.controlRoot) return [doc];
  const roots = [...doc.querySelectorAll(provider.controlRoot)];
  return roots.length ? roots : [doc];
}

function clickControlByKeywords(provider, controlKey, doc = document) {
  const keywords = provider.controlActionKeywords?.[controlKey];
  if (!Array.isArray(keywords) || !keywords.length) return false;

  const normalizedKeywords = keywords.map((keyword) => normalizeControlText(keyword)).filter(Boolean);
  if (!normalizedKeywords.length) return false;

  const roots = findControlRoots(provider, doc);
  for (const root of roots) {
    const buttons = [...root.querySelectorAll("button, [role='button']")];
    for (const button of buttons) {
      if (
        button.disabled ||
        String(button.getAttribute?.("aria-disabled") || "")
          .toLowerCase()
          .trim() === "true"
      ) {
        continue;
      }

      const label = actionLabelOf(button);
      if (!label) continue;
      if (!normalizedKeywords.some((keyword) => label.includes(keyword))) continue;

      button.click();
      return true;
    }
  }

  return false;
}

function clickProviderControl(provider, controlKey, doc = document) {
  const roots = findControlRoots(provider, doc);
  for (const root of roots) {
    if (clickSelector(provider.controls?.[controlKey], root)) return true;
  }

  if (clickSelector(provider.controls?.[controlKey], doc)) return true;
  return clickControlByKeywords(provider, controlKey, doc);
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") return false;
  try {
    node.focus({ preventScroll: true });
    return true;
  } catch (_) {
    try {
      node.focus();
      return true;
    } catch (_) {
      return false;
    }
  }
}

function createSpaceKeyboardEvent(type) {
  const init = {
    key: " ",
    code: "Space",
    keyCode: 32,
    which: 32,
    bubbles: true,
    cancelable: true,
    composed: true,
  };

  if (typeof KeyboardEvent !== "undefined") {
    return new KeyboardEvent(type, init);
  }

  if (typeof Event !== "undefined") {
    const fallback = new Event(type, { bubbles: true, cancelable: true, composed: true });
    try {
      Object.defineProperty(fallback, "key", { value: init.key });
      Object.defineProperty(fallback, "code", { value: init.code });
      Object.defineProperty(fallback, "keyCode", { value: init.keyCode });
      Object.defineProperty(fallback, "which", { value: init.which });
    } catch (_) {
      // no-op
    }
    return fallback;
  }

  return { type, ...init };
}

function dispatchSpaceOnTarget(target) {
  if (!target || typeof target.dispatchEvent !== "function") return false;
  let dispatched = false;
  for (const type of ["keydown", "keypress", "keyup"]) {
    try {
      target.dispatchEvent(createSpaceKeyboardEvent(type));
      dispatched = true;
    } catch (_) {
      // no-op
    }
  }
  return dispatched;
}

async function tryVideoSpaceToggle(action, media, context = {}) {
  if (mediaTagName(media) !== "video") return false;

  const desiredAction = String(action || "").trim();
  const wasPaused = Boolean(media.paused);
  if (desiredAction === "play" && !wasPaused) return false;
  if (desiredAction === "pause" && wasPaused) return false;

  const doc = context?.document || document;
  const win = context?.window || doc?.defaultView || globalThis?.window || null;
  focusNode(media);

  const targets = [];
  for (const target of [media, doc?.activeElement, doc, doc?.body, win]) {
    if (!target || targets.includes(target)) continue;
    targets.push(target);
  }

  let dispatched = false;
  for (const target of targets) {
    dispatched = dispatchSpaceOnTarget(target) || dispatched;
  }
  if (!dispatched) return false;

  await Promise.resolve();
  const isPaused = Boolean(media.paused);
  if (desiredAction === "play") return isPaused === false;
  if (desiredAction === "pause") return isPaused === true;
  if (desiredAction === "toggle") return isPaused !== wasPaused;
  return false;
}

function safeRemoveEvent(target, event, listener, options) {
  try {
    target.removeEventListener(event, listener, options);
  } catch (_) {
    // no-op
  }
}

export function createDomMediaAdapter(sourceModule) {
  const provider = sourceModule.meta;
  const readTrack = sourceModule.extract || (() => null);
  const snapshotStrategy = sourceModule.snapshotStrategy || provider.snapshotStrategy || "legacy";
  const strictMediaMetadata = Boolean(
    sourceModule.snapshotStrategyOptions?.strictMediaMetadata ??
      provider.snapshotStrategyOptions?.strictMediaMetadata
  );
  const requirePlaybackStartForPaused = Boolean(
    sourceModule.snapshotStrategyOptions?.requirePlaybackStartForPaused ??
      provider.snapshotStrategyOptions?.requirePlaybackStartForPaused
  );
  const controlCapabilities = normalizeControlCapabilities(provider.controlCapabilities);
  const mediaElementFallback = normalizeControlCapabilities(provider.mediaElementFallback);
  const supportsAction = (action) => controlCapabilities[String(action || "").trim()] === true;
  const canUseMediaFallback = (action) => mediaElementFallback[String(action || "").trim()] === true;
  let primaryMediaRef = null;
  let lastIdentitySnapshot = null;
  let lastIdentityAt = 0;
  let hasObservedPlaybackStart = false;

  function resolvePrimaryMedia(doc = document) {
    const media = pickPrimaryMedia(provider, doc, primaryMediaRef);
    primaryMediaRef = media || null;
    return media;
  }

  return {
    id: provider.id,
    label: provider.label,
    hosts: provider.hosts,
    controlCapabilities,
    getControlCapabilities() {
      return controlCapabilities;
    },
    supportsControls(action) {
      const normalizedAction = String(action || "").trim();
      if (normalizedAction === "next" || normalizedAction === "previous") {
        return supportsAction(normalizedAction) && Boolean(sourceModule.control?.execute);
      }
      return supportsAction(normalizedAction);
    },
    readSnapshot(context) {
      const extractedRaw = readTrack(context);
      if (extractedRaw === null) return null;
      const extracted = extractedRaw || {};
      const primaryMedia = resolvePrimaryMedia(context.document);
      const primaryMediaDims = mediaDimensions(primaryMedia);
      const totalMediaCount = mediaNodeCount(context.document);
      const media = inferMediaSnapshot(context, provider, primaryMedia);
      const hasPrimaryMedia = Boolean(primaryMedia);
      const mediaSession = readMediaSessionSnapshot(context.window);
      const isEmbeddedFrame = context?.isTopWindow === false;
      const locationRef = context?.window?.location || context?.location || null;
      const { snapshot: mergedSnapshot, snapshotSource } = applySnapshotStrategy({
        strategy: snapshotStrategy,
        mediaSnapshot: media,
        extractedSnapshot: extracted,
        mediaSessionSnapshot: mediaSession,
        hasPrimaryMedia,
        strictMediaMetadata,
      });

      const snapshot = {
        ...mergedSnapshot,
        sourceId: provider.id,
        sourceLabel: provider.label,
        controlCapabilities,
        updatedAt: Date.now(),
      };

      if (hasPlaybackStartEvidence(snapshot)) {
        hasObservedPlaybackStart = true;
      } else if (
        requirePlaybackStartForPaused &&
        String(snapshot.playbackState || "").toLowerCase().trim() === "paused" &&
        !hasObservedPlaybackStart
      ) {
        snapshot.playbackState = "idle";
      }

      const extractedVolume = Number(extracted?.volume);
      const domVolume = inferVolumeFromDom(provider, context.document);
      // Prefer real media volume when media exists; DOM slider value can be stale when controls are hidden.
      if (!hasPrimaryMedia && !Number.isFinite(extractedVolume) && Number.isFinite(domVolume)) {
        snapshot.volume = domVolume;
      }

      if (snapshotStrategy === "media-session-first" && typeof context?.emitDiagnostic === "function") {
        context.emitDiagnostic(
          "snapshot.source",
          {
            strategy: snapshotStrategy,
            sourceId: provider.id,
            snapshotSource,
            mediaSession: {
              titlePresent: Boolean(mediaSession.title),
              artistPresent: Boolean(mediaSession.artist),
              coverPresent: Boolean(mediaSession.coverUrl),
              playbackState: mediaSession.playbackState || "",
            },
          },
          {
            key: `snapshot-source:${provider.id}`,
            minIntervalMs: 1000,
          }
        );
      }

      const hasIdentity = Boolean(snapshot.title || snapshot.artist || snapshot.coverUrl);
      const playbackState = String(snapshot.playbackState || "").toLowerCase().trim();
      const hasPlaybackSignal =
        hasPlaybackStartEvidence(snapshot) ||
        (playbackState === "paused" && hasObservedPlaybackStart);
      const hasMediaSessionIdentity = Boolean(
        mediaSession?.title || mediaSession?.artist || mediaSession?.coverUrl
      );

      if (hasIdentity) {
        if (provider.id === "web-media" && !hasPlaybackSignal && !hasMediaSessionIdentity) {
          return null;
        }
        lastIdentitySnapshot = {
          title: snapshot.title || "",
          artist: snapshot.artist || "",
          coverUrl: snapshot.coverUrl || "",
        };
        lastIdentityAt = Date.now();
        return snapshot;
      }

      if (
        snapshotStrategy === "media-session-first" &&
        strictMediaMetadata &&
        lastIdentitySnapshot &&
        Date.now() - lastIdentityAt <= STRICT_METADATA_RECOVERY_WINDOW_MS
      ) {
        return {
          ...snapshot,
          title: lastIdentitySnapshot.title,
          artist: lastIdentitySnapshot.artist,
          coverUrl: lastIdentitySnapshot.coverUrl,
        };
      }

      if (snapshotStrategy === "media-session-first" && !strictMediaMetadata) {
        if (hasPlaybackSignal) {
          if (!hasIdentity) {
            if (
              !isAnonymousPlaybackLikelyPrimary({
                snapshot,
                primaryMedia,
                primaryMediaDims,
                isEmbeddedFrame,
                mediaCount: totalMediaCount,
                locationRef,
                minDurationSec: context?.sourceMinDurationSec,
              })
            ) {
              return null;
            }
          }
          return snapshot;
        }
      }

      return null;
    },
    async execute(action, value, context) {
      const normalizedAction = String(action || "").trim();
      if (!this.supportsControls(normalizedAction, context)) {
        return unsupportedResult(normalizedAction, "capability-missing");
      }

      if (sourceModule.control?.execute) {
        try {
          const sourceResult = await sourceModule.control.execute(normalizedAction, value, context);
          if (sourceResult !== null && sourceResult !== undefined) return sourceResult;
        } catch (error) {
          return { ok: false, message: String(error) };
        }
      }

      if (normalizedAction === "next" || normalizedAction === "previous") {
        return unsupportedResult(normalizedAction, "source-specific-required");
      }

      const media = resolvePrimaryMedia(context.document);

      if (normalizedAction === "play") {
        if (canUseMediaFallback("play") && media && media.paused) {
          await media.play().catch(() => undefined);
          return { ok: true, path: "media-element-play" };
        }
        const viaToggle = clickProviderControl(provider, "playPause", context.document);
        if (viaToggle) return { ok: true, path: "source-button-playPause" };

        const viaPlay = clickProviderControl(provider, "play", context.document);
        if (viaPlay) return { ok: true, path: "source-button-play" };

        const viaVideoSpace = await tryVideoSpaceToggle("play", media, context);
        if (viaVideoSpace) return { ok: true, path: "video-space-toggle" };

        return { ok: false, message: "play control not found" };
      }

      if (normalizedAction === "pause") {
        if (canUseMediaFallback("pause") && media && !media.paused) {
          media.pause();
          return { ok: true, path: "media-element-pause" };
        }
        const ok = clickProviderControl(provider, "playPause", context.document);
        if (ok) return { ok: true, path: "source-button-playPause" };

        const viaVideoSpace = await tryVideoSpaceToggle("pause", media, context);
        return viaVideoSpace
          ? { ok: true, path: "video-space-toggle" }
          : { ok: false, message: "pause control not found" };
      }

      if (normalizedAction === "toggle") {
        if (canUseMediaFallback("toggle") && media) {
          if (media.paused) await media.play().catch(() => undefined);
          else media.pause();
          return { ok: true, path: "media-element-toggle" };
        }
        const ok = clickProviderControl(provider, "playPause", context.document);
        if (ok) return { ok: true, path: "source-button-playPause" };

        const viaVideoSpace = await tryVideoSpaceToggle("toggle", media, context);
        return viaVideoSpace
          ? { ok: true, path: "video-space-toggle" }
          : { ok: false, message: "toggle control not found" };
      }

      if (normalizedAction === "seek") {
        const target = Number(value);
        if (!Number.isFinite(target)) return { ok: false, message: "invalid seek" };

        if (canUseMediaFallback("seek") && media) {
          media.currentTime = Math.max(0, Math.min(media.duration || target, target));
          return { ok: true, path: "media-element-seek" };
        }

        const ok = seekViaDomTarget(provider, target, context.document);
        return ok
          ? { ok: true, path: "dom-seek-target" }
          : { ok: false, message: "no media or seek target" };
      }

      if (normalizedAction === "volume") {
        const target = Number(value);
        if (!Number.isFinite(target)) return { ok: false, message: "invalid volume" };
        const viaMedia = canUseMediaFallback("volume")
          ? setMediaVolume(context.document, target)
          : false;
        const viaDom = setDomVolume(provider, target, context.document);
        if (!viaMedia && !viaDom) return { ok: false, message: "no media or volume target" };
        if (viaMedia && viaDom) return { ok: true, path: "media-and-dom-volume" };
        if (viaMedia) return { ok: true, path: "media-element-volume" };
        return { ok: true, path: "dom-volume-target" };
      }

      if (normalizedAction === "mute") {
        const viaMedia = canUseMediaFallback("mute")
          ? setMediaMuted(context.document, true)
          : false;
        const viaControl = viaMedia
          ? false
          : clickProviderControl(provider, "muteToggle", context.document);
        if (!viaMedia && !viaControl) return { ok: false, message: "no media or mute control" };
        return { ok: true, path: viaMedia ? "media-element-mute" : "source-button-muteToggle" };
      }

      if (normalizedAction === "unmute") {
        const viaMedia = canUseMediaFallback("unmute")
          ? setMediaMuted(context.document, false)
          : false;
        const viaControl = viaMedia
          ? false
          : clickProviderControl(provider, "muteToggle", context.document);
        if (!viaMedia && !viaControl) return { ok: false, message: "no media or mute control" };
        return { ok: true, path: viaMedia ? "media-element-unmute" : "source-button-muteToggle" };
      }

      if (normalizedAction === "muteToggle") {
        if (canUseMediaFallback("muteToggle") && media) {
          media.muted = !media.muted;
          return { ok: true, path: "media-element-muteToggle" };
        }

        const viaControl = clickProviderControl(provider, "muteToggle", context.document);
        return viaControl
          ? { ok: true, path: "source-button-muteToggle" }
          : { ok: false, message: "no media or mute control" };
      }

      return unsupportedResult(normalizedAction, "capability-missing");
    },
    attach(context, onInvalidate) {
      const documentRef = context.document;
      const shouldObserveDom = provider.observeDom !== false;
      let runtimeTeardown = null;

      if (sourceModule.runtime?.init) {
        try {
          runtimeTeardown = sourceModule.runtime.init(context, onInvalidate) || null;
        } catch (_) {
          runtimeTeardown = null;
        }
      }

      const mediaEvents = [
        "play",
        "pause",
        "timeupdate",
        "durationchange",
        "loadedmetadata",
        "seeked",
        "volumechange",
        "ended",
        "ratechange",
      ];

      let observer = null;
      if (shouldObserveDom) {
        observer = new MutationObserver(() => onInvalidate("dom"));
        observer.observe(documentRef.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["title", "aria-label", "src", "style", "class"],
        });
      }

      const listeners = [];
      for (const event of mediaEvents) {
        const listener = () => onInvalidate(event);
        documentRef.addEventListener(event, listener, true);
        listeners.push({ event, listener });
      }

      let pollTimer = null;
      let pollAlive = true;
      if (provider.pollFallbackMs) {
        const loop = () => {
          if (!pollAlive) return;
          onInvalidate("poll");
          pollTimer = setTimeout(loop, provider.pollFallbackMs);
        };
        loop();
      }

      onInvalidate("boot");

      return () => {
        if (observer) observer.disconnect();
        for (const { event, listener } of listeners) {
          safeRemoveEvent(documentRef, event, listener, true);
        }
        pollAlive = false;
        if (pollTimer) clearTimeout(pollTimer);
        if (runtimeTeardown) {
          try {
            runtimeTeardown();
          } catch (_) {
            // no-op
          }
        }
      };
    },
  };
}
