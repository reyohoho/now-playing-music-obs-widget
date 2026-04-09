import { collapseSpaces } from "@/sources/shared/text";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { executeBridgeControl } from "@/sources/shared/bridgeControl";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { clamp01 } from "@/sources/shared/number";
import { attrOf, q, qAll } from "@/sources/shared/dom";
import { writePercentToLocalStorage } from "@/sources/shared/storage";
import { createZvukBridge } from "@/content/zvukBridge";

const DESKTOP_VOLUME_KEY = "desktop_volume";
const ZVUK_TRACK_LINK_SELECTORS = ['a[href*="/track/"]', 'a[href*="zvuk.com/track/"]'];
const ZVUK_TRACK_ID_FIELD_NAMES = ["trackId", "track_id", "audioId", "audio_id", "id"];

function normalizeText(value) {
  return collapseSpaces(String(value || ""));
}

function finiteOrNaN(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function parseZvukLocationUrl(win = window) {
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

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "zvuk.com";
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

function normalizeZvukTrackId(rawValue) {
  if (rawValue === null || rawValue === undefined) return "";
  const base = String(rawValue).trim();
  if (!base) return "";

  const decoded = (() => {
    try {
      return decodeURIComponent(base);
    } catch (_) {
      return base;
    }
  })();

  const fromPath = decoded.match(/(?:^|\/)track\/([^/?#&]+)/i);
  if (fromPath) {
    const candidateFromPath = String(fromPath[1] || "").trim();
    if (/^[a-z0-9_-]+$/i.test(candidateFromPath)) return candidateFromPath;
  }

  const candidate = String(decoded)
    .replace(/^#/, "")
    .replace(/^track[:=_-]?/i, "")
    .trim();
  if (!candidate) return "";
  if (!/^[a-z0-9_-]+$/i.test(candidate)) return "";
  return candidate;
}

function buildZvukTrackUrlFromId(rawTrackId) {
  const trackId = normalizeZvukTrackId(rawTrackId);
  if (!trackId) return "";
  return `https://zvuk.com/track/${trackId}`;
}

function normalizeZvukTrackPath(pathname = "") {
  const parts = String(pathname || "")
    .split("/")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!parts.length) return "";

  for (let index = 0; index < parts.length; index += 1) {
    if (String(parts[index] || "").toLowerCase() !== "track") continue;
    const next = normalizeZvukTrackId(parts[index + 1] || "");
    if (next) return `/track/${next}`;
  }

  return "";
}

function normalizeZvukTrackUrl(rawUrl, win = window) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    const base = parseZvukLocationUrl(win)?.toString() || "https://zvuk.com/";
    parsed = new URL(raw, base);
  } catch (_) {
    return "";
  }

  if (!/(^|\.)zvuk\.com$/i.test(parsed.hostname)) return "";

  const fromPath = normalizeZvukTrackPath(parsed.pathname);
  if (fromPath) return `https://zvuk.com${fromPath}`;

  const fromCandidates = [
    parsed.searchParams.get("trackId"),
    parsed.searchParams.get("track_id"),
    parsed.searchParams.get("audioId"),
    parsed.searchParams.get("audio_id"),
    parsed.searchParams.get("id"),
    parsed.searchParams.get("z"),
    parsed.searchParams.get("w"),
    parsed.searchParams.get("q"),
    String(parsed.hash || "").replace(/^#/, ""),
  ];

  for (const value of fromCandidates) {
    const built = buildZvukTrackUrlFromId(value);
    if (built) return built;
  }

  return "";
}

function findZvukTrackId(value, maxDepth = 2) {
  if (!value || typeof value !== "object") return "";

  const queue = [{ node: value, depth: 0 }];
  const seen = new Set();
  let visited = 0;
  const MAX_VISITS = 80;
  const MAX_KEYS = 50;

  while (queue.length && visited < MAX_VISITS) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    visited += 1;

    for (const fieldName of ZVUK_TRACK_ID_FIELD_NAMES) {
      const id = buildZvukTrackUrlFromId(node[fieldName]);
      if (!id) continue;
      return normalizeZvukTrackId(node[fieldName]);
    }

    if (depth >= maxDepth) continue;

    let keys = [];
    try {
      keys = Object.keys(node);
    } catch (_) {
      keys = [];
    }

    for (const key of keys.slice(0, MAX_KEYS)) {
      const next = node[key];
      if (next && typeof next === "object" && !seen.has(next)) {
        queue.push({ node: next, depth: depth + 1 });
      }
    }
  }

  return "";
}

function resolveZvukTrackUrl({ bridgeSnapshot = null, doc = document, win = window } = {}) {
  const fromBridge = normalizeZvukTrackUrl(bridgeSnapshot?.trackUrl, win);
  if (fromBridge) return fromBridge;

  const fromBridgeId = buildZvukTrackUrlFromId(findZvukTrackId(bridgeSnapshot));
  if (fromBridgeId) return fromBridgeId;

  for (const selector of ZVUK_TRACK_LINK_SELECTORS) {
    for (const link of qAll(selector, doc)) {
      const normalized = normalizeZvukTrackUrl(attrOf(link, "href"), win);
      if (normalized) return normalized;
    }
  }

  const fromCanonical = normalizeZvukTrackUrl(attrOf(q('link[rel="canonical"]', doc), "href"), win);
  if (fromCanonical) return fromCanonical;

  const fromOg = normalizeZvukTrackUrl(attrOf(q('meta[property="og:url"]', doc), "content"), win);
  if (fromOg) return fromOg;

  return normalizeZvukTrackUrl(parseZvukLocationUrl(win)?.toString() || "", win);
}

function pickPrimaryMedia(doc = document) {
  const list = [...doc.querySelectorAll("audio,video")];
  if (!list.length) return null;
  return list.find((node) => !node.paused && !node.ended) || list[0];
}

function persistDesktopVolume(context, ratio) {
  return writePercentToLocalStorage(context, DESKTOP_VOLUME_KEY, ratio);
}

function persistCurrentMediaVolume(context) {
  const media = pickPrimaryMedia(context?.document || document);
  if (!media) return false;
  return persistDesktopVolume(context, media.volume);
}

function normalizeBridgeSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = normalizeText(raw.title);
  const artist = normalizeText(raw.artist);
  const coverUrl = normalizeText(raw.coverUrl);
  const trackUrl = normalizeText(raw.trackUrl);
  const playbackState = normalizeText(raw.playbackState).toLowerCase();
  const durationSec = finiteOrNaN(raw.durationSec);
  const positionSec = finiteOrNaN(raw.positionSec);
  const volume = clamp01(raw.volume);
  const muted = typeof raw.muted === "boolean" ? raw.muted : null;

  if (!title && !artist && !coverUrl) return null;

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(trackUrl ? { trackUrl } : {}),
    ...(playbackState ? { playbackState } : {}),
    ...(Number.isFinite(durationSec) ? { durationSec: Math.max(0, durationSec) } : {}),
    ...(Number.isFinite(positionSec) ? { positionSec: Math.max(0, positionSec) } : {}),
    ...(Number.isFinite(volume) ? { volume } : {}),
    ...(typeof muted === "boolean" ? { muted } : {}),
  };
}

function extractZvuk(context = {}) {
  const bridge = context?.zvukBridge;
  if (bridge?.requestSnapshot) {
    void bridge.requestSnapshot();
  }

  const rawBridgeSnapshot = bridge?.getSnapshot?.();
  const bridgeSnapshot = normalizeBridgeSnapshot(rawBridgeSnapshot);
  const trackUrl = resolveZvukTrackUrl({
    bridgeSnapshot: rawBridgeSnapshot,
    doc: context?.document || document,
    win: context?.window || window,
  });
  if (bridgeSnapshot) {
    return {
      ...bridgeSnapshot,
      ...(trackUrl ? { trackUrl } : {}),
    };
  }
  return null;
}

function hasZvukBridge(context) {
  return Boolean(context?.zvukBridge && typeof context.zvukBridge.execute === "function");
}

async function executeZvukBridgeAction(context, action, value) {
  if (!hasZvukBridge(context)) return null;
  return executeBridgeControl({
    bridge: context?.zvukBridge,
    action,
    value,
    context,
    debugPrefix: "zvuk",
    paths: { bridge: "zvuk-bridge" },
    unavailableMessage: "zvuk bridge unavailable",
    failedMessage: "zvuk bridge control failed",
  });
}

async function executeZvukBridgeFirst(context, action, value) {
  const result = await executeZvukBridgeAction(context, action, value);
  if (!result?.ok) return result;

  if (action === AUDIO_ACTIONS.VOLUME) {
    const target = clamp01(value);
    if (Number.isFinite(target)) persistDesktopVolume(context, target);
    void persistCurrentMediaVolume(context);
  } else if (
    action === AUDIO_ACTIONS.MUTE ||
    action === AUDIO_ACTIONS.UNMUTE ||
    action === AUDIO_ACTIONS.MUTE_TOGGLE
  ) {
    void persistCurrentMediaVolume(context);
  }

  return result;
}

function executeZvukLocalAudioFallback(context, action, value) {
  const doc = context?.document || document;

  if (action === AUDIO_ACTIONS.VOLUME) {
    const target = clamp01(value);
    if (!Number.isFinite(target)) return fail("invalid volume");

    const media = pickPrimaryMedia(doc);
    if (media) {
      media.volume = target;
      if (target > 0 && media.muted) media.muted = false;
    }
    persistDesktopVolume(context, target);

    return media
      ? ok("zvuk-local-media")
      : ok("zvuk-local-storage");
  }

  if (
    action === AUDIO_ACTIONS.MUTE ||
    action === AUDIO_ACTIONS.UNMUTE ||
    action === AUDIO_ACTIONS.MUTE_TOGGLE
  ) {
    const media = pickPrimaryMedia(doc);
    if (!media) return fail("zvuk media unavailable");

    if (action === AUDIO_ACTIONS.MUTE) media.muted = true;
    else if (action === AUDIO_ACTIONS.UNMUTE) media.muted = false;
    else media.muted = !media.muted;

    void persistCurrentMediaVolume(context);
    return ok("zvuk-local-media");
  }

  return null;
}

async function executeZvukControl(action, value, context) {
  const handlers = {
    [TRANSPORT_ACTIONS.PLAY]: () => executeZvukBridgeAction(context, TRANSPORT_ACTIONS.PLAY),
    [TRANSPORT_ACTIONS.PAUSE]: () => executeZvukBridgeAction(context, TRANSPORT_ACTIONS.PAUSE),
    [TRANSPORT_ACTIONS.TOGGLE]: () => executeZvukBridgeAction(context, TRANSPORT_ACTIONS.TOGGLE),
    [TRANSPORT_ACTIONS.NEXT]: () => executeZvukBridgeAction(context, TRANSPORT_ACTIONS.NEXT),
    [TRANSPORT_ACTIONS.PREVIOUS]: () =>
      executeZvukBridgeAction(context, TRANSPORT_ACTIONS.PREVIOUS),
    [AUDIO_ACTIONS.SEEK]: () => executeZvukBridgeAction(context, AUDIO_ACTIONS.SEEK, value),
    [AUDIO_ACTIONS.VOLUME]: async () => {
      const bridgeResult = await executeZvukBridgeFirst(context, AUDIO_ACTIONS.VOLUME, value);
      if (bridgeResult) return bridgeResult;
      return executeZvukLocalAudioFallback(context, AUDIO_ACTIONS.VOLUME, value);
    },
    [AUDIO_ACTIONS.MUTE]: async () => {
      const bridgeResult = await executeZvukBridgeFirst(context, AUDIO_ACTIONS.MUTE);
      if (bridgeResult) return bridgeResult;
      return executeZvukLocalAudioFallback(context, AUDIO_ACTIONS.MUTE);
    },
    [AUDIO_ACTIONS.UNMUTE]: async () => {
      const bridgeResult = await executeZvukBridgeFirst(context, AUDIO_ACTIONS.UNMUTE);
      if (bridgeResult) return bridgeResult;
      return executeZvukLocalAudioFallback(context, AUDIO_ACTIONS.UNMUTE);
    },
    [AUDIO_ACTIONS.MUTE_TOGGLE]: async () => {
      const bridgeResult = await executeZvukBridgeFirst(context, AUDIO_ACTIONS.MUTE_TOGGLE);
      if (bridgeResult) return bridgeResult;
      return executeZvukLocalAudioFallback(context, AUDIO_ACTIONS.MUTE_TOGGLE);
    },
  };

  return dispatchAction(action, handlers);
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  meta: {
    id: "zvuk",
    label: "Zvuk",
    sender: "ZVK",
    hosts: ["zvuk.com", "www.zvuk.com"],
    pollFallbackMs: 1200,
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
  extract: extractZvuk,
  control: {
    execute(action, value, context) {
      return executeZvukControl(action, value, context);
    },
  },
  runtime: {
    init(context, onInvalidate) {
      const bridge = createZvukBridge(context);
      context.zvukBridge = bridge;
      bridge.init(() => onInvalidate("zvuk_bridge"));
      void bridge.requestSnapshot();
      return () => {
        bridge.destroy();
        delete context.zvukBridge;
      };
    },
  },
};

export default sourceModule;
