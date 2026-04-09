import { attrOf, q, textOf } from "@/sources/shared/dom";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { clamp01 } from "@/sources/shared/number";
import { parseClockToSec } from "@/sources/shared/time";
import { stripCommonPrefix } from "@/sources/shared/text";

const SELECTORS = {
  NOW_PLAYING_WIDGET: '[data-testid="now-playing-widget"]',
  NOW_PLAYING_BAR: '[data-testid="now-playing-bar"]',
  CONTEXT_LINK: '[data-testid="context-item-link"]',
  TITLE_LINK_IN_BAR: '[data-testid="now-playing-bar"] a[href*="/track/"]',
  ARTIST_LINK: '[data-testid="context-item-info-artist"] a',
  ARTIST_ANY: '[data-testid="context-item-info-artist"]',
  ARTIST_LINK_IN_BAR: '[data-testid="now-playing-bar"] a[href*="/artist/"]',
  COVER: '[data-testid="now-playing-bar"] img[src], [data-testid="now-playing-widget"] img[src]',
  POSITION: '[data-testid="playback-position"]',
  DURATION: '[data-testid="playback-duration"]',
  PROGRESS_INPUT: '[data-testid="playback-progressbar"] input[type="range"]',
  PLAY_PAUSE: '[data-testid="control-button-playpause"]',
  NEXT: '[data-testid="control-button-skip-forward"]',
  PREVIOUS: '[data-testid="control-button-skip-back"]',
  VOLUME_PROGRESS: '[data-testid="volume-bar"] [data-testid="progress-bar"]',
  MUTE_BUTTON: '[data-testid="volume-bar-toggle-mute-button"]',
};

const PATHS = {
  SEEK: "spotify-seek-range",
  VOLUME: "spotify-volume-range",
  MUTE_BUTTON: "spotify-mute-button",
  NEXT_BUTTON: "spotify-next-button",
  PREVIOUS_BUTTON: "spotify-previous-button",
};

function spotifyRangeScale(max, durationSec = Number.NaN) {
  if (!Number.isFinite(max) || max <= 0) return 1;
  if (Number.isFinite(durationSec) && durationSec > 0 && max > durationSec * 10) return 1000;
  if (max > 20000) return 1000;
  return 1;
}

function setRangeValue(input, value) {
  if (!input) return false;
  const min = Number(input.min);
  const max = Number(input.max);
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) ? max : value;
  const next = Math.max(low, Math.min(high, Number(value)));
  if (!Number.isFinite(next)) return false;

  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  return true;
}

function parsePercentRatio(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)%/);
  if (!match) return Number.NaN;
  return clamp01(Number(match[1]) / 100);
}

function readSpotifyVolumeRatio(doc = document) {
  const progress = q(SELECTORS.VOLUME_PROGRESS, doc);
  if (!progress) return Number.NaN;
  const win = doc?.defaultView || window;
  const progressValue = win.getComputedStyle(progress).getPropertyValue("--progress-bar-transform");
  const ratio = parsePercentRatio(progressValue);
  return Number.isFinite(ratio) ? ratio : Number.NaN;
}

let volumePointerId = 10_000;

function setSpotifyVolumeByPointer(doc, ratio) {
  const bar = q(SELECTORS.VOLUME_PROGRESS, doc);
  if (!bar || typeof bar.getBoundingClientRect !== "function" || typeof PointerEvent === "undefined") {
    return false;
  }

  const rect = bar.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return false;

  const x = rect.left + rect.width * clamp01(ratio);
  const y = rect.top + rect.height / 2;
  const pointerId = volumePointerId++;
  const ownerDoc = bar.ownerDocument || doc;
  const dispatch = (target, type, buttons) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      })
    );

  dispatch(bar, "pointerdown", 1);
  dispatch(ownerDoc, "pointermove", 1);
  dispatch(ownerDoc, "pointerup", 0);
  return true;
}

function readSpotifyMuteLabel(doc = document) {
  const muteButton = q(SELECTORS.MUTE_BUTTON, doc);
  return String(attrOf(muteButton, "aria-label") || attrOf(muteButton, "title") || "")
    .toLowerCase()
    .trim();
}

function setSpotifyVolumeRatio(doc, ratio) {
  return setSpotifyVolumeByPointer(doc, ratio);
}

function setSpotifySeekSec(doc, targetSec) {
  const bar = q(SELECTORS.NOW_PLAYING_BAR, doc);
  const input = q(SELECTORS.PROGRESS_INPUT, bar || doc);
  if (!input) return false;
  const max = Number(input.max);
  if (!Number.isFinite(max) || max <= 0) return false;
  const durationSec = parseClockToSec(textOf(q(SELECTORS.DURATION, bar || doc)));
  const scale = spotifyRangeScale(max, durationSec);
  const rawValue = Math.max(0, Number(targetSec)) * scale;
  return setRangeValue(input, rawValue);
}

function isDisabled(node) {
  if (!node) return true;
  if (node.hasAttribute?.("disabled")) return true;
  return String(attrOf(node, "aria-disabled") || "").toLowerCase() === "true";
}

function clickSpotifyControl(doc, selector) {
  const button = q(selector, doc);
  if (!button || isDisabled(button)) return false;
  button.click();
  return true;
}

function executeSpotifyControl(action, value, context) {
  const doc = context?.document || document;
  const handlers = {
    [TRANSPORT_ACTIONS.NEXT]: () =>
      clickSpotifyControl(doc, SELECTORS.NEXT)
        ? ok(PATHS.NEXT_BUTTON)
        : fail("spotify next unavailable"),
    [TRANSPORT_ACTIONS.PREVIOUS]: () =>
      clickSpotifyControl(doc, SELECTORS.PREVIOUS)
        ? ok(PATHS.PREVIOUS_BUTTON)
        : fail("spotify previous unavailable"),
    [AUDIO_ACTIONS.SEEK]: () => {
      const targetSec = Number(value);
      if (!Number.isFinite(targetSec)) return fail("invalid seek");
      return setSpotifySeekSec(doc, targetSec) ? ok(PATHS.SEEK) : fail("spotify seek unavailable");
    },
    [AUDIO_ACTIONS.VOLUME]: () => {
      const target = Number(value);
      if (!Number.isFinite(target)) return fail("invalid volume");
      return setSpotifyVolumeRatio(doc, target) ? ok(PATHS.VOLUME) : fail("spotify volume unavailable");
    },
    [AUDIO_ACTIONS.MUTE]: () => {
      const label = readSpotifyMuteLabel(doc);
      const muteButton = q(SELECTORS.MUTE_BUTTON, doc);
      if (!muteButton) return fail("spotify mute unavailable");
      if (label.includes("unmute")) return ok(PATHS.MUTE_BUTTON);
      muteButton.click();
      return ok(PATHS.MUTE_BUTTON);
    },
    [AUDIO_ACTIONS.UNMUTE]: () => {
      const label = readSpotifyMuteLabel(doc);
      const muteButton = q(SELECTORS.MUTE_BUTTON, doc);
      if (!muteButton) return fail("spotify unmute unavailable");
      if (!label.includes("unmute")) return ok(PATHS.MUTE_BUTTON);
      muteButton.click();
      return ok(PATHS.MUTE_BUTTON);
    },
    [AUDIO_ACTIONS.MUTE_TOGGLE]: () => {
      const muteButton = q(SELECTORS.MUTE_BUTTON, doc);
      if (muteButton) {
        muteButton.click();
        return ok(PATHS.MUTE_BUTTON);
      }
      return fail("spotify mute toggle unavailable");
    },
  };

  return dispatchAction(action, handlers);
}

function toAbsoluteUrl(rawUrl, win = window) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const baseHref = String(win?.location?.href || "https://open.spotify.com/").trim() || "https://open.spotify.com/";
    return new URL(value, baseHref).toString();
  } catch (_) {
    return "";
  }
}

function normalizeSpotifyTrackUrl(rawUrl, win = window) {
  const absolute = toAbsoluteUrl(rawUrl, win);
  if (!absolute) return "";

  try {
    const parsed = new URL(absolute);
    if (!/(^|\.)open\.spotify\.com$/i.test(parsed.hostname)) return "";
    const match = String(parsed.pathname || "").match(/^\/track\/([a-zA-Z0-9]+)(?:\/|$)/);
    if (!match) return "";
    return `https://open.spotify.com/track/${match[1]}`;
  } catch (_) {
    return "";
  }
}

function currentSpotifyTrackUrl(win = window) {
  const href = String(win?.location?.href || "").trim();
  if (!href) return "";
  return normalizeSpotifyTrackUrl(href, win);
}

function extractSpotify() {
  const widget = q(SELECTORS.NOW_PLAYING_WIDGET);
  const bar = q(SELECTORS.NOW_PLAYING_BAR);

  const titleNode =
    q(`${SELECTORS.NOW_PLAYING_WIDGET} ${SELECTORS.CONTEXT_LINK}`) ||
    q(SELECTORS.CONTEXT_LINK) ||
    q(SELECTORS.TITLE_LINK_IN_BAR);

  const artistNode =
    q(SELECTORS.ARTIST_LINK) ||
    q(SELECTORS.ARTIST_ANY) ||
    q(SELECTORS.ARTIST_LINK_IN_BAR);

  const coverNode = q(SELECTORS.COVER);

  const raw = attrOf(widget, "aria-label") || textOf(titleNode) || attrOf(titleNode, "title") || textOf(widget);
  const title = stripCommonPrefix(raw);
  const artist = textOf(artistNode);
  const trackUrl = normalizeSpotifyTrackUrl(attrOf(titleNode, "href")) || currentSpotifyTrackUrl(window);
  const coverUrl = String(coverNode?.currentSrc || attrOf(coverNode, "src") || "").trim();
  const volume = readSpotifyVolumeRatio(document);
  const muted = readSpotifyMuteLabel(document).includes("unmute");
  const playbackPosition = textOf(q(SELECTORS.POSITION, bar));
  const playbackDuration = textOf(q(SELECTORS.DURATION, bar));
  const progressInput = q(SELECTORS.PROGRESS_INPUT, bar);
  const playPauseButton = q(SELECTORS.PLAY_PAUSE, bar) || q(SELECTORS.PLAY_PAUSE);

  let positionSec = Number.NaN;
  let durationSec = Number.NaN;

  const parsedPosition = parseClockToSec(playbackPosition);
  if (Number.isFinite(parsedPosition)) positionSec = Math.max(0, parsedPosition);

  const parsedDuration = parseClockToSec(playbackDuration);
  if (Number.isFinite(parsedDuration)) durationSec = Math.max(0, parsedDuration);

  const rangeValue = Number(progressInput?.value);
  const rangeMax = Number(progressInput?.max);
  if (Number.isFinite(rangeValue) && Number.isFinite(rangeMax) && rangeMax > 0) {
    let unit = 1;
    if (Number.isFinite(durationSec) && durationSec > 0 && rangeMax > durationSec * 10) {
      unit = 1000;
    } else if (rangeMax > 20000) {
      unit = 1000;
    }

    if (!Number.isFinite(positionSec)) positionSec = Math.max(0, rangeValue / unit);
    if (!Number.isFinite(durationSec)) durationSec = Math.max(0, rangeMax / unit);
  }

  const actionLabel = String(attrOf(playPauseButton, "aria-label") || attrOf(playPauseButton, "title")).toLowerCase();
  let playbackState = "";
  if (actionLabel.includes("pause") || actionLabel.includes("пауза")) playbackState = "playing";
  if (actionLabel.includes("play") || actionLabel.includes("воспроиз") || actionLabel.includes("продолж")) {
    playbackState = "paused";
  }

  if (!title && !artist && !coverUrl) {
    const barText = textOf(q(".now-playing", bar));
    if (!barText) return null;
  }

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(trackUrl ? { trackUrl } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(Number.isFinite(durationSec) ? { durationSec } : {}),
    ...(Number.isFinite(positionSec) ? { positionSec } : {}),
    ...(playbackState ? { playbackState } : {}),
    ...(Number.isFinite(volume) ? { volume } : {}),
    ...(muted ? { muted: true } : {}),
  };
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  meta: {
    id: "spotify",
    label: "Spotify Web",
    sender: "SPTF",
    hosts: ["open.spotify.com"],
    controlRoot: '[data-testid="now-playing-bar"]',
    controls: {
      playPause: '[data-testid="control-button-playpause"]',
      next: '[data-testid="control-button-skip-forward"]',
      previous: '[data-testid="control-button-skip-back"]',
      play: '[data-testid="play-button"]',
      muteToggle: '[data-testid="volume-bar-toggle-mute-button"]',
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
  extract: extractSpotify,
  control: {
    execute(action, value, context) {
      return executeSpotifyControl(action, value, context);
    },
  },
};

export default sourceModule;
