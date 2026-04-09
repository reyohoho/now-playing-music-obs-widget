import { q } from "@/sources/shared/dom";
import {
  buildAudioDiagnosticsEntry,
  buildAudioStateFromRaw,
  hasAudioState,
} from "@/sources/shared/audio";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { executeBridgeControl } from "@/sources/shared/bridgeControl";
import { dispatchWithControlDiagnostic, emitDiagnostic } from "@/sources/shared/diagnostics";
import { clamp01, toFiniteOrNaN } from "@/sources/shared/number";
import { createVolumeMemory } from "@/sources/shared/volumeMemory";
import { createYouTubeMusicBridge } from "@/content/youtubeMusicBridge";

const STORAGE_KEYS = {
  VOLUME: "nph_ytmusic_volume",
  LAST_NONZERO_VOLUME: "nph_ytmusic_last_nonzero_volume",
};

const RUNTIME_LIMITS = {
  RESTORE_MAX_RAF_ATTEMPTS: 120,
};

const VOLUME_LIMITS = {
  MIN_AUDIBLE: 0.001,
  RESTORE_MATCH_EPS: 0.015,
  DEFAULT_RESUME: 0.5,
};

const YTMUSIC_VOLUME_MEMORY = createVolumeMemory({
  volumeKey: STORAGE_KEYS.VOLUME,
  lastNonZeroKey: STORAGE_KEYS.LAST_NONZERO_VOLUME,
  minAudible: VOLUME_LIMITS.MIN_AUDIBLE,
  defaultResume: VOLUME_LIMITS.DEFAULT_RESUME,
});

const SELECTORS = {
  CONTROL_ROOT: "ytmusic-player-bar",
  BUTTONS: "button, tp-yt-paper-icon-button",
  VOLUME_SLIDER: "#volume-slider",
};

const PATHS = {
  BRIDGE: "ytmusic-bridge",
  PLAYER_API: "ytmusic-player-api",
  SLIDER: "ytmusic-slider",
  BRIDGE_VOLUME: "ytmusic-bridge-volume",
  PLAYER_API_VOLUME: "ytmusic-player-api-volume",
  VOLUME_SLIDER: "ytmusic-volume-slider",
  NEXT: {
    PLAYER_API: "ytmusic-player-api-next",
    BUTTON: "ytmusic-button-next",
  },
  PREVIOUS: {
    PLAYER_API: "ytmusic-player-api-previous",
    BUTTON: "ytmusic-button-previous",
  },
  PLAY: {
    ALREADY: "ytmusic-already-playing",
    PLAYER_API: "ytmusic-player-api-play",
    BUTTON: "ytmusic-button-play",
  },
  PAUSE: {
    ALREADY: "ytmusic-already-paused",
    PLAYER_API: "ytmusic-player-api-pause",
    BUTTON: "ytmusic-button-pause",
  },
  TOGGLE: {
    PAUSE_PLAYER_API: "ytmusic-player-api-toggle-pause",
    PAUSE_BUTTON: "ytmusic-button-toggle-pause",
    PLAY_PLAYER_API: "ytmusic-player-api-toggle-play",
    PLAY_BUTTON: "ytmusic-button-toggle-play",
    BUTTON: "ytmusic-button-toggle",
  },
};

const LABEL_HINTS = {
  PLAY: ["play", "resume", "воспроиз", "продолж"],
  PAUSE: ["pause", "пауза"],
  NEXT: ["next", "следующ", "вперед", "вперёд"],
  PREVIOUS: ["previous", "предыдущ", "назад"],
  MUTE: ["mute", "unmute", "выключить звук", "включить звук"],
};

const labelOf = (node) =>
  String(node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || "")
    .toLowerCase()
    .trim();

const hasAnyLabel = (label, parts) => parts.some((part) => label.includes(part));

function sliderRange(node) {
  const min = toFiniteOrNaN(node?.getAttribute?.("aria-valuemin") ?? node?.min);
  const max = toFiniteOrNaN(node?.getAttribute?.("aria-valuemax") ?? node?.max);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : Number.NaN,
  };
}

const ytmusicVolumeSlider = (doc = document) =>
  q(`${SELECTORS.CONTROL_ROOT} ${SELECTORS.VOLUME_SLIDER}`, doc);

const findButton = (root, hints) =>
  Array.from((root || document).querySelectorAll(SELECTORS.BUTTONS)).find((node) =>
    hasAnyLabel(labelOf(node), hints)
  ) || null;

const ytmusicMuteButton = (doc = document) =>
  findButton(q(SELECTORS.CONTROL_ROOT, doc) || doc, LABEL_HINTS.MUTE);

function setYtmusicSliderValue(node, targetValue) {
  if (!node) return false;
  const { min, max } = sliderRange(node);
  if (!Number.isFinite(max) || max <= min) return false;
  const next = Math.max(min, Math.min(max, Number(targetValue)));
  const win = node.ownerDocument?.defaultView || window;

  try {
    node.value = next;
  } catch (_) {
    // no-op
  }

  try {
    if ("immediateValue" in node) node.immediateValue = next;
  } catch (_) {
    // no-op
  }

  node.dispatchEvent(new win.Event("input", { bubbles: true, composed: true }));
  node.dispatchEvent(new win.Event("change", { bubbles: true, composed: true }));
  return true;
}

function setYtmusicVolumeViaSlider(doc = document, ratio = 1) {
  const slider = ytmusicVolumeSlider(doc);
  if (!slider) return false;
  const percent = Math.round(clamp01(ratio) * 100);
  if (!Number.isFinite(percent)) return false;
  return setYtmusicSliderValue(slider, percent);
}

function ytmusicPlayerApi(doc = document) {
  const host = q(SELECTORS.CONTROL_ROOT, doc);
  const candidates = [
    doc.querySelector("#movie_player"),
    doc.querySelector(".html5-video-player"),
    host?.playerApi_,
    host?.playerApi,
    host?.player,
    window.movie_player,
    window.ytPlayer,
    window.player,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      typeof candidate.getVolume === "function" ||
      typeof candidate.setVolume === "function" ||
      typeof candidate.seekTo === "function"
    ) {
      return candidate;
    }
  }

  return null;
}

function getYtmusicBridge(context) {
  if (context?.ytmusicBridge) return context.ytmusicBridge;
  const bridge = createYouTubeMusicBridge(context);
  bridge.init();
  if (context) context.ytmusicBridge = bridge;
  return bridge;
}

function ytmusicUiVolumeState(doc = document) {
  const slider = ytmusicVolumeSlider(doc);
  if (!slider) return {};
  const raw = Number(slider.getAttribute("aria-valuenow") ?? slider.value);
  const muteLabel = labelOf(ytmusicMuteButton(doc));
  const muted = muteLabel
    ? hasAnyLabel(muteLabel, ["unmute", "включить звук"])
      ? true
      : hasAnyLabel(muteLabel, ["mute", "выключить звук"])
        ? false
        : null
    : null;
  return buildAudioStateFromRaw(raw, 100, muted);
}

function ytmusicUiVolumeDiagnostics(doc = document) {
  const slider = ytmusicVolumeSlider(doc);
  const rawNow = Number(slider?.getAttribute("aria-valuenow") ?? slider?.value);
  const muteLabel = labelOf(ytmusicMuteButton(doc));

  return {
    ...buildAudioDiagnosticsEntry({
      present: Boolean(slider),
      volumeRaw: rawNow,
      volumeScale: 100,
    }),
    muteLabel: muteLabel || null,
  };
}

function ytmusicAudioState(doc = document) {
  const uiState = ytmusicUiVolumeState(doc);
  if (hasAudioState(uiState)) return uiState;

  const api = ytmusicPlayerApi(doc);
  const rawVolume = Number(api?.getVolume?.());
  const apiState = buildAudioStateFromRaw(rawVolume, 100, api?.isMuted?.());
  if (hasAudioState(apiState)) return apiState;

  const media = doc.querySelector("video, audio");
  if (!media) return {};
  return buildAudioStateFromRaw(Number(media.volume), 1, media.muted);
}

function collectYtmusicAudioDiagnostics(doc = document) {
  const api = ytmusicPlayerApi(doc);
  const media = doc.querySelector("video, audio");
  const apiVolumeRaw = Number(api?.getVolume?.());
  const mediaVolumeRaw = Number(media?.volume);
  const apiMutedRaw = api?.isMuted?.();

  return {
    api: buildAudioDiagnosticsEntry({
      present: Boolean(api),
      volumeRaw: apiVolumeRaw,
      volumeScale: 100,
      muted: apiMutedRaw,
    }),
    ui: ytmusicUiVolumeDiagnostics(doc),
    media: buildAudioDiagnosticsEntry({
      present: Boolean(media),
      volumeRaw: mediaVolumeRaw,
      volumeScale: 1,
      muted: media?.muted,
    }),
  };
}

function parseYtmusicLocationUrl(win = window) {
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

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "music.youtube.com";
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

function parseYtmusicVideoIdFromLocation(win = window) {
  const url = parseYtmusicLocationUrl(win);
  if (!url) return "";
  return String(url.searchParams.get("v") || "").trim();
}

function parseYtmusicVideoIdFromPlayer(doc = document) {
  const player = ytmusicPlayerApi(doc);
  if (!player) return "";
  const id = String(player?.getVideoData?.()?.video_id || player?.getVideoData?.()?.videoId || "").trim();
  return id;
}

function buildYtmusicTrackUrl(doc = document, win = window) {
  const videoId = parseYtmusicVideoIdFromPlayer(doc) || parseYtmusicVideoIdFromLocation(win);
  if (!videoId) return "";

  const locationUrl = parseYtmusicLocationUrl(win);
  const trackUrl = new URL("https://music.youtube.com/watch");
  trackUrl.searchParams.set("v", videoId);

  const listId = String(locationUrl?.searchParams?.get("list") || "").trim();
  if (listId) trackUrl.searchParams.set("list", listId);
  return trackUrl.toString();
}

function extractYouTubeMusic() {
  const audioState = ytmusicAudioState(document);
  const trackUrl = buildYtmusicTrackUrl(document, window);
  if (Object.keys(audioState).length || trackUrl) {
    return {
      ...(trackUrl ? { trackUrl } : {}),
      ...audioState,
    };
  }
  return {};
}

function getYtmusicTransportButtons(doc = document) {
  const root = doc.querySelector(SELECTORS.CONTROL_ROOT);
  if (!root) {
    return {
      playPause: null,
      next: null,
      previous: null,
    };
  }

  const nodes = Array.from(root.querySelectorAll(SELECTORS.BUTTONS)).filter(Boolean);
  const pick = (matcher) => nodes.find((node) => matcher(labelOf(node), node)) || null;

  const previous = pick((label) => hasAnyLabel(label, LABEL_HINTS.PREVIOUS));
  const next = pick((label) => hasAnyLabel(label, LABEL_HINTS.NEXT));
  const playPause = pick((label) => {
    if (!label || label.includes("more player controls")) return false;
    return hasAnyLabel(label, [...LABEL_HINTS.PAUSE, ...LABEL_HINTS.PLAY]);
  });

  return { playPause, next, previous };
}

function inferPlayerPlaybackState(player, playPauseButton) {
  const state = Number(player?.getPlayerState?.());
  if (state === 1 || state === 3) return "playing";
  if (state === 2) return "paused";

  const label = labelOf(playPauseButton);
  if (!label) return "unknown";
  if (hasAnyLabel(label, LABEL_HINTS.PAUSE)) return "playing";
  if (hasAnyLabel(label, LABEL_HINTS.PLAY)) return "paused";
  return "unknown";
}

function executeYouTubeMusicPlayerBarAction(action, doc = document) {
  const player = ytmusicPlayerApi(doc);
  const { playPause: playPauseButton, next: nextButton, previous: previousButton } =
    getYtmusicTransportButtons(doc);

  const clickButton = (button) => {
    if (!button) return false;
    button.click();
    return true;
  };
  const runPlayerMethod = (methodName, path) => {
    if (!player || typeof player?.[methodName] !== "function") return null;
    player[methodName]();
    return ok(path);
  };
  const clickAsResult = (button, path) => (clickButton(button) ? ok(path) : null);
  const playbackState = inferPlayerPlaybackState(player, playPauseButton);
  const playPauseLabel = labelOf(playPauseButton);
  const buttonLooksLikePlay = hasAnyLabel(playPauseLabel, LABEL_HINTS.PLAY);
  const buttonLooksLikePause = hasAnyLabel(playPauseLabel, LABEL_HINTS.PAUSE);

  const handlers = {
    [TRANSPORT_ACTIONS.NEXT]: () =>
      runPlayerMethod("nextVideo", PATHS.NEXT.PLAYER_API) ||
      clickAsResult(nextButton, PATHS.NEXT.BUTTON) ||
      fail("youtube music next unavailable"),
    [TRANSPORT_ACTIONS.PREVIOUS]: () =>
      runPlayerMethod("previousVideo", PATHS.PREVIOUS.PLAYER_API) ||
      clickAsResult(previousButton, PATHS.PREVIOUS.BUTTON) ||
      fail("youtube music previous unavailable"),
    [TRANSPORT_ACTIONS.PLAY]: () => {
      if (playbackState === "playing") return ok(PATHS.PLAY.ALREADY);
      return (
        runPlayerMethod("playVideo", PATHS.PLAY.PLAYER_API) ||
        ((playbackState === "paused" || buttonLooksLikePlay) &&
          clickAsResult(playPauseButton, PATHS.PLAY.BUTTON)) ||
        fail("youtube music play unavailable")
      );
    },
    [TRANSPORT_ACTIONS.PAUSE]: () => {
      if (playbackState === "paused") return ok(PATHS.PAUSE.ALREADY);
      return (
        runPlayerMethod("pauseVideo", PATHS.PAUSE.PLAYER_API) ||
        ((playbackState === "playing" || buttonLooksLikePause) &&
          clickAsResult(playPauseButton, PATHS.PAUSE.BUTTON)) ||
        fail("youtube music pause unavailable")
      );
    },
    [TRANSPORT_ACTIONS.TOGGLE]: () => {
      if (playbackState === "playing") {
        return (
          runPlayerMethod("pauseVideo", PATHS.TOGGLE.PAUSE_PLAYER_API) ||
          clickAsResult(playPauseButton, PATHS.TOGGLE.PAUSE_BUTTON) ||
          fail("youtube music toggle unavailable")
        );
      }
      if (playbackState === "paused") {
        return (
          runPlayerMethod("playVideo", PATHS.TOGGLE.PLAY_PLAYER_API) ||
          clickAsResult(playPauseButton, PATHS.TOGGLE.PLAY_BUTTON) ||
          fail("youtube music toggle unavailable")
        );
      }
      return clickAsResult(playPauseButton, PATHS.TOGGLE.BUTTON) || fail("youtube music toggle unavailable");
    },
  };

  const handler = handlers[action];
  return handler ? handler() : fail(`youtube music ${action} unavailable`);
}

async function tryRestoreYtmusicPersistedVolume(context, reason = "init") {
  const ratio = YTMUSIC_VOLUME_MEMORY.readVolume(context);
  if (!Number.isFinite(ratio)) return false;
  const doc = context?.document || document;
  const api = ytmusicPlayerApi(doc);
  const before = collectYtmusicAudioDiagnostics(doc);

  const current = Number(before?.api?.volume);
  if (Number.isFinite(current) && Math.abs(current - ratio) <= VOLUME_LIMITS.RESTORE_MATCH_EPS) {
    return true;
  }

  const bridge = getYtmusicBridge(context);
  const { result, bridgeResult } = await executeYtmusicVolumePipeline({
    context,
    doc,
    api,
    bridge,
    ratio,
    paths: {
      bridge: PATHS.BRIDGE,
      api: PATHS.PLAYER_API,
      slider: PATHS.SLIDER,
    },
    failedMessage: "youtube music bridge volume failed",
  });
  if (!result?.ok) return false;

  emitDiagnostic(
    context,
    "ytmusic.restore_volume",
    {
      reason,
      persistedRatio: ratio,
      targetPercent: Math.round(ratio * 100),
      path: result.path,
      bridgeResult: bridgeResult || null,
      before,
      after: collectYtmusicAudioDiagnostics(doc),
      result: { ok: true },
    },
    { key: "ytmusic:restore_volume", minIntervalMs: 300 }
  );
  return true;
}

async function resolveCurrentYtmusicVolume(doc, api, bridge) {
  const audioState = ytmusicAudioState(doc);
  const stateVolume = Number(audioState?.volume);
  if (Number.isFinite(stateVolume)) return clamp01(stateVolume);

  const snapshot = await bridge.snapshot().catch(() => null);
  const bridgeVolume = Number(snapshot?.volume);
  if (Number.isFinite(bridgeVolume)) return clamp01(bridgeVolume);

  const apiVolume = Number(api?.getVolume?.());
  if (Number.isFinite(apiVolume)) return clamp01(apiVolume / 100);
  return Number.NaN;
}

async function executeYtmusicBridgeControl(
  bridge,
  action,
  value,
  context,
  { path = PATHS.BRIDGE, failedMessage = "youtube music bridge control failed" } = {}
) {
  return executeBridgeControl({
    bridge,
    action,
    value,
    context,
    debugPrefix: "ytmusic",
    paths: { bridge: path },
    unavailableMessage: "youtube music bridge unavailable",
    failedMessage,
  });
}

async function executeYtmusicVolumePipeline({
  context,
  doc,
  api,
  bridge,
  ratio,
  paths,
  failedMessage,
}) {
  const normalized = clamp01(ratio);
  if (!Number.isFinite(normalized)) {
    return { result: fail("invalid volume"), bridgeResult: null, normalized: Number.NaN };
  }

  const bridgeResult = await executeYtmusicBridgeControl(
    bridge,
    AUDIO_ACTIONS.VOLUME,
    normalized,
    context,
    {
    path: paths.bridge,
    failedMessage: failedMessage || "youtube music bridge volume failed",
    }
  );
  if (bridgeResult?.ok) {
    return { result: bridgeResult, bridgeResult, normalized };
  }

  const percent = Math.round(normalized * 100);
  if (api && typeof api.setVolume === "function") {
    api.setVolume(percent);
    return {
      result: ok(paths.api, {
        ...(bridgeResult ? { bridgeResult } : {}),
      }),
      bridgeResult,
      normalized,
    };
  }

  if (setYtmusicVolumeViaSlider(doc, normalized)) {
    return { result: ok(paths.slider), bridgeResult, normalized };
  }

  return {
    result: fail("youtube music volume unavailable", {
      ...(bridgeResult ? { bridgeResult } : {}),
    }),
    bridgeResult,
    normalized,
  };
}

async function applyYtmusicVolumeRatio(context, doc, api, bridge, ratio) {
  const { result, normalized } = await executeYtmusicVolumePipeline({
    context,
    doc,
    api,
    bridge,
    ratio,
    paths: {
      bridge: PATHS.BRIDGE_VOLUME,
      api: PATHS.PLAYER_API_VOLUME,
      slider: PATHS.VOLUME_SLIDER,
    },
    failedMessage: "youtube music bridge volume failed",
  });
  if (result?.ok) YTMUSIC_VOLUME_MEMORY.persistState(context, normalized);
  return result;
}

function resolveYtmusicMuteTarget(action, currentVolume, context) {
  const hasAudibleVolume =
    Number.isFinite(currentVolume) && currentVolume > VOLUME_LIMITS.MIN_AUDIBLE;

  if (hasAudibleVolume) YTMUSIC_VOLUME_MEMORY.persistLastNonZero(context, currentVolume);
  if (action === AUDIO_ACTIONS.MUTE) return 0;
  if (action === AUDIO_ACTIONS.UNMUTE) return YTMUSIC_VOLUME_MEMORY.resolveResumeRatio(context);
  if (action === AUDIO_ACTIONS.MUTE_TOGGLE) {
    return hasAudibleVolume ? 0 : YTMUSIC_VOLUME_MEMORY.resolveResumeRatio(context);
  }
  return Number.NaN;
}

async function executeYtmusicMuteAction(action, context, doc, api, bridge) {
  const currentVolume = await resolveCurrentYtmusicVolume(doc, api, bridge);
  const targetRatio = resolveYtmusicMuteTarget(action, currentVolume, context);
  if (!Number.isFinite(targetRatio)) return fail(`youtube music ${action} unavailable`);
  return applyYtmusicVolumeRatio(context, doc, api, bridge, targetRatio);
}

async function executeYtmusicSeek(api, bridge, value, context) {
  const targetSec = Number(value);
  if (!Number.isFinite(targetSec)) return fail("invalid seek");

  const bridgeResult = await executeYtmusicBridgeControl(
    bridge,
    AUDIO_ACTIONS.SEEK,
    targetSec,
    context
  );
  if (bridgeResult?.ok) return bridgeResult;
  if (api && typeof api.seekTo === "function") {
    api.seekTo(Math.max(0, targetSec), true);
    return ok(PATHS.PLAYER_API, {
      ...(bridgeResult ? { bridgeResult } : {}),
    });
  }
  // Keep legacy generic fallback path when API is not visible in isolated world.
  return null;
}

async function executeYtmusicTransport(doc, bridge, action, context) {
  const bridgeResult = await executeYtmusicBridgeControl(bridge, action, undefined, context);
  if (bridgeResult?.ok) return bridgeResult;
  const fallbackResult = executeYouTubeMusicPlayerBarAction(action, doc);
  return bridgeResult ? { ...fallbackResult, bridgeResult } : fallbackResult;
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  snapshotStrategyOptions: {
    strictMediaMetadata: true,
  },
  meta: {
    id: "youtube-music",
    label: "YouTube Music",
    sender: "YTM",
    hosts: ["music.youtube.com"],
    controlRoot: SELECTORS.CONTROL_ROOT,
    controls: {
      playPause: "tp-yt-paper-icon-button.play-pause-button",
      next: "tp-yt-paper-icon-button.next-button",
      previous: "tp-yt-paper-icon-button.previous-button",
      muteToggle:
        'button[aria-label*="Mute"], button[aria-label*="Unmute"], button[aria-label*="Выключить звук"], button[aria-label*="Включить звук"]',
    },
    controlCapabilities: buildControlActionMap({
      defaultTransport: true,
      defaultAudio: true,
    }),
    mediaElementFallback: buildControlActionMap({
      defaultTransport: false,
      defaultAudio: false,
      audioOverrides: {
        [AUDIO_ACTIONS.SEEK]: true,
      },
    }),
  },
  extract: extractYouTubeMusic,
  control: {
    async execute(action, value, context) {
      const doc = context?.document || document;
      const api = ytmusicPlayerApi(doc);
      const bridge = getYtmusicBridge(context);

      const handlers = {
        [AUDIO_ACTIONS.SEEK]: () => executeYtmusicSeek(api, bridge, value, context),
        [AUDIO_ACTIONS.VOLUME]: () => applyYtmusicVolumeRatio(context, doc, api, bridge, value),
        [AUDIO_ACTIONS.MUTE]: () =>
          executeYtmusicMuteAction(AUDIO_ACTIONS.MUTE, context, doc, api, bridge),
        [AUDIO_ACTIONS.UNMUTE]: () =>
          executeYtmusicMuteAction(AUDIO_ACTIONS.UNMUTE, context, doc, api, bridge),
        [AUDIO_ACTIONS.MUTE_TOGGLE]: () =>
          executeYtmusicMuteAction(AUDIO_ACTIONS.MUTE_TOGGLE, context, doc, api, bridge),
        [TRANSPORT_ACTIONS.PLAY]: () =>
          executeYtmusicTransport(doc, bridge, TRANSPORT_ACTIONS.PLAY, context),
        [TRANSPORT_ACTIONS.PAUSE]: () =>
          executeYtmusicTransport(doc, bridge, TRANSPORT_ACTIONS.PAUSE, context),
        [TRANSPORT_ACTIONS.TOGGLE]: () =>
          executeYtmusicTransport(doc, bridge, TRANSPORT_ACTIONS.TOGGLE, context),
        [TRANSPORT_ACTIONS.NEXT]: () =>
          executeYtmusicTransport(doc, bridge, TRANSPORT_ACTIONS.NEXT, context),
        [TRANSPORT_ACTIONS.PREVIOUS]: () =>
          executeYtmusicTransport(doc, bridge, TRANSPORT_ACTIONS.PREVIOUS, context),
      };

      return dispatchWithControlDiagnostic({
        context,
        event: "ytmusic.control",
        key: `ytmusic:control:${action}`,
        action,
        value,
        collectBefore: () => collectYtmusicAudioDiagnostics(doc),
        collectAfter: () => collectYtmusicAudioDiagnostics(doc),
        beforeField: "beforeAudio",
        afterField: "afterAudio",
        run: () => dispatchAction(action, handlers),
      });
    },
  },
  runtime: {
    init(context) {
      const win = context?.window || window;
      const doc = context?.document || document;
      const bridge = getYtmusicBridge(context);

      let stopped = false;
      let rafId = 0;
      let bootAttempts = 0;

      const restore = (reason) => {
        if (stopped) return;
        void tryRestoreYtmusicPersistedVolume(context, reason);
      };

      const bootstrapRestore = () => {
        if (stopped) return;
        bootAttempts += 1;
        void tryRestoreYtmusicPersistedVolume(context, "boot").then((restored) => {
          if (stopped || restored) return;
          if (bootAttempts < RUNTIME_LIMITS.RESTORE_MAX_RAF_ATTEMPTS) {
            rafId = win.requestAnimationFrame(bootstrapRestore);
          }
        });
      };

      const onTrackLifecycle = () => {
        if (stopped) return;
        // Let YT Music finish internal track init first.
        win.requestAnimationFrame(() => {
          win.requestAnimationFrame(() => restore("track-lifecycle"));
        });
      };

      doc.addEventListener("loadedmetadata", onTrackLifecycle, true);
      doc.addEventListener("loadstart", onTrackLifecycle, true);
      doc.addEventListener("yt-navigate-finish", onTrackLifecycle, true);
      bridge.init();
      rafId = win.requestAnimationFrame(bootstrapRestore);

      return () => {
        stopped = true;
        doc.removeEventListener("loadedmetadata", onTrackLifecycle, true);
        doc.removeEventListener("loadstart", onTrackLifecycle, true);
        doc.removeEventListener("yt-navigate-finish", onTrackLifecycle, true);
        bridge.destroy();
        if (rafId) win.cancelAnimationFrame(rafId);
      };
    },
  },
};

export default sourceModule;
