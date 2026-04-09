import { isVisible, q, qAll, textOf } from "@/sources/shared/dom";
import {
  buildAudioDiagnosticsEntry,
  buildAudioStateFromRaw,
  hasAudioState,
} from "@/sources/shared/audio";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction } from "@/sources/shared/control";
import { executeBridgeControl } from "@/sources/shared/bridgeControl";
import { dispatchWithControlDiagnostic } from "@/sources/shared/diagnostics";
import { createYouTubeBridge } from "@/content/youtubeBridge";

const HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "www.youtube-nocookie.com",
  "youtu.be",
];

const SELECTORS = {
  VOLUME_SLIDERS: [
    ".ytdVolumeControlsNativeSlider[aria-valuenow]",
    ".ytp-volume-slider[aria-valuenow]",
  ],
  VOLUME_PANEL: ".ytp-volume-panel",
  MUTE_BUTTON: "button.ytp-mute-button",
  PLAYER_MEDIA: "#movie_player video, ytd-player video, .html5-video-player video, video",
  PLAYER_CANDIDATES: ["#movie_player", ".html5-video-player", "ytd-player #movie_player"],
  LIVE: [
    "#movie_player .ytp-live-badge",
    "#movie_player .ytp-live",
    "#movie_player .ytp-time-display.ytp-live",
    "ytd-watch-flexy .badge-style-type-live-now",
    "ytd-watch-flexy ytd-badge-supported-renderer[icon='LIVE']",
    "ytd-watch-flexy ytd-badge-supported-renderer[aria-label*='LIVE']",
    "ytd-watch-flexy ytd-badge-supported-renderer[aria-label*='В ЭФИРЕ']",
  ],
  TIME_DISPLAY: "#movie_player .ytp-time-display",
  TIME_CURRENT: "#movie_player .ytp-time-current",
};

const CONTROL_SELECTORS = {
  playPause: "button.ytp-play-button, tp-yt-paper-icon-button.play-pause-button",
  next: "button.ytp-next-button, tp-yt-paper-icon-button.next-button",
  previous: "button.ytp-prev-button, tp-yt-paper-icon-button.previous-button",
  muteToggle: "button.ytp-mute-button",
};

const PATHS = {
  BRIDGE: "youtube-bridge",
  TIMEOUT_VERIFIED: "youtube-timeout-verified",
};

const LIMITS = {
  TIMEOUT_VOLUME_EPS: 0.08,
};

const LABEL_HINTS = {
  MUTE: ["mute", "выключить звук"],
  UNMUTE: ["unmute", "включить звук"],
};

let embedActivated = false;

const labelOf = (node, attr = "aria-label") =>
  String(node?.getAttribute?.(attr) || "")
    .toLowerCase()
    .trim();

const hasAnyLabel = (label, parts) => parts.some((part) => label.includes(part));

function pickYouTubeVolumeSlider(doc = document) {
  const nodes = SELECTORS.VOLUME_SLIDERS.flatMap((selector) => qAll(selector, doc));
  if (!nodes.length) return null;
  return nodes.find((node) => isVisible(node)) || nodes[0] || null;
}

function readYouTubeUiAudioState(doc = document) {
  const slider = pickYouTubeVolumeSlider(doc);
  const panel = q(SELECTORS.VOLUME_PANEL, doc);
  if (!slider && !panel) return {};

  const sliderNow = Number(slider?.getAttribute?.("aria-valuenow"));
  const panelNow = Number(panel?.getAttribute?.("aria-valuenow"));
  const rawNow = Number.isFinite(sliderNow) ? sliderNow : panelNow;
  let muted = null;

  const panelClass = String(panel?.className || "").toLowerCase();
  if (panelClass.includes("ytp-volume-panel-muted")) muted = true;

  const muteAria = labelOf(q(SELECTORS.MUTE_BUTTON, doc));
  if (muteAria) {
    if (hasAnyLabel(muteAria, LABEL_HINTS.UNMUTE)) muted = true;
    else if (hasAnyLabel(muteAria, LABEL_HINTS.MUTE)) muted = false;
  }

  return buildAudioStateFromRaw(rawNow, 100, muted);
}

function readYouTubeUiAudioDiagnostics(doc = document) {
  const slider = pickYouTubeVolumeSlider(doc);
  const panel = q(SELECTORS.VOLUME_PANEL, doc);
  const sliderNow = Number(slider?.getAttribute?.("aria-valuenow"));
  const rawNow = Number(panel?.getAttribute("aria-valuenow"));

  return {
    ...buildAudioDiagnosticsEntry({
      present: Boolean(slider || panel),
      volumeRaw: Number.isFinite(sliderNow) ? sliderNow : rawNow,
      volumeScale: 100,
      extra: {
        source: Number.isFinite(sliderNow) ? "slider" : "panel",
      },
    }),
    sliderClass: String(slider?.className || ""),
    panelClass: String(panel?.className || ""),
    muteLabel: labelOf(q(SELECTORS.MUTE_BUTTON, doc)) || null,
  };
}

function isPlayerApiReadCandidate(node) {
  if (!node) return false;
  return typeof node.getVolume === "function";
}

function isPlayerApiControlCandidate(node) {
  if (!node) return false;
  return (
    typeof node.getVolume === "function" &&
    typeof node.setVolume === "function" &&
    (typeof node.mute === "function" || typeof node.unMute === "function")
  );
}

function parseWindowLocationUrl(win = window) {
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

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "www.youtube.com";
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

function parseVideoIdFromLocation(win = window) {
  const url = parseWindowLocationUrl(win);
  if (!url) return "";
  if (url.pathname === "/watch") return String(url.searchParams.get("v") || "").trim();
  if (url.pathname.startsWith("/embed/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.pathname.startsWith("/shorts/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.pathname.startsWith("/live/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.hostname === "youtu.be") return String(url.pathname.replace(/^\//, "").split("/")[0] || "").trim();
  return String(
    url.searchParams.get("v") ||
      url.searchParams.get("vi") ||
      url.searchParams.get("video_id") ||
      url.searchParams.get("video") ||
      ""
  ).trim();
}

function parseVideoIdFromUrlLike(raw, base = "https://www.youtube.com") {
  const value = String(raw || "").trim();
  if (!value) return "";

  let url;
  try {
    url = new URL(value, base);
  } catch (_) {
    return "";
  }

  if (url.pathname === "/watch") return String(url.searchParams.get("v") || "").trim();
  if (url.pathname.startsWith("/embed/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.pathname.startsWith("/shorts/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.pathname.startsWith("/live/")) return String(url.pathname.split("/")[2] || "").trim();
  if (url.hostname === "youtu.be") return String(url.pathname.replace(/^\//, "").split("/")[0] || "").trim();
  return String(
    url.searchParams.get("v") ||
      url.searchParams.get("vi") ||
      url.searchParams.get("video_id") ||
      url.searchParams.get("video") ||
      ""
  ).trim();
}

function parseVideoIdFromDocumentLinks(doc = document) {
  const selectors = [
    "a.ytp-title-link[href]",
    "a[href*='youtube.com/watch?v=']",
    "a[href*='youtu.be/']",
    "a[href*='watch?v=']",
  ];

  for (const selector of selectors) {
    const nodes = qAll(selector, doc);
    for (const node of nodes) {
      const href = String(node?.getAttribute?.("href") || "").trim();
      const id = parseVideoIdFromUrlLike(href, "https://www.youtube.com");
      if (id) return id;
    }
  }

  return "";
}

function parseListIdFromDocumentLinks(doc = document) {
  const selectors = [
    "a.ytp-title-link[href]",
    "a[href*='youtube.com/watch?']",
    "a[href*='watch?']",
  ];

  for (const selector of selectors) {
    const nodes = qAll(selector, doc);
    for (const node of nodes) {
      const href = String(node?.getAttribute?.("href") || "").trim();
      if (!href) continue;
      try {
        const url = new URL(href, "https://www.youtube.com");
        const listId = String(url.searchParams.get("list") || "").trim();
        if (listId) return listId;
      } catch (_) {
        // no-op
      }
    }
  }

  return "";
}

function parseVideoIdFromPlayer(doc = document) {
  const player = getYouTubePlayer(doc, { purpose: "read" });
  if (!player) return "";
  return String(player?.getVideoData?.()?.video_id || "").trim();
}

function normalizeBridgeSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const videoId = String(raw.videoId || "").trim();
  if (!videoId) return null;
  return {
    videoId,
    listId: String(raw.listId || "").trim(),
  };
}

function buildYouTubeTrackUrl(doc = document, win = window, options = {}) {
  const bridgeSnapshot = normalizeBridgeSnapshot(options?.bridgeSnapshot);
  const videoId =
    parseVideoIdFromPlayer(doc) ||
    parseVideoIdFromDocumentLinks(doc) ||
    bridgeSnapshot?.videoId ||
    parseVideoIdFromLocation(win);
  if (!videoId) return "";

  const locationUrl = parseWindowLocationUrl(win);
  const trackUrl = new URL("https://www.youtube.com/watch");
  trackUrl.searchParams.set("v", videoId);

  const listId =
    bridgeSnapshot?.listId ||
    parseListIdFromDocumentLinks(doc) ||
    String(locationUrl?.searchParams?.get("list") || "").trim();
  if (listId) trackUrl.searchParams.set("list", listId);
  return trackUrl.toString();
}

function playerStateRank(player) {
  const state = Number(player?.getPlayerState?.());
  if (state === 1) return 5;
  if (state === 2) return 4;
  if (state === 3) return 3;
  if (state === 5) return 2;
  if (state === -1) return 1;
  return 0;
}

function getApiPlayersFromWindow(win, predicate = isPlayerApiControlCandidate) {
  if (!win) return [];

  const out = [];
  const seen = new Set();
  const push = (candidate) => {
    if (!predicate(candidate)) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  for (const candidate of [win.movie_player, win.ytPlayer, win.player]) push(candidate);

  try {
    const ytPlayers = win?.yt?.player?.getPlayers?.();
    if (ytPlayers && typeof ytPlayers === "object") {
      for (const candidate of Object.values(ytPlayers)) push(candidate);
    }
  } catch (_) {
    // ignore
  }

  return out;
}

function getYouTubePlayer(doc = document, options = {}) {
  const win = doc?.defaultView || window;
  const purpose = String(options?.purpose || "control");
  const candidatePredicate =
    purpose === "read" ? isPlayerApiReadCandidate : isPlayerApiControlCandidate;
  const candidates = [
    ...SELECTORS.PLAYER_CANDIDATES.map((selector) => doc.querySelector(selector)),
    ...getApiPlayersFromWindow(win, candidatePredicate),
  ].filter(Boolean);

  const apiCandidates = candidates.filter((node) => candidatePredicate(node));
  if (!apiCandidates.length) return null;

  const pageVideoId = parseVideoIdFromLocation(win);
  if (pageVideoId) {
    for (const candidate of apiCandidates) {
      const videoId = String(candidate?.getVideoData?.()?.video_id || "").trim();
      if (videoId && videoId === pageVideoId) return candidate;
    }
  }

  apiCandidates.sort((a, b) => playerStateRank(b) - playerStateRank(a));
  return apiCandidates[0] || null;
}

function getYouTubeMedia(doc = document) {
  const list = qAll(SELECTORS.PLAYER_MEDIA, doc);
  if (!list.length) return null;
  return list.find((node) => !node.paused && !node.ended) || list[0] || null;
}

function readYouTubeAudioState(doc = document) {
  const uiState = readYouTubeUiAudioState(doc);
  if (hasAudioState(uiState)) return uiState;

  return {};
}

function collectYouTubeAudioDiagnostics(doc = document) {
  const player = getYouTubePlayer(doc, { purpose: "read" });
  const media = getYouTubeMedia(doc);

  return {
    ui: readYouTubeUiAudioDiagnostics(doc),
    player: buildAudioDiagnosticsEntry({
      present: Boolean(player),
      volumeRaw: Number(player?.getVolume?.()),
      volumeScale: 100,
      muted: player?.isMuted?.(),
    }),
    media: buildAudioDiagnosticsEntry({
      present: Boolean(media),
      volumeRaw: Number(media?.volume),
      volumeScale: 1,
      muted: media?.muted,
    }),
  };
}

function embedMediaPlaybackStarted() {
  const media = q(SELECTORS.PLAYER_MEDIA);
  if (!media) return false;
  if (!media.paused || media.ended) return true;
  return Number(media.currentTime) > 0.05;
}

function inferYouTubeLiveFromDom() {
  const media = q(SELECTORS.PLAYER_MEDIA);
  if (media && !Number.isFinite(media.duration)) return true;

  for (const selector of SELECTORS.LIVE) {
    const hit = qAll(selector).find((node) => isVisible(node));
    if (hit) return true;
  }

  const timeLabel = textOf(q(SELECTORS.TIME_DISPLAY)) || textOf(q(SELECTORS.TIME_CURRENT));
  if (/\blive\b|в эфире/i.test(timeLabel)) return true;

  return false;
}

function extractYouTube(context) {
  const isLive = inferYouTubeLiveFromDom();
  const isEmbed = String(location.pathname || "").startsWith("/embed/");
  const audioState = readYouTubeAudioState(document);
  const trackUrl = buildYouTubeTrackUrl(document, window, {
    bridgeSnapshot: context?.youtubeBridgeSnapshot || null,
  });

  if (isEmbed && embedMediaPlaybackStarted()) embedActivated = true;

  // Do not expose inactive embed players in popup/priority lists.
  if (isEmbed && !embedActivated) return null;

  if (Object.keys(audioState).length || isLive || trackUrl) {
    return {
      ...(trackUrl ? { trackUrl } : {}),
      ...(isLive ? { isLive: true } : {}),
      ...audioState,
    };
  }

  return {};
}

function verifyYouTubeTimeout(action, value, audioState, debugLog) {
  const target = Number(value);
  const current = Number(audioState?.volume);
  const volumeOk =
    action === AUDIO_ACTIONS.VOLUME &&
    Number.isFinite(target) &&
    Number.isFinite(current) &&
    Math.abs(current - target) <= LIMITS.TIMEOUT_VOLUME_EPS;

  if (volumeOk) {
    debugLog?.("youtube timeout verified by volume", { target, current });
    return true;
  }
  if (action === AUDIO_ACTIONS.MUTE && audioState?.muted === true) {
    debugLog?.("youtube timeout verified by mute", { muted: true });
    return true;
  }
  if (action === AUDIO_ACTIONS.UNMUTE && audioState?.muted === false) {
    debugLog?.("youtube timeout verified by unmute", { muted: false });
    return true;
  }
  return false;
}

async function executeYouTubeBridgeControl(bridge, action, value, context) {
  return executeBridgeControl({
    bridge,
    action,
    value,
    context,
    debugPrefix: "youtube",
    paths: {
      bridge: PATHS.BRIDGE,
      timeoutVerified: PATHS.TIMEOUT_VERIFIED,
    },
    unavailableMessage: "youtube bridge unavailable",
    failedMessage: "youtube bridge control failed",
    isTimeoutResult: (bridgeResponse) => bridgeResponse?.message === "youtube bridge timeout",
    verifyTimeout: ({ action: timeoutAction, value: timeoutValue, context: timeoutContext }) => {
      const audioState = readYouTubeAudioState(timeoutContext?.document || document);
      timeoutContext?.debugLog?.("youtube timeout verify", {
        action: timeoutAction,
        value: timeoutValue,
        audioState,
      });
      return verifyYouTubeTimeout(timeoutAction, timeoutValue, audioState, timeoutContext?.debugLog);
    },
  });
}

function createYouTubeControlHandlers(context, value) {
  const bridge = context?.youtubeBridge;
  return {
    [AUDIO_ACTIONS.VOLUME]: () =>
      executeYouTubeBridgeControl(bridge, AUDIO_ACTIONS.VOLUME, value, context),
    [AUDIO_ACTIONS.MUTE]: () =>
      executeYouTubeBridgeControl(bridge, AUDIO_ACTIONS.MUTE, value, context),
    [AUDIO_ACTIONS.UNMUTE]: () =>
      executeYouTubeBridgeControl(bridge, AUDIO_ACTIONS.UNMUTE, value, context),
    [AUDIO_ACTIONS.MUTE_TOGGLE]: () =>
      executeYouTubeBridgeControl(bridge, AUDIO_ACTIONS.MUTE_TOGGLE, value, context),
  };
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  snapshotStrategyOptions: {
    strictMediaMetadata: true,
  },
  meta: {
    id: "youtube",
    label: "YouTube",
    sender: "YT",
    hosts: HOSTS,
    controls: CONTROL_SELECTORS,
    controlCapabilities: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: true,
      transportOverrides: {
        [TRANSPORT_ACTIONS.NEXT]: false,
        [TRANSPORT_ACTIONS.PREVIOUS]: false,
      },
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
  extract: extractYouTube,
  control: {
    async execute(action, value, context) {
      const doc = context?.document || document;
      const handlers = createYouTubeControlHandlers(context, value);
      return dispatchWithControlDiagnostic({
        context,
        event: "youtube.control",
        key: `youtube:control:${action}`,
        action,
        value,
        collectBefore: () => collectYouTubeAudioDiagnostics(doc),
        collectAfter: () => collectYouTubeAudioDiagnostics(doc),
        beforeField: "beforeAudio",
        afterField: "afterAudio",
        run: () => dispatchAction(action, handlers),
      });
    },
  },
  runtime: {
    init(context, onInvalidate) {
      const bridge = createYouTubeBridge(context);
      context.youtubeBridge = bridge;
      context.youtubeBridgeSnapshot = null;
      let pollTimer = null;
      let disposed = false;

      const pollBridgeSnapshot = async () => {
        if (disposed) return;
        const response = await bridge.snapshot().catch(() => null);
        if (disposed || !response?.ok) return;

        const nextSnapshot = normalizeBridgeSnapshot(response);
        if (!nextSnapshot) return;

        const prevSnapshot = normalizeBridgeSnapshot(context.youtubeBridgeSnapshot);
        const changed =
          !prevSnapshot ||
          prevSnapshot.videoId !== nextSnapshot.videoId ||
          prevSnapshot.listId !== nextSnapshot.listId;
        if (!changed) return;

        context.youtubeBridgeSnapshot = nextSnapshot;
        if (typeof onInvalidate === "function") onInvalidate("youtube-bridge-snapshot");
      };

      const pollLoop = () => {
        if (disposed) return;
        void pollBridgeSnapshot().finally(() => {
          if (disposed) return;
          pollTimer = setTimeout(pollLoop, 1200);
        });
      };

      pollLoop();
      context?.debugLog?.("youtube bridge ready (lazy init)", { ok: true });

      return () => {
        disposed = true;
        if (pollTimer) clearTimeout(pollTimer);
        bridge.destroy();
        delete context.youtubeBridge;
        delete context.youtubeBridgeSnapshot;
      };
    },
  },
};

export default sourceModule;
