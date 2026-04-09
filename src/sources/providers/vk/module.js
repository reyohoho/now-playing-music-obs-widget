import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { executeBridgeControl } from "@/sources/shared/bridgeControl";
import { attrOf, firstNonEmptySrc, qAll } from "@/sources/shared/dom";
import { collapseSpaces } from "@/sources/shared/text";
import { createVkBridge } from "@/content/vkBridge";

const PATHS = {
  BRIDGE: "vk-bridge",
  PLAY: "vk-api-play",
  PAUSE: "vk-api-pause",
  TOGGLE: "vk-api-toggle",
  NEXT: "vk-api-next",
  PREVIOUS: "vk-api-previous",
  SEEK_SLIDER: "vk-api-seek-slider",
  SEEK_TIME: "vk-api-seek-time",
  VOLUME: "vk-api-volume",
  MUTE: "vk-api-mute",
  UNMUTE: "vk-api-unmute",
  MUTE_TOGGLE: "vk-api-mute-toggle",
};

const VK_VOLUME_MODE = {
  LINEAR: "linear",
  LOG34: "log34",
};

// Active mapping mode for VK slider/value conversion.
// Keep LOG34 as default: it matches VK UI slider behavior.
const VK_VOLUME_MODE_DEFAULT = VK_VOLUME_MODE.LOG34;

const VK_VOLUME_CURVE_LOG34 = {
  FACTOR: 34,
  DENOM: Math.log(35),
};

function asFiniteInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
}

function buildVkTrackUrlFromIds(ownerId, audioId) {
  const owner = asFiniteInt(ownerId);
  const track = asFiniteInt(audioId);
  if (!Number.isFinite(owner) || !Number.isFinite(track) || track <= 0) return "";
  return `https://vk.com/audio${owner}_${track}`;
}

function parseVkIdsFromText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch (_) {
      return text;
    }
  })();

  const match = decoded.match(/audio(-?\d+)_([0-9]+)/i);
  if (!match) return null;

  const ownerId = asFiniteInt(match[1]);
  const audioId = asFiniteInt(match[2]);
  if (!Number.isFinite(ownerId) || !Number.isFinite(audioId) || audioId <= 0) return null;
  return { ownerId, audioId };
}

function parseVkIdsFromTuple(tuple) {
  if (!Array.isArray(tuple)) return null;
  const ownerId = asFiniteInt(tuple[1]);
  const audioId = asFiniteInt(tuple[0]);
  if (!Number.isFinite(ownerId) || !Number.isFinite(audioId) || audioId <= 0) return null;
  return { ownerId, audioId };
}

function parseVkIdsFromObject(value) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return null;

  const candidates = [
    [source.owner_id, source.id],
    [source.ownerId, source.id],
    [source.owner_id, source.audio_id],
    [source.ownerId, source.audioId],
    [source.oid, source.id],
    [source.owner, source.id],
  ];

  for (const [ownerRaw, audioRaw] of candidates) {
    const ownerId = asFiniteInt(ownerRaw);
    const audioId = asFiniteInt(audioRaw);
    if (!Number.isFinite(ownerId) || !Number.isFinite(audioId) || audioId <= 0) continue;
    return { ownerId, audioId };
  }

  return null;
}

function parseVkLocationUrl(win = window) {
  const locationRef = win?.location || globalThis.location;
  if (!locationRef) return null;

  const href = String(locationRef.href || "").trim();
  if (href) {
    try {
      return new URL(href);
    } catch (_) {
      // fallback below
    }
  }

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "vk.com";
  const pathname = String(locationRef.pathname || "/").trim() || "/";
  const rawSearch = String(locationRef.search || "").trim();
  const search = rawSearch
    ? rawSearch.startsWith("?")
      ? rawSearch
      : `?${rawSearch}`
    : "";
  try {
    return new URL(`https://${hostname}${pathname}${search}`);
  } catch (_) {
    return null;
  }
}

function normalizeVkTrackUrl(rawUrl, win = window) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    const base = parseVkLocationUrl(win)?.toString() || "https://vk.com/";
    parsed = new URL(raw, base);
  } catch (_) {
    return "";
  }

  if (!/(^|\.)vk\.com$/i.test(parsed.hostname)) return "";

  const fromCandidates = [
    parsed.pathname,
    parsed.searchParams.get("z"),
    parsed.searchParams.get("w"),
    parsed.searchParams.get("q"),
    String(parsed.hash || "").replace(/^#/, ""),
  ];

  for (const value of fromCandidates) {
    const ids = parseVkIdsFromText(value);
    if (!ids) continue;
    return buildVkTrackUrlFromIds(ids.ownerId, ids.audioId);
  }

  return "";
}

function resolveVkTrackUrl({
  bridgeSnapshot = null,
  currentData = null,
  currentTuple = null,
  doc = document,
  win = window,
} = {}) {
  const fromBridge = normalizeVkTrackUrl(bridgeSnapshot?.trackUrl, win);
  if (fromBridge) return fromBridge;

  const idCandidates = [
    parseVkIdsFromObject(bridgeSnapshot),
    parseVkIdsFromObject(currentData),
    parseVkIdsFromTuple(currentTuple),
  ];

  for (const ids of idCandidates) {
    if (!ids) continue;
    const built = buildVkTrackUrlFromIds(ids.ownerId, ids.audioId);
    if (built) return built;
  }

  const roots = [
    doc.querySelector('[data-testid="TopAudioPlayer"]'),
    doc.querySelector('[class*="TopAudioPlayer"]'),
    doc.querySelector('[class*="vkitAudioRow__wrapperActivated"]'),
    doc,
  ].filter(Boolean);

  for (const root of roots) {
    for (const link of qAll('a[href*="audio"][href]', root)) {
      const normalized = normalizeVkTrackUrl(attrOf(link, "href"), win);
      if (normalized) return normalized;
    }
  }

  return normalizeVkTrackUrl(parseVkLocationUrl(win)?.toString() || "", win);
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Number.NaN;
  return Math.max(0, Math.min(1, num));
}

function vkLinearToUiVolume(value) {
  const linear = clamp01(value);
  if (!Number.isFinite(linear)) return Number.NaN;
  if (VK_VOLUME_MODE_DEFAULT === VK_VOLUME_MODE.LINEAR) return linear;
  return Math.log1p(VK_VOLUME_CURVE_LOG34.FACTOR * linear) / VK_VOLUME_CURVE_LOG34.DENOM;
}

function vkUiToLinearVolume(value) {
  const ui = clamp01(value);
  if (!Number.isFinite(ui)) return Number.NaN;
  if (VK_VOLUME_MODE_DEFAULT === VK_VOLUME_MODE.LINEAR) return ui;
  return Math.expm1(VK_VOLUME_CURVE_LOG34.DENOM * ui) / VK_VOLUME_CURVE_LOG34.FACTOR;
}

function vkGetApiPlayer(win = window) {
  const ap = win?.ap;
  if (!ap || typeof ap !== "object") return null;
  if (typeof ap.getCurrentAudioData !== "function" && typeof ap.getCurrentAudio !== "function") return null;
  return ap;
}

function vkSafeCall(player, method, ...args) {
  const fn = player?.[method];
  if (typeof fn !== "function") return undefined;

  try {
    return fn.apply(player, args);
  } catch (_) {
    return undefined;
  }
}

function vkCollapseText(s) {
  return collapseSpaces(s);
}

function vkCoverFromDom(doc = document) {
  return (
    firstNonEmptySrc([
      doc.querySelector('[class*="vkitAudioRow__wrapperActivated"] img[src]'),
      doc.querySelector('[data-testid="TopAudioPlayer"] img[src]'),
      doc.querySelector('[class*="TopAudioPlayer"] img[src]'),
    ]) || ""
  );
}

function vkExtractFromApi(context = {}) {
  const doc = context?.document || document;
  const win = context?.window || window;
  const bridge = context?.vkBridge;
  if (bridge?.requestSnapshot) {
    void bridge.requestSnapshot();
  }

  const bridgeSnapshot = bridge?.getSnapshot?.();
  if (bridgeSnapshot && typeof bridgeSnapshot === "object") {
    const bridgeCover = String(bridgeSnapshot.coverUrl || "").trim();
    const domCover = vkCoverFromDom(doc);
    const coverUrl = bridgeCover || domCover;

    const bridgeLinearVolume = Number(bridgeSnapshot.volume);
    const bridgeUiVolume = vkLinearToUiVolume(bridgeLinearVolume);
    const trackUrl = resolveVkTrackUrl({
      bridgeSnapshot,
      doc,
      win,
    });

    return {
      ...(bridgeSnapshot.title ? { title: vkCollapseText(bridgeSnapshot.title) } : {}),
      ...(bridgeSnapshot.artist ? { artist: vkCollapseText(bridgeSnapshot.artist) } : {}),
      ...(trackUrl ? { trackUrl } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(Number.isFinite(Number(bridgeSnapshot.durationSec))
        ? { durationSec: Math.max(0, Number(bridgeSnapshot.durationSec)) }
        : {}),
      ...(Number.isFinite(Number(bridgeSnapshot.positionSec))
        ? { positionSec: Math.max(0, Number(bridgeSnapshot.positionSec)) }
        : {}),
      ...(Number.isFinite(bridgeUiVolume)
        ? { volume: bridgeUiVolume }
        : {}),
      ...(typeof bridgeSnapshot.muted === "boolean" ? { muted: bridgeSnapshot.muted } : {}),
      ...(bridgeSnapshot.playbackState ? { playbackState: bridgeSnapshot.playbackState } : {}),
    };
  }

  const ap = vkGetApiPlayer(win);
  if (!ap) return null;

  const currentData = vkSafeCall(ap, "getCurrentAudioData");
  const currentTuple = vkSafeCall(ap, "getCurrentAudio");

  const title = vkCollapseText(currentData?.title || (Array.isArray(currentTuple) ? currentTuple[3] : ""));
  const artist = vkCollapseText(
    currentData?.author?.raw || (Array.isArray(currentTuple) ? currentTuple[4] : "")
  );

  const durationRaw = Number(vkSafeCall(ap, "getCurrentDuration"));
  const progressTimeRaw = Number(vkSafeCall(ap, "getCurrentProgressTime"));
  const progressRaw = Number(vkSafeCall(ap, "getCurrentProgress"));
  const volumeRaw = Number(vkSafeCall(ap, "getVolume"));
  const volumeUi = vkLinearToUiVolume(volumeRaw);
  const mutedRaw = vkSafeCall(ap, "getMuted");
  const isPlayingRaw = vkSafeCall(ap, "isPlaying");
  const isPausedRaw = vkSafeCall(ap, "isPaused");

  let durationSec = Number.NaN;
  let positionSec = Number.NaN;

  if (Number.isFinite(durationRaw) && durationRaw > 0) durationSec = durationRaw;
  if (Number.isFinite(progressTimeRaw) && progressTimeRaw >= 0) positionSec = progressTimeRaw / 1000;

  if (!Number.isFinite(positionSec) && Number.isFinite(progressRaw) && Number.isFinite(durationSec)) {
    positionSec = Math.max(0, Math.min(durationSec, durationSec * progressRaw));
  }

  if (!Number.isFinite(durationSec) && Number.isFinite(progressRaw) && progressRaw > 0 && Number.isFinite(positionSec)) {
    durationSec = positionSec / progressRaw;
  }

  const coverUrl = vkCoverFromDom(doc);
  const trackUrl = resolveVkTrackUrl({
    bridgeSnapshot,
    currentData,
    currentTuple,
    doc,
    win,
  });

  let playbackState = "";
  if (isPlayingRaw === true) playbackState = "playing";
  else if (isPausedRaw === true) playbackState = "paused";

  const hasMeaningfulData =
    Boolean(title || artist || coverUrl) || Number.isFinite(durationSec) || Number.isFinite(positionSec);
  if (!hasMeaningfulData) return null;

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(trackUrl ? { trackUrl } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(Number.isFinite(durationSec) ? { durationSec } : {}),
    ...(Number.isFinite(positionSec) ? { positionSec } : {}),
    ...(Number.isFinite(volumeUi) ? { volume: volumeUi } : {}),
    ...(typeof mutedRaw === "boolean" ? { muted: mutedRaw } : {}),
    ...(playbackState ? { playbackState } : {}),
  };
}

function extractVK(context = {}) {
  return vkExtractFromApi(context);
}

function callVk(player, method, ...args) {
  const fn = player?.[method];
  if (typeof fn !== "function") return undefined;

  try {
    return fn.apply(player, args);
  } catch (_) {
    return undefined;
  }
}

async function callVkFirst(player, methods, ...args) {
  for (const method of methods) {
    const fn = player?.[method];
    if (typeof fn !== "function") continue;

    let result;
    try {
      result = fn.apply(player, args);
    } catch (_) {
      continue;
    }

    if (result && typeof result.then === "function") {
      try {
        await result;
      } catch (_) {
        // VK internals can reject during race conditions.
      }
    }

    return true;
  }

  return false;
}

function vkBoolState(player, method) {
  const result = callVk(player, method);
  return typeof result === "boolean" ? result : null;
}

const vkSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureVkPlaybackState(player, targetState) {
  const isPlaying = () => vkBoolState(player, "isPlaying") === true;
  const isPaused = () => vkBoolState(player, "isPaused") === true;

  if (targetState === "playing") {
    if (isPlaying()) return true;

    const preferResume = isPaused();
    const methods = preferResume
      ? ["resume", "playByButton", "play"]
      : ["playByButton", "play", "resume"];

    for (const method of methods) {
      const called = await callVkFirst(player, [method]);
      if (!called) continue;
      await vkSleep(140);
      if (isPlaying()) return true;
    }

    return isPlaying();
  }

  if (targetState === "paused") {
    if (isPaused()) return true;

    for (const method of ["pauseByButton", "pause"]) {
      const called = await callVkFirst(player, [method]);
      if (!called) continue;
      await vkSleep(120);
      if (isPaused() || !isPlaying()) return true;
    }

    return isPaused() || !isPlaying();
  }

  return false;
}

function resultFromBool(value, message, path) {
  return value ? ok(path) : fail(message);
}

function createVkControlHandlers(ap, value) {
  return {
    [TRANSPORT_ACTIONS.PLAY]: async () => {
      const isOk = await ensureVkPlaybackState(ap, "playing");
      return resultFromBool(isOk, "vk play unavailable", PATHS.PLAY);
    },
    [TRANSPORT_ACTIONS.PAUSE]: async () => {
      const isOk = await ensureVkPlaybackState(ap, "paused");
      return resultFromBool(isOk, "vk pause unavailable", PATHS.PAUSE);
    },
    [TRANSPORT_ACTIONS.TOGGLE]: async () => {
      const isPlaying = vkBoolState(ap, "isPlaying");
      const isPaused = vkBoolState(ap, "isPaused");

      if (isPlaying === true) {
        const isOk = await ensureVkPlaybackState(ap, "paused");
        return resultFromBool(isOk, "vk toggle unavailable", PATHS.TOGGLE);
      }

      if (isPaused === true) {
        const isOk = await ensureVkPlaybackState(ap, "playing");
        return resultFromBool(isOk, "vk toggle unavailable", PATHS.TOGGLE);
      }

      const isOk = await ensureVkPlaybackState(ap, "playing");
      return resultFromBool(isOk, "vk toggle unavailable", PATHS.TOGGLE);
    },
    [TRANSPORT_ACTIONS.NEXT]: async () => {
      const isOk = await callVkFirst(ap, ["playNextByButton", "playNext"]);
      return resultFromBool(isOk, "vk next unavailable", PATHS.NEXT);
    },
    [TRANSPORT_ACTIONS.PREVIOUS]: async () => {
      const isOk = await callVkFirst(ap, ["playPrevByButton", "playPrev"]);
      return resultFromBool(isOk, "vk previous unavailable", PATHS.PREVIOUS);
    },
    [AUDIO_ACTIONS.SEEK]: async () => {
      const target = Number(value);
      if (!Number.isFinite(target)) return fail("invalid seek");

      const duration = Number(callVk(ap, "getCurrentDuration"));
      if (Number.isFinite(duration) && duration > 0) {
        const ratio = Math.max(0, Math.min(1, target / duration));
        const bySlider = await callVkFirst(ap, ["seekBySlider", "seek"], ratio);
        if (bySlider) return ok(PATHS.SEEK_SLIDER);
      }

      const direct = await callVkFirst(ap, ["seekToTime"], Math.max(0, target), "now_playing_extension");
      if (direct) return ok(PATHS.SEEK_TIME);

      return fail("vk seek unavailable");
    },
    [AUDIO_ACTIONS.VOLUME]: async () => {
      const target = Number(value);
      if (!Number.isFinite(target)) return fail("invalid volume");
      const linearTarget = vkUiToLinearVolume(target);
      if (!Number.isFinite(linearTarget)) return fail("invalid volume");
      const isOk = await callVkFirst(ap, ["setVolume"], linearTarget);
      return resultFromBool(isOk, "vk volume unavailable", PATHS.VOLUME);
    },
    [AUDIO_ACTIONS.MUTE]: async () => {
      const isOk = await callVkFirst(ap, ["toggleMuted"], true);
      return resultFromBool(isOk, "vk mute unavailable", PATHS.MUTE);
    },
    [AUDIO_ACTIONS.UNMUTE]: async () => {
      const isOk = await callVkFirst(ap, ["toggleMuted"], false);
      return resultFromBool(isOk, "vk unmute unavailable", PATHS.UNMUTE);
    },
    [AUDIO_ACTIONS.MUTE_TOGGLE]: async () => {
      const currentMuted = callVk(ap, "getMuted");
      if (typeof currentMuted === "boolean") {
        const isOk = await callVkFirst(ap, ["toggleMuted"], !currentMuted);
        return resultFromBool(isOk, "vk mute toggle unavailable", PATHS.MUTE_TOGGLE);
      }

      const isOk = await callVkFirst(ap, ["toggleMuted"]);
      return resultFromBool(isOk, "vk mute toggle unavailable", PATHS.MUTE_TOGGLE);
    },
  };
}

async function executeVkBridgeControl(action, value, context) {
  const bridgeValue = action === AUDIO_ACTIONS.VOLUME ? vkUiToLinearVolume(value) : value;
  const bridgeResult = await executeBridgeControl({
    bridge: context?.vkBridge,
    action,
    value: bridgeValue,
    context,
    debugPrefix: "vk",
    paths: { bridge: PATHS.BRIDGE },
    unavailableMessage: "vk bridge unavailable",
    failedMessage: "vk bridge control failed",
  });

  // Preserve old behavior: any non-ok bridge response falls back to in-page API.
  return bridgeResult?.ok ? bridgeResult : null;
}

async function executeVkControl(action, value, context) {
  const bridgeResult = await executeVkBridgeControl(action, value, context);
  if (bridgeResult) return bridgeResult;

  const ap = vkGetApiPlayer(context?.window || window);
  if (!ap) return null;
  return dispatchAction(action, createVkControlHandlers(ap, value));
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  meta: {
    id: "vk",
    label: "VK",
    sender: "VK",
    hosts: ["vk.com", "www.vk.com", "m.vk.com"],
    controlRoot: '[data-testid="TopAudioPlayer"], [class*="TopNavigation__player"], [class*="TopAudioPlayer"]',
    controlActionKeywords: {
      playPause: ["воспроиз", "пауза", "play", "pause"],
      previous: ["предыдущ", "previous"],
      next: ["следующ", "next"],
    },
    controls: {
      playPause: '[data-testid="TopAudioPlayer_TogglePlayAction"], [data-testid="audio_player_play"]',
      previous: '[data-testid="TopAudioPlayer_BackwardAction"]',
      next: '[data-testid="TopAudioPlayer_ForwardAction"]',
    },
    controlCapabilities: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: true,
    }),
    mediaElementFallback: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: true,
      transportOverrides: {
        [TRANSPORT_ACTIONS.NEXT]: false,
        [TRANSPORT_ACTIONS.PREVIOUS]: false,
      },
    }),
  },
  extract: extractVK,
  control: {
    execute(action, value, context) {
      return executeVkControl(action, value, context);
    },
  },
  runtime: {
    init(context, onInvalidate) {
      const bridge = createVkBridge(context);
      context.vkBridge = bridge;
      bridge.init(() => onInvalidate("vk_bridge"));
      void bridge.requestSnapshot();
      return () => {
        bridge.destroy();
        delete context.vkBridge;
      };
    },
  },
};

export default sourceModule;
