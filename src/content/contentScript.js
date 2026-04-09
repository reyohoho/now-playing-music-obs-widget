import { normalizeSnapshot, snapshotFingerprint } from "@/core/normalize";
import { MSG } from "@/shared/messages";
import { getAdapterByHost } from "@/content/adapters/index";
import { executeSelectorControl } from "@/sources/shared/selectorControl";
import { createSelectorPickerController } from "@/content/selectorPickerController";
import {
  SOURCE_MIN_DURATION_SEC_DISABLED,
  defaultSourceMinDurationSecMap,
  normalizeSourceMinDurationSec,
} from "@/shared/webMediaSettings";

const adapter = getAdapterByHost(location.hostname);
const isTopWindow = window.top === window;
const EMBED_FRAME_BLOCKED_REFERRER_HOSTS = new Set();
const WEB_MEDIA_FRAME_BLOCKED_HOST_TOKENS = [
  "doubleclick.",
  "googlesyndication.",
  "adservice.",
  "taboola.",
  "outbrain.",
  "criteo.",
];
const WEB_MEDIA_FRAME_PATH_HINTS = [
  "/embed/",
  "/player/",
  "/video/",
  "/stream/",
  "/watch/",
  "/content/",
];
const WEB_MEDIA_FRAME_QUERY_HINTS = [
  "autoplay=1",
  "m3u8",
  "mpd",
  "hls",
  "dash",
  "player",
  "video",
  "embed",
  "stream",
];

function parseReferrerUrl() {
  const value = String(document.referrer || "").trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function shouldBlockYouTubeEmbedByReferrer() {
  const referrer = parseReferrerUrl();
  if (!referrer) return false;
  return EMBED_FRAME_BLOCKED_REFERRER_HOSTS.has(referrer.hostname);
}

function isBlockedWebMediaFrameHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return false;
  return WEB_MEDIA_FRAME_BLOCKED_HOST_TOKENS.some((token) => normalized.includes(token));
}

function hasWebMediaFrameUrlHints(locationRef = location) {
  const pathname = String(locationRef?.pathname || "").toLowerCase();
  const search = String(locationRef?.search || "").toLowerCase();
  const hasPathHint = WEB_MEDIA_FRAME_PATH_HINTS.some((token) => pathname.includes(token));
  const hasQueryHint = WEB_MEDIA_FRAME_QUERY_HINTS.some((token) => search.includes(token));
  return hasPathHint || hasQueryHint;
}

function hasInlineWebMediaHints(doc = document, nav = navigator) {
  try {
    if (doc?.querySelector?.("video, audio")) return true;
  } catch (_) {
    // no-op
  }

  try {
    const mediaSession = nav?.mediaSession;
    const playbackState = String(mediaSession?.playbackState || "")
      .trim()
      .toLowerCase();
    if (playbackState === "playing" || playbackState === "paused" || playbackState === "ended") {
      return true;
    }
    const metadata = mediaSession?.metadata;
    if (metadata?.title || metadata?.artist) return true;
    if (Array.isArray(metadata?.artwork) && metadata.artwork.length) return true;
  } catch (_) {
    // no-op
  }

  return false;
}

function canRunGenericWebMediaInFrame() {
  if (isBlockedWebMediaFrameHost(location.hostname)) return false;
  if (hasWebMediaFrameUrlHints(location)) return true;
  return hasInlineWebMediaHints(document, navigator);
}

function canRunInFrame(currentAdapter) {
  if (isTopWindow) return true;
  if (!currentAdapter) return false;

  // Allow YouTube embeds in generic third-party pages, but skip known hosts
  // that have their own top-level provider (to avoid duplicate sessions).
  if (currentAdapter.id === "youtube") {
    if (!String(location.pathname || "").startsWith("/embed/")) return false;
    return !shouldBlockYouTubeEmbedByReferrer();
  }

  if (currentAdapter.id === "web-media") {
    return canRunGenericWebMediaInFrame();
  }

  return false;
}

function runSelectorControl(selector, action, value, mode = "") {
  const normalizedSelector = String(selector || "").trim();
  if (!normalizedSelector) {
    return { ok: false, message: "selector is empty" };
  }

  return executeSelectorControl(action, normalizedSelector, value, document, mode);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function videoAreaScore(video) {
  if (!video) return 0;

  const rect = video.getBoundingClientRect?.();
  const rectWidth = finiteNumber(rect?.width);
  const rectHeight = finiteNumber(rect?.height);
  if (Number.isFinite(rectWidth) && Number.isFinite(rectHeight) && rectWidth > 0 && rectHeight > 0) {
    return rectWidth * rectHeight;
  }

  const clientWidth = finiteNumber(video?.clientWidth);
  const clientHeight = finiteNumber(video?.clientHeight);
  if (Number.isFinite(clientWidth) && Number.isFinite(clientHeight) && clientWidth > 0 && clientHeight > 0) {
    return clientWidth * clientHeight;
  }

  const intrinsicWidth = finiteNumber(video?.videoWidth || video?.width);
  const intrinsicHeight = finiteNumber(video?.videoHeight || video?.height);
  if (
    Number.isFinite(intrinsicWidth) &&
    Number.isFinite(intrinsicHeight) &&
    intrinsicWidth > 0 &&
    intrinsicHeight > 0
  ) {
    return intrinsicWidth * intrinsicHeight;
  }

  return 0;
}

function pickPrimaryVideoForFrameCapture(doc = document) {
  const videos = [...(doc.querySelectorAll?.("video") || [])];
  if (!videos.length) return null;

  const scored = videos.map((video, index) => ({
    video,
    index,
    area: videoAreaScore(video),
    isPlaying: video?.paused === false && video?.ended !== true,
  }));

  scored.sort((a, b) => {
    if (a.isPlaying !== b.isPlaying) return a.isPlaying ? -1 : 1;
    if (a.area !== b.area) return b.area - a.area;
    return a.index - b.index;
  });

  return scored[0]?.video || null;
}

function capturePrimaryVideoFrameCover(options = {}, doc = document) {
  const video = pickPrimaryVideoForFrameCapture(doc);
  if (!video) return { ok: false, message: "no video found" };

  const videoWidth = Math.max(0, Number(video.videoWidth) || 0);
  const videoHeight = Math.max(0, Number(video.videoHeight) || 0);
  if (videoWidth < 2 || videoHeight < 2) {
    return { ok: false, message: "video has no intrinsic size yet" };
  }

  if (typeof doc?.createElement !== "function") {
    return { ok: false, message: "document.createElement unavailable" };
  }

  const maxEdge = Math.max(48, Math.min(2048, Number(options?.maxEdge) || 176));
  const scale = Math.min(1, maxEdge / Math.max(videoWidth, videoHeight));
  const targetWidth = Math.max(1, Math.round(videoWidth * scale));
  const targetHeight = Math.max(1, Math.round(videoHeight * scale));
  const quality = Math.max(0.1, Math.min(0.95, Number(options?.quality) || 0.5));

  try {
    const canvas = doc.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context2d = canvas.getContext?.("2d");
    if (!context2d || typeof context2d.drawImage !== "function") {
      return { ok: false, message: "canvas context unavailable" };
    }

    context2d.drawImage(video, 0, 0, targetWidth, targetHeight);
    const coverUrl = String(canvas.toDataURL?.("image/jpeg", quality) || "").trim();
    if (!coverUrl.startsWith("data:image/")) {
      return { ok: false, message: "frame encode failed" };
    }

    return {
      ok: true,
      coverUrl,
      width: targetWidth,
      height: targetHeight,
    };
  } catch (error) {
    return {
      ok: false,
      message: String(error || "frame capture failed"),
    };
  }
}

function pickerEmitResult(payload) {
  if (!chrome?.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: MSG.SELECTOR_PICKER_RESULT,
        ...payload,
      },
      () => void chrome.runtime?.lastError
    );
  } catch (_) {
    // no-op
  }
}
const selectorPicker = createSelectorPickerController({
  windowRef: window,
  documentRef: document,
  emitResult: pickerEmitResult,
});
let wrapperOverlay = null;
let wrapperOverlayLoadPromise = null;

async function ensureWrapperOverlay() {
  if (wrapperOverlay) return wrapperOverlay;
  if (wrapperOverlayLoadPromise) return wrapperOverlayLoadPromise;

  wrapperOverlayLoadPromise = import("@/content/wrapperRuleOverlay")
    .then((module) => {
      wrapperOverlay = module.createWrapperRuleOverlay({
        windowRef: window,
        documentRef: document,
        locationRef: location,
        adapter,
        pickerController: selectorPicker,
      });
      return wrapperOverlay;
    })
    .finally(() => {
      wrapperOverlayLoadPromise = null;
    });

  return wrapperOverlayLoadPromise;
}

if (chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MSG.CONTROL_SELECTOR_EXEC) {
      sendResponse(
        runSelectorControl(message.selector, message.action, message.value, message.mode)
      );
      return;
    }
    if (message?.type === MSG.SELECTOR_PICKER_START) {
      sendResponse(selectorPicker.start(message.requestId));
      return;
    }
    if (message?.type === MSG.SELECTOR_PICKER_CANCEL) {
      sendResponse(selectorPicker.cancel(message.requestId));
      return;
    }
    if (message?.type === MSG.WRAPPER_OVERLAY_OPEN) {
      if (!isTopWindow) {
        sendResponse({ ok: false, message: "Wrapper overlay is top-frame only" });
        return;
      }
      void ensureWrapperOverlay()
        .then((overlay) =>
          overlay.open({
            mode: String(message?.mode || "").trim() === "edit" ? "edit" : "create",
            ruleId: message?.ruleId,
            seedChildSourceIds: message?.seedChildSourceIds,
          })
        )
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }
    if (message?.type === MSG.WRAPPER_OVERLAY_CLOSE) {
      if (!isTopWindow) {
        sendResponse({ ok: true });
        return;
      }
      wrapperOverlay?.close();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === MSG.POPUP_REQUEST_VIDEO_FRAME_COVER) {
      sendResponse(capturePrimaryVideoFrameCover(message, document));
    }
  });
}

if (adapter && canRunInFrame(adapter)) {
  const context = { document, window, location, isTopWindow };
  const contextStartedAt = Date.now();

  let lastFingerprint = "";
  let lastSentAt = 0;
  let pendingRefresh = false;
  let hadSnapshot = false;
  let removeSent = false;
  let lastRefreshError = "";
  let debugMode = false;
  let trackingEnabled = true;
  let allowGenericWebInjection = true;
  let sourceMinDurationSecMap = {};
  let sourceMinDurationSec = SOURCE_MIN_DURATION_SEC_DISABLED;
  let monitoringActive = false;
  let contextAlive = true;
  let teardown = null;
  const diagnosticThrottle = new Map();
  const adapterSourceId = String(adapter?.id || "")
    .trim()
    .toLowerCase();
  const volumeTrace = {
    enabled: false,
    events: [],
    flushTimer: null,
    cleanup: null,
  };

  function resolveCurrentSourceMinDuration(settings = {}) {
    if (!adapterSourceId) return SOURCE_MIN_DURATION_SEC_DISABLED;
    const defaults = defaultSourceMinDurationSecMap([adapterSourceId]);
    const fallback = defaults[adapterSourceId] ?? SOURCE_MIN_DURATION_SEC_DISABLED;
    const map = settings?.sourceMinDurationSecMap;
    if (!map || typeof map !== "object") return fallback;
    return normalizeSourceMinDurationSec(map?.[adapterSourceId], fallback);
  }

  function mapFromSettings(settings = {}) {
    const map =
      settings?.sourceMinDurationSecMap && typeof settings.sourceMinDurationSecMap === "object"
        ? { ...settings.sourceMinDurationSecMap }
        : {};

    if (
      adapterSourceId === "web-media" &&
      !Object.prototype.hasOwnProperty.call(map, adapterSourceId) &&
      settings?.webMediaMinDurationSec !== undefined
    ) {
      const defaults = defaultSourceMinDurationSecMap([adapterSourceId]);
      map[adapterSourceId] = normalizeSourceMinDurationSec(
        settings?.webMediaMinDurationSec,
        defaults[adapterSourceId] ?? SOURCE_MIN_DURATION_SEC_DISABLED
      );
    }

    return map;
  }

  function isRuntimeReady() {
    return (
      typeof chrome !== "undefined" &&
      Boolean(chrome.runtime) &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function debugLog(event, payload) {
    if (!debugMode) return;
    console.debug(`[Now Playing][${adapter.id}] ${event}`, payload || "");
  }

  function warnLog(event, payload) {
    console.warn(`[Now Playing][${adapter.id}] ${event}`, payload || "");
  }

  context.debugLog = (event, payload) => debugLog(event, payload);
  context.warnLog = (event, payload) => warnLog(event, payload);

  function emitDiagnostic(event, payload = {}, options = {}) {
    if (!debugMode || !contextAlive) return false;

    const eventName = String(event || "").trim();
    if (!eventName) return false;

    const now = Date.now();
    const key = String(options?.key || eventName);
    const minIntervalMs = Math.max(0, Number(options?.minIntervalMs) || 0);
    const lastAt = diagnosticThrottle.get(key) || 0;

    if (minIntervalMs > 0 && now - lastAt < minIntervalMs) return false;
    diagnosticThrottle.set(key, now);

    return safeSendMessage(
      {
        type: MSG.SOURCE_DIAGNOSTIC,
        providerId: adapter.id,
        event: eventName,
        payload,
        at: now,
        href: location.href,
      },
      "source_diagnostic"
    );
  }

  context.emitDiagnostic = (event, payload, options) => emitDiagnostic(event, payload, options);
  context.sourceMinDurationSec = sourceMinDurationSec;

  function normalizeClassName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  function describeVolumeNode(node) {
    if (!node || node.nodeType !== 1) return null;
    const tag = String(node.tagName || "").toLowerCase();
    if (!tag) return null;
    const role = String(node.getAttribute?.("role") || "").trim().toLowerCase();
    const type = String(node.getAttribute?.("type") || "").trim().toLowerCase();
    const id = String(node.id || "").trim();
    const className = normalizeClassName(node.className || "");
    const ariaNow = String(node.getAttribute?.("aria-valuenow") || "").trim();
    const ariaMin = String(node.getAttribute?.("aria-valuemin") || "").trim();
    const ariaMax = String(node.getAttribute?.("aria-valuemax") || "").trim();
    const rect = node.getBoundingClientRect?.();
    return {
      tag,
      id: id || "",
      className,
      role,
      type,
      ariaNow,
      ariaMin,
      ariaMax,
      w: rect ? Math.round(rect.width) : 0,
      h: rect ? Math.round(rect.height) : 0,
    };
  }

  function isVolumeTraceNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const role = String(node.getAttribute?.("role") || "").toLowerCase().trim();
    if (role === "slider" || role === "progressbar") return true;
    const tag = String(node.tagName || "").toLowerCase();
    if (tag === "input" && String(node.getAttribute?.("type") || "").toLowerCase().trim() === "range") return true;
    if (node.closest?.("#playerVolume")) return true;
    const className = String(node.className || "");
    if (className.includes("noUi-")) return true;
    return false;
  }

  function getVolumeTraceTarget(event) {
    const rawTarget = event?.target;
    if (isVolumeTraceNode(rawTarget)) return rawTarget;
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (isVolumeTraceNode(item)) return item;
    }
    return null;
  }

  function flushVolumeTrace(reason = "batch") {
    if (!volumeTrace.events.length) return;
    const events = volumeTrace.events.splice(0, volumeTrace.events.length);
    emitDiagnostic(
      "web_media.volume_trace",
      {
        reason,
        events,
      },
      {
        key: "web_media.volume_trace.flush",
      }
    );
  }

  function scheduleVolumeTraceFlush(reason = "batch") {
    if (volumeTrace.flushTimer) return;
    volumeTrace.flushTimer = window.setTimeout(() => {
      volumeTrace.flushTimer = null;
      flushVolumeTrace(reason);
    }, 300);
  }

  function pushVolumeTraceEvent(event, target) {
    if (!volumeTrace.enabled) return;
    const type = String(event?.type || "").trim().toLowerCase();
    if (!type) return;

    const slider = target?.closest?.('[role="slider"], input[type="range"], #playerVolume [role="slider"]') || target;
    const details = {
      type,
      trusted: Boolean(event?.isTrusted),
      x: Number.isFinite(Number(event?.clientX)) ? Math.round(Number(event.clientX)) : null,
      y: Number.isFinite(Number(event?.clientY)) ? Math.round(Number(event.clientY)) : null,
      buttons: Number.isFinite(Number(event?.buttons)) ? Number(event.buttons) : null,
      pointerType: String(event?.pointerType || "").trim().toLowerCase() || "",
      target: describeVolumeNode(target),
      slider: describeVolumeNode(slider),
      at: Date.now(),
    };

    volumeTrace.events.push(details);
    if (volumeTrace.events.length >= 16 || type === "mouseup" || type === "pointerup" || type === "change") {
      flushVolumeTrace("edge");
      return;
    }
    scheduleVolumeTraceFlush("timer");
  }

  function stopVolumeTraceMonitor() {
    if (volumeTrace.flushTimer) {
      window.clearTimeout(volumeTrace.flushTimer);
      volumeTrace.flushTimer = null;
    }
    if (typeof volumeTrace.cleanup === "function") {
      try {
        volumeTrace.cleanup();
      } catch (_) {
        // no-op
      }
      volumeTrace.cleanup = null;
    }
    flushVolumeTrace("stop");
    volumeTrace.enabled = false;
  }

  function startVolumeTraceMonitor() {
    if (volumeTrace.enabled) return;
    if (adapter.id !== "web-media") return;
    if (!debugMode || !contextAlive) return;

    const watchedEvents = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "input",
      "change",
    ];
    const onEvent = (event) => {
      if (!contextAlive || !volumeTrace.enabled) return;
      const target = getVolumeTraceTarget(event);
      if (!target) return;
      pushVolumeTraceEvent(event, target);
    };

    for (const eventName of watchedEvents) {
      document.addEventListener(eventName, onEvent, true);
    }

    volumeTrace.cleanup = () => {
      for (const eventName of watchedEvents) {
        document.removeEventListener(eventName, onEvent, true);
      }
    };
    volumeTrace.enabled = true;
    emitDiagnostic("web_media.volume_trace_state", { enabled: true });
  }

  function syncVolumeTraceMonitor() {
    const shouldEnable = adapter.id === "web-media" && debugMode && contextAlive;
    if (shouldEnable) {
      startVolumeTraceMonitor();
      return;
    }
    stopVolumeTraceMonitor();
  }

  function isContextInvalidatedMessage(message) {
    return /extension context invalidated/i.test(String(message || ""));
  }

  function stopContext(reason, details) {
    if (!contextAlive) return;
    contextAlive = false;
    pendingRefresh = false;

    if (monitoringActive) {
      try {
        sendRemove("context_stop");
      } catch (_) {
        // no-op
      }
    }

    if (teardown) {
      try {
        teardown();
      } catch (_) {
        // no-op
      }
      teardown = null;
    }
    stopVolumeTraceMonitor();
    monitoringActive = false;

    debugLog("context stopped", {
      reason,
      details,
      href: location.href,
    });
  }

  function isTrackingEnabledFromSettings(settings) {
    if (!settings || typeof settings !== "object") return true;
    if (typeof settings.trackingEnabled === "boolean") return settings.trackingEnabled;
    if (typeof settings.engineEnabled === "boolean") return settings.engineEnabled;
    return true;
  }

  function isGenericWebInjectionAllowedFromSettings(settings) {
    if (!settings || typeof settings !== "object") return true;
    if (typeof settings.allowGenericWebInjection === "boolean") {
      return settings.allowGenericWebInjection;
    }
    return true;
  }

  function canMonitorCurrentAdapter() {
    if (!trackingEnabled) return false;
    if (adapter.id === "web-media" && !allowGenericWebInjection) return false;
    return true;
  }

  async function loadDebugMode() {
    if (!chrome?.storage?.sync?.get) return;

    try {
      const raw = await chrome.storage.sync.get({
        settings: {
          debugMode: false,
          trackingEnabled: true,
          engineEnabled: true,
          allowGenericWebInjection: true,
          sourceMinDurationSecMap: {},
          webMediaMinDurationSec: undefined,
        },
      });
      debugMode = Boolean(raw?.settings?.debugMode);
      trackingEnabled = isTrackingEnabledFromSettings(raw?.settings);
      allowGenericWebInjection = isGenericWebInjectionAllowedFromSettings(raw?.settings);
      sourceMinDurationSecMap = mapFromSettings(raw?.settings);
      sourceMinDurationSec = resolveCurrentSourceMinDuration({
        sourceMinDurationSecMap,
      });
      context.sourceMinDurationSec = sourceMinDurationSec;
      debugLog("debug mode loaded", { debugMode });
      debugLog("tracking mode loaded", { trackingEnabled });
      debugLog("generic injection mode loaded", { allowGenericWebInjection });
      debugLog("source short video threshold loaded", {
        sourceId: adapterSourceId,
        sourceMinDurationSec,
      });
      syncVolumeTraceMonitor();
    } catch (_) {
      // no-op
    }
  }

  function startMonitoring() {
    if (!contextAlive || monitoringActive || !canMonitorCurrentAdapter()) return;
    teardown = adapter.attach(context, refresh);
    monitoringActive = true;
    refresh("init");
    debugLog("monitoring started");
  }

  function stopMonitoring(reason = "disabled") {
    if (!monitoringActive) return;
    sendRemove(reason);
    if (teardown) {
      try {
        teardown();
      } catch (_) {
        // no-op
      }
      teardown = null;
    }
    monitoringActive = false;
    pendingRefresh = false;
    debugLog("monitoring stopped", { reason });
  }

  function bindDebugModeWatcher() {
    if (!chrome?.storage?.onChanged?.addListener) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.settings) return;

      const nextDebugMode = Boolean(changes.settings.newValue?.debugMode);
      if (nextDebugMode !== debugMode) {
        debugMode = nextDebugMode;
        debugLog("debug mode changed", { debugMode });
        syncVolumeTraceMonitor();
      }

      const nextTrackingEnabled = isTrackingEnabledFromSettings(changes.settings.newValue);
      const nextAllowGenericWebInjection = isGenericWebInjectionAllowedFromSettings(
        changes.settings.newValue
      );
      const nextSourceMinDurationSecMap = mapFromSettings(changes.settings.newValue);
      const nextSourceMinDurationSec = resolveCurrentSourceMinDuration({
        sourceMinDurationSecMap: nextSourceMinDurationSecMap,
      });
      const trackingChanged = nextTrackingEnabled !== trackingEnabled;
      const genericChanged = nextAllowGenericWebInjection !== allowGenericWebInjection;
      const sourceMinDurationChanged = nextSourceMinDurationSec !== sourceMinDurationSec;
      if (!trackingChanged && !genericChanged && !sourceMinDurationChanged) return;

      trackingEnabled = nextTrackingEnabled;
      allowGenericWebInjection = nextAllowGenericWebInjection;
      sourceMinDurationSecMap = nextSourceMinDurationSecMap;
      sourceMinDurationSec = nextSourceMinDurationSec;
      context.sourceMinDurationSec = sourceMinDurationSec;

      if (canMonitorCurrentAdapter()) {
        startMonitoring();
      } else {
        const stopReason = trackingEnabled ? "generic_injection_disabled" : "tracking_disabled";
        stopMonitoring(stopReason);
      }
      debugLog("tracking mode changed", {
        trackingEnabled,
        allowGenericWebInjection,
        sourceId: adapterSourceId,
        sourceMinDurationSec,
      });
    });
  }

  function safeSendMessage(payload, label) {
    if (!contextAlive) return false;

    if (!isRuntimeReady()) {
      const details = {
        label,
        type: payload?.type,
        runtimeState: typeof chrome === "undefined" ? "chrome_missing" : "runtime_missing",
      };
      warnLog("send skipped: runtime unavailable", details);
      stopContext("runtime_unavailable", details);
      return false;
    }

    try {
      chrome.runtime.sendMessage(payload, () => {
        const runtimeError = chrome.runtime?.lastError;
        if (!runtimeError) {
          debugLog("send ok", { label, type: payload?.type });
          return;
        }

        const message = String(runtimeError.message || runtimeError);
        warnLog("send lastError", {
          label,
          type: payload?.type,
          message,
        });

        if (isContextInvalidatedMessage(message)) {
          stopContext("extension_context_invalidated", message);
        }
      });

      return true;
    } catch (error) {
      const message = String(error || "");
      warnLog("send exception", {
        label,
        type: payload?.type,
        message,
      });

      if (
        isContextInvalidatedMessage(message) ||
        message.includes("Cannot read properties of undefined")
      ) {
        stopContext("send_exception", message);
      }

      return false;
    }
  }

  function buildSnapshot() {
    const rawSnapshot = adapter.readSnapshot(context);
    if (!rawSnapshot) return null;

    const controlCapabilities =
      adapter.getControlCapabilities?.(context) ||
      adapter.controlCapabilities ||
      rawSnapshot.controlCapabilities;

    return normalizeSnapshot({
      ...rawSnapshot,
      sourceId: adapter.id,
      sourceLabel: adapter.label,
      controlCapabilities,
      updatedAt: Date.now(),
    });
  }

  function sendSnapshot(snapshot, reason) {
    if (!contextAlive) return;

    const now = Date.now();
    const fingerprint = snapshotFingerprint(snapshot);
    const minIntervalMs = reason === "timeupdate" ? 250 : 150;

    if (fingerprint === lastFingerprint && now - lastSentAt < minIntervalMs) {
      debugLog("send skipped: fingerprint throttle", { reason, minIntervalMs });
      return;
    }

    lastFingerprint = fingerprint;
    lastSentAt = now;
    hadSnapshot = true;
    removeSent = false;

    safeSendMessage(
      {
        type: MSG.SOURCE_UPDATE,
        providerId: adapter.id,
        contextStartedAt,
        snapshot,
      },
      "source_update"
    );
  }

  function sendRemove(reason = "missing") {
    if (!contextAlive || !hadSnapshot || removeSent) return;
    removeSent = true;
    hadSnapshot = false;

    safeSendMessage(
      {
        type: MSG.SOURCE_REMOVE,
        providerId: adapter.id,
        contextStartedAt,
        reason,
      },
      "source_remove"
    );
  }

  function refresh(reason = "event") {
    if (!contextAlive || !monitoringActive || pendingRefresh) return;
    pendingRefresh = true;

    Promise.resolve().then(() => {
      pendingRefresh = false;
      if (!contextAlive) return;

      try {
        const snapshot = buildSnapshot();
        if (!snapshot) {
          sendRemove(reason);
          return;
        }

        lastRefreshError = "";
        sendSnapshot(snapshot, reason);
      } catch (error) {
        const message = String(error || "");
        if (message && message !== lastRefreshError) {
          lastRefreshError = message;
          warnLog("refresh failed", {
            message,
            reason,
            href: location.href,
          });
        }
      }
    });
  }

  void loadDebugMode().then(() => {
    if (canMonitorCurrentAdapter()) startMonitoring();
  });
  bindDebugModeWatcher();

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!contextAlive) return;
      if (message?.type !== MSG.CONTROL_EXEC) return;
      if (message?.sourceId && message.sourceId !== adapter.id) return;
      if (!monitoringActive) {
        sendResponse({ ok: false, message: "tracking disabled" });
        return;
      }

      debugLog("control request", {
        action: message.action,
        value: message.value,
      });

      if (!adapter.supportsControls(message.action, context)) {
        sendResponse({
          ok: false,
          reason: "unsupported",
          unsupportedReason: "capability-missing",
          path: "unsupported",
          message: `unsupported action ${message.action}`,
        });
        return;
      }

      adapter
        .execute(message.action, message.value, context)
        .then((result) => {
          debugLog("control result", {
            action: message.action,
            value: message.value,
            result,
          });
          refresh("control");
          sendResponse(result);
        })
        .catch((error) => {
          warnLog("control failed", {
            action: message.action,
            value: message.value,
            message: String(error),
          });
          sendResponse({ ok: false, message: String(error) });
        });

      return true;
    });
  }

  window.addEventListener("pagehide", (event) => {
    if (event?.persisted) return;
    stopMonitoring("pagehide");
  });

  // Some embedded documents disallow `unload` via Permissions Policy.
  // `pagehide` covers modern browsers, so keep `unload` only as legacy fallback.
  if (!("onpagehide" in window)) {
    window.addEventListener("unload", () => {
      stopMonitoring("unload");
    });
  }
}
