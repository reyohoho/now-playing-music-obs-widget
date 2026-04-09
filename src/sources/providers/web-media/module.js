import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { createWebMediaBridge } from "@/content/webMediaBridge";

function asText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isWeakIdentityText(rawText) {
  const text = asText(rawText).toLowerCase();
  if (!text) return false;

  const weakTokens = [
    "radio record",
    "online radio",
    "слушать онлайн",
    "listen online",
    "главная",
    "homepage",
  ];
  if (weakTokens.some((token) => text.includes(token))) return true;
  if (text === "record" || text === "music" || text === "radio") return true;
  return false;
}

function absoluteUrl(rawHref, win = null) {
  const href = asText(rawHref);
  if (!href) return "";
  const windowRef = win || globalThis?.window || { location: { href: "https://example.invalid/" } };
  try {
    return new URL(href, String(windowRef?.location?.href || "https://example.invalid/")).toString();
  } catch (_) {
    return "";
  }
}

const PRIMARY_IMAGE_EXTENSIONS = new Set(["webp", "jpeg", "jpg", "png"]);
const SECONDARY_IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "bmp",
  "svg",
  "svgz",
  "ico",
  "apng",
  "jfif",
  "pjpeg",
  "pjp",
  "tif",
  "tiff",
  "heic",
  "heif",
]);
const IMAGE_QUERY_KEYS = ["format", "fm", "ext", "type", "mime"];

function stripExtensionToken(rawToken) {
  const token = asText(rawToken)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return token;
}

function extensionScore(rawExt) {
  const ext = stripExtensionToken(rawExt);
  if (!ext) return 0;
  if (PRIMARY_IMAGE_EXTENSIONS.has(ext)) return 110;
  if (SECONDARY_IMAGE_EXTENSIONS.has(ext)) return 85;
  return 0;
}

function extractPathExtension(pathname) {
  const path = asText(pathname);
  if (!path) return "";
  const match = path.match(/\.([a-z0-9]{2,8})(?:$|[/?#])/i);
  return stripExtensionToken(match?.[1] || "");
}

function scoreCoverUrl(rawUrl, win = null) {
  const urlText = asText(rawUrl);
  if (!urlText) return 0;

  if (/^data:image\//i.test(urlText)) return 220;
  if (/^blob:/i.test(urlText)) return 40;

  const absolute = absoluteUrl(urlText, win);
  if (!absolute) return 0;

  let score = 8;
  let parsed = null;
  try {
    parsed = new URL(absolute);
  } catch (_) {
    return score;
  }

  const pathname = asText(parsed.pathname).toLowerCase();
  if (
    pathname.includes("/view_video.php") ||
    pathname.includes("/watch") ||
    /\.(php|html|htm|asp|aspx|jsp)$/i.test(pathname) ||
    parsed.searchParams.has("viewkey")
  ) {
    return 0;
  }

  const pathExt = extractPathExtension(parsed.pathname);
  score += extensionScore(pathExt);

  for (const key of IMAGE_QUERY_KEYS) {
    const value = stripExtensionToken(parsed.searchParams.get(key) || "");
    score += extensionScore(value);
  }

  if (
    pathname.includes("/plain/") &&
    (pathname.includes("/videos/") || pathname.includes("original_") || pathname.includes("thumb"))
  ) {
    score += 120;
  }
  if (pathname.includes("/rs:fit:")) score += 36;
  if (pathname.includes("/vts:")) score += 20;

  if (pathname.includes("/image") || pathname.includes("/img") || pathname.includes("/cover") || pathname.includes("/art")) {
    score += 16;
  }
  if (pathname.includes("thumbnail") || pathname.includes("thumb")) {
    score += 10;
  }

  const hasValidTo = parsed.searchParams.has("validto");
  const hasValidFrom = parsed.searchParams.has("validfrom");
  const hasHash = parsed.searchParams.has("hash");

  // Generic signed-url stability heuristic:
  // URLs with validfrom+validto are usually safer to reuse outside original page context.
  if (hasValidFrom && hasValidTo) score += 22;
  if (hasValidTo && !hasValidFrom) score -= 34;
  if (hasHash && !hasValidFrom && !pathExt && !pathname.includes("thumb") && !pathname.includes("/plain/")) {
    score -= 14;
  }

  return Math.max(0, score);
}

function pickBestCoverUrl(candidates, win = null) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  let best = { url: "", score: -1, index: Number.POSITIVE_INFINITY };
  let firstValid = "";
  let firstValidScore = -1;

  for (let index = 0; index < list.length; index += 1) {
    const absolute = absoluteUrl(list[index], win);
    if (!absolute) continue;
    if (!firstValid) firstValid = absolute;

    const score = scoreCoverUrl(absolute, win);
    if (firstValidScore < 0) firstValidScore = score;
    if (score > best.score || (score === best.score && index < best.index)) {
      best = { url: absolute, score, index };
    }
  }

  if (best.score > 0) return best.url;
  if (firstValidScore > 0) return firstValid;
  return "";
}

function isLikelyOriginLockedCover(rawUrl, win = null) {
  const absolute = absoluteUrl(rawUrl, win);
  if (!absolute) return false;
  if (/^data:image\//i.test(absolute) || /^blob:/i.test(absolute)) return false;

  let parsed = null;
  try {
    parsed = new URL(absolute);
  } catch (_) {
    return false;
  }

  const pathname = asText(parsed.pathname).toLowerCase();
  const pathExt = extractPathExtension(pathname);
  const hasImagePathExt = extensionScore(pathExt) > 0;
  const hasValidTo = parsed.searchParams.has("validto");
  const hasValidFrom = parsed.searchParams.has("validfrom");
  const hasHash = parsed.searchParams.has("hash");
  const looksTranscodedPreview =
    pathname.includes("/plain/") &&
    (pathname.includes("/videos/") || pathname.includes("original_") || pathname.includes("thumb"));

  if (hasValidTo && hasHash && !hasValidFrom && !hasImagePathExt) return true;
  if (looksTranscodedPreview && hasValidTo && !hasImagePathExt) return true;
  return false;
}

function nodeTextParts(node) {
  if (!node || typeof node.querySelectorAll !== "function") return [];
  const chunks = [...node.querySelectorAll("div,span,p,strong,b")]
    .map((item) => asText(item?.textContent || ""))
    .filter(Boolean);
  const deduped = [];
  for (const chunk of chunks) {
    if (!deduped.includes(chunk)) deduped.push(chunk);
  }
  return deduped;
}

function splitTrackTitleArtist(rawText) {
  const text = asText(rawText);
  if (!text) return { title: "", artist: "" };

  const bulletParts = text.split(/\s*[•·]\s*/g).map(asText).filter(Boolean);
  if (bulletParts.length >= 2) {
    return {
      title: bulletParts[0],
      artist: bulletParts.slice(1).join(" / "),
    };
  }

  const dashMatch = text.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (dashMatch) {
    return {
      title: asText(dashMatch[1]),
      artist: asText(dashMatch[2]),
    };
  }

  return {
    title: text,
    artist: "",
  };
}

function sanitizePageTitle(rawTitle) {
  let text = asText(rawTitle);
  if (!text) return "";

  text = text
    .replace(/\s+на\s+radio\s+record$/i, "")
    .replace(/\s*[|]\s*radio\s+record$/i, "")
    .replace(/\s*[-–—]\s*слушать онлайн.*$/i, "")
    .replace(/\s*[-–—]\s*listen online.*$/i, "")
    .trim();

  return asText(text);
}

function scoreTrackCandidate(candidate, sourceType, sourceIndex = 0) {
  const title = asText(candidate?.title);
  const artist = asText(candidate?.artist);
  const coverUrl = asText(candidate?.coverUrl);
  const trackUrl = asText(candidate?.trackUrl);

  let score = 0;
  if (sourceType === "anchor") score += 80;
  else if (sourceType === "document-title") score += 44;
  else if (sourceType === "meta") score += 34;

  if (title) score += 24;
  if (artist) score += 22;
  if (coverUrl) {
    const coverScore = scoreCoverUrl(coverUrl);
    score += 8 + Math.min(18, Math.round(coverScore / 14));
  }
  if (trackUrl) score += 6;
  if (title && artist) score += 14;

  if (title && isWeakIdentityText(title)) score -= 36;
  if (artist && isWeakIdentityText(artist)) score -= 24;

  if (sourceType === "anchor") score -= Math.min(12, Math.max(0, Number(sourceIndex) || 0));
  return score;
}

function normalizeCandidate(rawCandidate, sourceType, sourceIndex = 0, win = window) {
  if (!rawCandidate || typeof rawCandidate !== "object") return null;

  const title = asText(rawCandidate.title);
  const artist = asText(rawCandidate.artist);
  const coverUrl = pickBestCoverUrl([rawCandidate.coverUrl], win);
  const trackUrl = absoluteUrl(rawCandidate.trackUrl, win);

  const candidate = {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(trackUrl ? { trackUrl } : {}),
  };
  if (!Object.keys(candidate).length) return null;

  const score = scoreTrackCandidate(candidate, sourceType, sourceIndex);
  return {
    ...candidate,
    score,
  };
}

function firstImageUrl(node, win = window) {
  if (!node) return "";

  const imageCandidates = [];
  const push = (value) => {
    const text = asText(value);
    if (!text) return;
    imageCandidates.push(text);
  };
  const firstSrcsetToken = (rawSrcset) => {
    const srcset = asText(rawSrcset);
    if (!srcset) return "";
    const first = srcset.split(",")[0];
    if (!first) return "";
    return asText(first.split(/\s+/)[0]);
  };

  push(node?.currentSrc);
  push(node?.getAttribute?.("src"));
  push(firstSrcsetToken(node?.getAttribute?.("srcset")));

  const imageNode = node.querySelector?.("img[src], img[srcset], img");
  push(imageNode?.currentSrc);
  push(imageNode?.getAttribute?.("src"));
  push(firstSrcsetToken(imageNode?.getAttribute?.("srcset")));

  return pickBestCoverUrl(imageCandidates, win);
}

function nearbyCoverUrl(anchor, win = window) {
  if (!anchor) return "";

  const adjacent = [anchor.previousElementSibling, anchor.nextElementSibling];
  for (const node of adjacent) {
    const url = firstImageUrl(node, win);
    if (url) return url;
  }

  let cursor = anchor.parentElement || null;
  for (let depth = 0; cursor && depth < 4; depth += 1) {
    const url = firstImageUrl(cursor, win);
    if (url) return url;
    cursor = cursor.parentElement || null;
  }

  return "";
}

function extractTrackFromAnchor(anchor, win = window) {
  if (!anchor) return null;

  const parts = nodeTextParts(anchor);
  const parsedText = splitTrackTitleArtist(anchor?.textContent || "");
  const title = asText(parts[0] || parsedText.title || "");
  const artist = asText(parts[1] || parsedText.artist || "");
  const trackUrl = absoluteUrl(anchor.getAttribute?.("href"), win);
  const coverUrl =
    firstImageUrl(anchor, win) || nearbyCoverUrl(anchor, win) || "";

  if (!title && !artist && !trackUrl && !coverUrl) return null;
  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(trackUrl ? { trackUrl } : {}),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

function extractTrackFromDocumentTitle(doc = document, win = window) {
  const rawTitle = asText(doc?.title || win?.document?.title || "");
  if (!rawTitle) return null;

  const cleaned = sanitizePageTitle(rawTitle);
  if (!cleaned) return null;

  const parts = cleaned.split(/\s[-–—]\s/g).map(asText).filter(Boolean);
  const looksLikeRadioRecordTitle = /\bradio\s+record\b/i.test(rawTitle);

  let title = "";
  let artist = "";

  if (looksLikeRadioRecordTitle && parts.length >= 2) {
    artist = parts[0];
    title = parts.slice(1).join(" - ");
  } else {
    const parsed = splitTrackTitleArtist(cleaned);
    title = parsed.title;
    artist = parsed.artist;
  }

  if (!title && !artist) return null;
  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    trackUrl: asText(win?.location?.href || ""),
  };
}

function extractTrackFromMeta(doc = document, win = window) {
  if (!doc || typeof doc.querySelector !== "function") return null;

  const rawTitle = asText(
    doc.querySelector('meta[property="og:title"]')?.getAttribute?.("content") ||
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute?.("content") ||
      ""
  );
  const cleaned = rawTitle ? sanitizePageTitle(rawTitle) : "";
  const parsed = cleaned ? splitTrackTitleArtist(cleaned) : { title: "", artist: "" };
  const coverUrl = pickBestCoverUrl(
    [
      doc.querySelector('meta[property="og:image"]')?.getAttribute?.("content"),
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute?.("content"),
      doc.querySelector('meta[name="twitter:image:src"]')?.getAttribute?.("content"),
    ],
    win
  );
  const trackUrl = asText(
    doc.querySelector('meta[property="og:url"]')?.getAttribute?.("content") ||
      doc.querySelector('link[rel="canonical"]')?.getAttribute?.("href") ||
      win?.location?.href ||
      ""
  );

  if (!parsed.title && !parsed.artist && !coverUrl && !trackUrl) return null;
  return {
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.artist ? { artist: parsed.artist } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(trackUrl ? { trackUrl } : {}),
  };
}

function fallbackTrackFromDocument(doc = document, win = window) {
  const candidates = [];

  const anchors = [
    ...(doc.querySelectorAll?.('a[href*="/track/"], a[href*="/tracks/"]') || []),
  ];
  for (let index = 0; index < anchors.length; index += 1) {
    const extracted = extractTrackFromAnchor(anchors[index], win);
    const candidate = normalizeCandidate(extracted, "anchor", index, win);
    if (candidate) candidates.push(candidate);
  }

  const titleCandidate = normalizeCandidate(
    extractTrackFromDocumentTitle(doc, win),
    "document-title",
    0,
    win
  );
  if (titleCandidate) candidates.push(titleCandidate);

  const metaCandidate = normalizeCandidate(extractTrackFromMeta(doc, win), "meta", 0, win);
  if (metaCandidate) candidates.push(metaCandidate);

  let best = null;
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  // Ignore weak noisy candidates (for example plain site title without track identity).
  if (!best || best.score < 35) return null;
  const snapshot = { ...best };
  const bestCoverFromAllCandidates = pickBestCoverUrl(
    candidates.map((candidate) => candidate?.coverUrl).filter(Boolean),
    win
  );
  if (bestCoverFromAllCandidates) {
    const currentCoverScore = scoreCoverUrl(snapshot.coverUrl, win);
    const candidateCoverScore = scoreCoverUrl(bestCoverFromAllCandidates, win);
    if (!snapshot.coverUrl || candidateCoverScore >= currentCoverScore) {
      snapshot.coverUrl = bestCoverFromAllCandidates;
    }
  }
  delete snapshot.score;
  return snapshot;
}

function mediaAreaScore(node) {
  if (!node) return 0;

  const rect = node.getBoundingClientRect?.();
  const rectArea = Number(rect?.width) * Number(rect?.height);
  if (Number.isFinite(rectArea) && rectArea > 0) return rectArea;

  const clientArea = Number(node?.clientWidth) * Number(node?.clientHeight);
  if (Number.isFinite(clientArea) && clientArea > 0) return clientArea;

  const intrinsicArea = Number(node?.videoWidth || node?.width) * Number(node?.videoHeight || node?.height);
  if (Number.isFinite(intrinsicArea) && intrinsicArea > 0) return intrinsicArea;

  return 0;
}

function pickPrimaryMedia(mediaList, preferredMedia = null) {
  if (!Array.isArray(mediaList) || !mediaList.length) return null;

  if (preferredMedia && mediaList.includes(preferredMedia) && preferredMedia.isConnected !== false) {
    const hasAlternativeNonEnded = mediaList.some((node) => node !== preferredMedia && node?.ended !== true);
    if (!(preferredMedia.ended && hasAlternativeNonEnded)) return preferredMedia;
  }

  const videos = mediaList
    .map((node, index) => ({
      node,
      index,
      tag: String(node?.tagName || "")
        .toLowerCase()
        .trim(),
      area: mediaAreaScore(node),
    }))
    .filter((item) => item.tag === "video");

  if (videos.length) {
    videos.sort((a, b) => b.area - a.area || a.index - b.index);
    if (videos[0].area > 0) return videos[0].node;
    return videos.find((item) => item.node && item.node.paused === false && item.node.ended !== true)?.node || videos[0].node;
  }

  return mediaList.find((node) => node && node.paused === false && node.ended !== true) || mediaList[0];
}

function isVideoElement(node) {
  return (
    String(node?.tagName || "")
      .toLowerCase()
      .trim() === "video"
  );
}

function primaryVideoForCover(doc = document, context = null) {
  const mediaList = [...(doc.querySelectorAll?.("audio,video") || [])];
  if (!mediaList.length) return null;

  const preferredMedia = context?.webMediaPrimaryMediaRef || null;
  if (isVideoElement(preferredMedia) && mediaList.includes(preferredMedia) && preferredMedia.isConnected !== false) {
    return preferredMedia;
  }

  const primary = pickPrimaryMedia(mediaList, preferredMedia);
  if (isVideoElement(primary)) return primary;
  return mediaList.find((node) => isVideoElement(node)) || null;
}

function capturePrimaryVideoFrameCover(doc = document, context = null) {
  const video = primaryVideoForCover(doc, context);
  if (!video) return "";
  if (typeof doc?.createElement !== "function") return "";

  const width = Math.max(0, Number(video?.videoWidth) || 0);
  const height = Math.max(0, Number(video?.videoHeight) || 0);
  if (width < 2 || height < 2) return "";

  const sourceSignature = asText(video?.currentSrc || video?.src || video?.getAttribute?.("src") || "");
  const signature = `${sourceSignature}|${width}x${height}`;

  const cache = context?.webMediaFrameCoverCache || null;
  if (cache && cache.signature === signature && asText(cache.coverUrl)) {
    return asText(cache.coverUrl);
  }

  const now = Date.now();
  const failedAt = Number(cache?.failedAt) || 0;
  if (cache && cache.signature === signature && failedAt > 0 && now - failedAt < 5000) {
    return "";
  }

  try {
    const canvas = doc.createElement("canvas");
    const maxEdge = 640;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context2d = canvas.getContext?.("2d");
    if (!context2d || typeof context2d.drawImage !== "function") {
      if (context && typeof context === "object") {
        context.webMediaFrameCoverCache = {
          signature,
          coverUrl: "",
          failedAt: now,
        };
      }
      return "";
    }

    context2d.drawImage(video, 0, 0, targetWidth, targetHeight);
    const coverUrl = asText(canvas.toDataURL?.("image/jpeg", 0.72) || "");
    if (!coverUrl.startsWith("data:image/")) {
      if (context && typeof context === "object") {
        context.webMediaFrameCoverCache = {
          signature,
          coverUrl: "",
          failedAt: now,
        };
      }
      return "";
    }

    if (context && typeof context === "object") {
      context.webMediaFrameCoverCache = {
        signature,
        coverUrl,
        failedAt: 0,
      };
    }
    return coverUrl;
  } catch (_) {
    if (context && typeof context === "object") {
      context.webMediaFrameCoverCache = {
        signature,
        coverUrl: "",
        failedAt: now,
      };
    }
    return "";
  }
}

function inferPlaybackStateFromMedia(doc = document, context = null) {
  const mediaList = [...(doc.querySelectorAll?.("audio,video") || [])];
  if (!mediaList.length) {
    if (context && typeof context === "object") {
      context.webMediaPrimaryMediaRef = null;
    }
    return "";
  }

  const preferredMedia = context?.webMediaPrimaryMediaRef || null;
  const primary = pickPrimaryMedia(mediaList, preferredMedia);
  if (!primary) return "";
  if (context && typeof context === "object") {
    context.webMediaPrimaryMediaRef = primary;
  }

  if (primary && primary.paused === false && primary.ended !== true) {
    return "playing";
  }
  if (primary && primary.ended === true) {
    return "ended";
  }
  return "paused";
}

function normalizeBridgeSnapshot(rawSnapshot, win = null) {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return null;

  const title = asText(rawSnapshot.title);
  const artist = asText(rawSnapshot.artist);
  const coverUrl = pickBestCoverUrl([rawSnapshot.coverUrl], win || window);
  const trackUrl = absoluteUrl(rawSnapshot.trackUrl, win);
  const playbackState = asText(rawSnapshot.playbackState).toLowerCase();
  const durationSec = Number(rawSnapshot.durationSec);
  const positionSec = Number(rawSnapshot.positionSec);
  const volume = Number(rawSnapshot.volume);
  const muted = rawSnapshot.muted;

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(trackUrl ? { trackUrl } : {}),
    ...(playbackState ? { playbackState } : {}),
    ...(Number.isFinite(durationSec) ? { durationSec: Math.max(0, durationSec) } : {}),
    ...(Number.isFinite(positionSec) ? { positionSec: Math.max(0, positionSec) } : {}),
    ...(Number.isFinite(volume) ? { volume: Math.max(0, Math.min(1, volume)) } : {}),
    ...(typeof muted === "boolean" ? { muted } : {}),
  };
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  snapshotStrategyOptions: {
    strictMediaMetadata: false,
    requirePlaybackStartForPaused: false,
  },
  meta: {
    id: "web-media",
    label: "Web Media Session",
    sender: "WEB",
    hosts: [],
    primaryMediaStrategy: "largest-video",
    observeDom: false,
    pollFallbackMs: 1200,
    controlCapabilities: buildControlActionMap({
      defaultTransport: false,
      defaultAudio: true,
      transportOverrides: {
        [TRANSPORT_ACTIONS.PLAY]: true,
        [TRANSPORT_ACTIONS.PAUSE]: true,
        [TRANSPORT_ACTIONS.TOGGLE]: true,
        [TRANSPORT_ACTIONS.NEXT]: false,
        [TRANSPORT_ACTIONS.PREVIOUS]: false,
      },
    }),
    mediaElementFallback: buildControlActionMap({
      defaultTransport: false,
      defaultAudio: true,
      transportOverrides: {
        [TRANSPORT_ACTIONS.PLAY]: true,
        [TRANSPORT_ACTIONS.PAUSE]: true,
        [TRANSPORT_ACTIONS.TOGGLE]: true,
        [TRANSPORT_ACTIONS.NEXT]: false,
        [TRANSPORT_ACTIONS.PREVIOUS]: false,
      },
      audioOverrides: {
        [AUDIO_ACTIONS.SEEK]: true,
        [AUDIO_ACTIONS.VOLUME]: true,
        [AUDIO_ACTIONS.MUTE]: true,
        [AUDIO_ACTIONS.UNMUTE]: true,
        [AUDIO_ACTIONS.MUTE_TOGGLE]: true,
      },
    }),
  },
  extract(context = {}) {
    const doc = context?.document || document;
    const win = context?.window || window;
    const bridge = context?.webMediaBridge;
    if (bridge?.requestSnapshot) {
      void bridge.requestSnapshot();
    }

    const bridgeSnapshot = normalizeBridgeSnapshot(bridge?.getSnapshot?.(), win);
    const fallbackTrack = fallbackTrackFromDocument(doc, win);
    const playbackState =
      bridgeSnapshot?.playbackState || inferPlaybackStateFromMedia(doc, context);

    const fallback = fallbackTrack || {};
    const snapshot = {
      ...fallback,
      ...(bridgeSnapshot || {}),
    };
    const bestCoverUrl = pickBestCoverUrl([bridgeSnapshot?.coverUrl, fallback?.coverUrl], win);
    const shouldUseFrameCover = !bestCoverUrl || isLikelyOriginLockedCover(bestCoverUrl, win);
    const frameCoverUrl = shouldUseFrameCover ? capturePrimaryVideoFrameCover(doc, context) : "";
    if (frameCoverUrl) snapshot.coverUrl = frameCoverUrl;
    else if (bestCoverUrl) snapshot.coverUrl = bestCoverUrl;
    else delete snapshot.coverUrl;

    return {
      ...snapshot,
      ...(playbackState ? { playbackState } : {}),
    };
  },
  runtime: {
    init(context, onInvalidate) {
      const bridge = createWebMediaBridge(context);
      context.webMediaBridge = bridge;
      bridge.init(() => onInvalidate("web_media_bridge"));
      void bridge.requestSnapshot();
      return () => {
        bridge.destroy();
        delete context.webMediaBridge;
      };
    },
  },
};

export default sourceModule;
