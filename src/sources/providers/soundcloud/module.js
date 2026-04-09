import { attrOf, q, textOf } from "@/sources/shared/dom";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { executeBridgeControl } from "@/sources/shared/bridgeControl";
import { inferTimesFromText, parseClockToSec } from "@/sources/shared/time";
import { collapseSpaces } from "@/sources/shared/text";
import { createSoundCloudBridge } from "@/content/soundcloudBridge";

function normalizeSoundCloudText(text) {
  return collapseSpaces(text).replace(/\bverified\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

function debug(context, event, payload) {
  context?.debugLog?.(`soundcloud ${event}`, payload);
}

const PATHS = {
  BRIDGE: "soundcloud-bridge",
  SEEK_UI: "soundcloud-seek-ui",
  SEEK_MEDIA: "soundcloud-seek-media",
  NEXT_BUTTON: "soundcloud-next-button",
  PREVIOUS_BUTTON: "soundcloud-previous-button",
};

const CONTROL_SELECTORS = {
  playPause: ".playControls__play, .soundTitle__playButton .playButton, a.playButton",
  next: ".playControls__next, .skipControl__next",
  previous: ".playControls__prev, .skipControl__previous",
  muteToggle: ".volume__button",
};

const BRIDGE_MESSAGES = {
  unavailable: {
    [AUDIO_ACTIONS.VOLUME]: "soundcloud bridge unavailable for volume",
    [AUDIO_ACTIONS.MUTE]: "soundcloud bridge unavailable for mute",
    [AUDIO_ACTIONS.UNMUTE]: "soundcloud bridge unavailable for unmute",
    [AUDIO_ACTIONS.MUTE_TOGGLE]: "soundcloud bridge unavailable for muteToggle",
  },
  failed: {
    [AUDIO_ACTIONS.VOLUME]: "soundcloud bridge volume failed",
    [AUDIO_ACTIONS.MUTE]: "soundcloud bridge mute failed",
    [AUDIO_ACTIONS.UNMUTE]: "soundcloud bridge unmute failed",
    [AUDIO_ACTIONS.MUTE_TOGGLE]: "soundcloud bridge muteToggle failed",
  },
};

const TRANSPORT_CONFIG = {
  [TRANSPORT_ACTIONS.NEXT]: {
    selector: CONTROL_SELECTORS.next,
    okPath: PATHS.NEXT_BUTTON,
    failMessage: "soundcloud next unavailable",
  },
  [TRANSPORT_ACTIONS.PREVIOUS]: {
    selector: CONTROL_SELECTORS.previous,
    okPath: PATHS.PREVIOUS_BUTTON,
    failMessage: "soundcloud previous unavailable",
  },
};

const SOUNDCLOUD_TRACK_LINK_SELECTORS = [
  "a.playbackSoundBadge__titleLink[href]",
  "a.soundTitle__title[href]",
  "a[href*='soundcloud.com/'][href]",
];

const RESERVED_ROOT_SEGMENTS = new Set([
  "discover",
  "stream",
  "you",
  "search",
  "charts",
  "upload",
  "library",
  "sets",
  "stations",
  "tags",
  "genres",
  "messages",
  "notifications",
  "home",
]);

const RESERVED_SECOND_SEGMENTS = new Set([
  "sets",
  "likes",
  "tracks",
  "albums",
  "reposts",
  "spotlight",
]);

function parseSoundCloudLocationUrl(win = window) {
  const locationRef = win?.location || globalThis.location;
  if (!locationRef) return null;

  const href = String(locationRef.href || "").trim();
  if (href) {
    try {
      return new URL(href);
    } catch (_) {
      // try fallback below
    }
  }

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "soundcloud.com";
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

function normalizeSoundCloudTrackPath(pathname = "") {
  const parts = String(pathname || "")
    .split("/")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";

  const root = String(parts[0] || "").toLowerCase();
  const second = String(parts[1] || "").toLowerCase();
  if (RESERVED_ROOT_SEGMENTS.has(root)) return "";
  if (RESERVED_SECOND_SEGMENTS.has(second)) return "";

  return `/${parts[0]}/${parts[1]}`;
}

function normalizeSoundCloudTrackUrl(rawUrl, win = window) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    const base = parseSoundCloudLocationUrl(win)?.toString() || "https://soundcloud.com/";
    parsed = new URL(raw, base);
  } catch (_) {
    return "";
  }

  if (!/(^|\.)soundcloud\.com$/i.test(parsed.hostname)) return "";
  const path = normalizeSoundCloudTrackPath(parsed.pathname);
  if (!path) return "";
  return `https://soundcloud.com${path}`;
}

function resolveSoundCloudTrackUrl(doc = document, win = window) {
  for (const selector of SOUNDCLOUD_TRACK_LINK_SELECTORS) {
    for (const node of doc.querySelectorAll(selector)) {
      const normalized = normalizeSoundCloudTrackUrl(attrOf(node, "href"), win);
      if (normalized) return normalized;
    }
  }

  const fromCanonical = normalizeSoundCloudTrackUrl(attrOf(q('link[rel="canonical"]', doc), "href"), win);
  if (fromCanonical) return fromCanonical;

  const fromOg = normalizeSoundCloudTrackUrl(attrOf(q('meta[property="og:url"]', doc), "content"), win);
  if (fromOg) return fromOg;

  const fromLocation = normalizeSoundCloudTrackUrl(parseSoundCloudLocationUrl(win)?.toString() || "", win);
  if (fromLocation) return fromLocation;

  return "";
}

function dispatchPointerClick(node, clientX, clientY) {
  if (!node) return false;
  const init = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

  if (typeof PointerEvent !== "undefined") {
    node.dispatchEvent(
      new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true })
    );
  }
  node.dispatchEvent(new MouseEvent("mousedown", init));
  node.dispatchEvent(new MouseEvent("click", init));
  node.dispatchEvent(new MouseEvent("mouseup", init));
  if (typeof PointerEvent !== "undefined") {
    node.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
  }

  return true;
}

function seekSoundCloudTimeline(targetSec, doc = document) {
  const timeline = q(".playbackTimeline__progressWrapper[role='progressbar']", doc);
  if (!timeline) return false;

  const durationSec = parseClockToSec(textOf(q(".playbackTimeline__duration", doc)));
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;

  const ratio = Math.max(0, Math.min(1, Number(targetSec) / durationSec));
  const rect = timeline.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;

  const x = rect.left + rect.width * ratio;
  const y = rect.top + rect.height / 2;
  return dispatchPointerClick(timeline, x, y);
}

function extractSoundCloud() {
  const trackUrl = resolveSoundCloudTrackUrl(document, window);
  const timelineNode = q(".playbackTimeline");
  const timelineText = timelineNode ? normalizeSoundCloudText(timelineNode.innerText || timelineNode.textContent) : "";
  const inferredTimes = inferTimesFromText(timelineText);
  const rawPassed = parseClockToSec(textOf(q(".playbackTimeline__timePassed")));
  const rawDuration = parseClockToSec(textOf(q(".playbackTimeline__duration")));

  let positionSec = Number.NaN;
  let durationSec = Number.NaN;
  if (inferredTimes) {
    positionSec = inferredTimes.positionSec;
    durationSec = inferredTimes.durationSec;
  } else {
    if (Number.isFinite(rawPassed)) positionSec = rawPassed;
    if (Number.isFinite(rawDuration)) durationSec = rawDuration;
    if (Number.isFinite(rawDuration) && rawDuration < 0 && Number.isFinite(positionSec) && positionSec >= 0) {
      durationSec = positionSec + Math.abs(rawDuration);
    }
  }

  // Media metadata/state come from MediaSession-first strategy.
  // Keep extractor focused on timeline data only.
  if (!Number.isFinite(positionSec) && !Number.isFinite(durationSec) && !trackUrl) return null;

  return {
    ...(trackUrl ? { trackUrl } : {}),
    ...(Number.isFinite(positionSec) ? { positionSec: Math.max(0, positionSec) } : {}),
    ...(Number.isFinite(durationSec) ? { durationSec: Math.max(0, durationSec) } : {}),
  };
}

async function executeSoundCloudBridgeAction(context, action, value) {
  const hasBridge = Boolean(
    context?.soundcloudBridge && typeof context.soundcloudBridge.execute === "function"
  );
  debug(context, "bridge availability", { action, hasBridge });

  return executeBridgeControl({
    bridge: context?.soundcloudBridge,
    action,
    value,
    context,
    debugPrefix: "soundcloud",
    paths: { bridge: PATHS.BRIDGE },
    unavailableMessage: BRIDGE_MESSAGES.unavailable[action] || "soundcloud bridge unavailable",
    failedMessage: BRIDGE_MESSAGES.failed[action] || "soundcloud bridge control failed",
  });
}

function executeSoundCloudBridgeAudioAction(context, action, value) {
  return executeSoundCloudBridgeAction(context, action, value);
}

function executeSoundCloudSeek(doc, targetSec) {
  const mediaList = [...doc.querySelectorAll("audio,video")];
  const viaSoundCloudUi = seekSoundCloudTimeline(targetSec, doc);
  if (viaSoundCloudUi) return ok(PATHS.SEEK_UI);

  if (mediaList.length) {
    for (const media of mediaList) {
      const duration = Number.isFinite(media.duration) ? media.duration : targetSec;
      media.currentTime = Math.max(0, Math.min(duration, targetSec));
    }
    return ok(PATHS.SEEK_MEDIA);
  }

  return null;
}

function isControlDisabled(node) {
  if (!node) return true;
  const ariaDisabled = String(attrOf(node, "aria-disabled") || "").toLowerCase();
  if (ariaDisabled === "true") return true;
  if (node.hasAttribute?.("disabled")) return true;
  const className = String(node.className || "").toLowerCase();
  return className.includes("disabled");
}

function clickSoundCloudControl(doc, selector) {
  const node = q(selector, doc);
  if (!node || isControlDisabled(node)) return false;
  node.click();
  return true;
}

function executeSoundCloudTransport(doc, action) {
  const config = TRANSPORT_CONFIG[action];
  if (!config) return null;

  const didClick = clickSoundCloudControl(doc, config.selector);
  return didClick ? ok(config.okPath) : fail(config.failMessage);
}

function createSoundCloudControlHandlers(doc, context, value) {
  return {
    [AUDIO_ACTIONS.SEEK]: () => {
      const targetSec = Number(value);
      if (!Number.isFinite(targetSec)) return fail("invalid seek");
      return executeSoundCloudSeek(doc, targetSec);
    },
    [AUDIO_ACTIONS.VOLUME]: () => {
      const volume = Number(value);
      if (!Number.isFinite(volume)) return fail("invalid volume");
      return executeSoundCloudBridgeAudioAction(context, AUDIO_ACTIONS.VOLUME, volume);
    },
    [AUDIO_ACTIONS.MUTE]: () =>
      executeSoundCloudBridgeAudioAction(context, AUDIO_ACTIONS.MUTE),
    [AUDIO_ACTIONS.UNMUTE]: () =>
      executeSoundCloudBridgeAudioAction(context, AUDIO_ACTIONS.UNMUTE),
    [AUDIO_ACTIONS.MUTE_TOGGLE]: () =>
      executeSoundCloudBridgeAudioAction(context, AUDIO_ACTIONS.MUTE_TOGGLE),
    [TRANSPORT_ACTIONS.NEXT]: () =>
      executeSoundCloudTransport(doc, TRANSPORT_ACTIONS.NEXT),
    [TRANSPORT_ACTIONS.PREVIOUS]: () =>
      executeSoundCloudTransport(doc, TRANSPORT_ACTIONS.PREVIOUS),
  };
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  meta: {
    id: "soundcloud",
    label: "SoundCloud",
    sender: "SC",
    hosts: ["soundcloud.com", "www.soundcloud.com"],
    controlRoot: ".playControls",
    controls: CONTROL_SELECTORS,
    controlCapabilities: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: true,
    }),
    mediaElementFallback: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: false,
      transportOverrides: {
        [TRANSPORT_ACTIONS.NEXT]: false,
        [TRANSPORT_ACTIONS.PREVIOUS]: false,
      },
      audioOverrides: {
        [AUDIO_ACTIONS.SEEK]: true,
      },
    }),
  },
  extract: extractSoundCloud,
  control: {
    async execute(action, value, context) {
      const doc = context?.document || document;
      return dispatchAction(action, createSoundCloudControlHandlers(doc, context, value));
    },
  },
  runtime: {
    init(context) {
      const bridge = createSoundCloudBridge(context);
      context.soundcloudBridge = bridge;
      bridge.init();
      debug(context, "bridge init", { ok: true });
      return () => {
        bridge.destroy();
        delete context.soundcloudBridge;
      };
    },
  },
};

export default sourceModule;
