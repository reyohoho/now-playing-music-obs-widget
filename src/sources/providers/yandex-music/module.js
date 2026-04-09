import { attrOf, q, qAll, textOf } from "@/sources/shared/dom";
import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";
import { buildControlActionMap } from "@/sources/shared/capabilities";
import { dispatchAction, fail, ok } from "@/sources/shared/control";
import { clamp01 } from "@/sources/shared/number";
import { inferTimesFromText } from "@/sources/shared/time";

const YANDEX_CONTROL_ROOT =
  '[class*="PlayerBarDesktop"], [class*="PlayerBar_root"], [class*="PlayerBar"]';
const YANDEX_TRACK_LINK_SELECTOR = 'a[href*="/track/"]';

export function inferYandexTimesFromText(text) {
  return inferTimesFromText(text);
}

function inferYandexTimesFromNodeAttrs(node) {
  if (!node?.getAttribute) return null;

  const labelLike = [
    node.getAttribute("aria-valuetext"),
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.textContent,
  ]
    .filter(Boolean)
    .join(" ");

  const fromLabel = inferYandexTimesFromText(labelLike);
  if (fromLabel) return fromLabel;

  const now = Number(node.getAttribute("aria-valuenow") ?? node.value);
  const max = Number(node.getAttribute("aria-valuemax") ?? node.max);
  if (!Number.isFinite(now) || !Number.isFinite(max)) return null;
  if (max <= 0 || now < 0 || now > max) return null;

  if (max <= 100) return null;

  return {
    positionSec: now,
    durationSec: max,
  };
}

function parseYandexLocationUrl(win = window) {
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

  const hostname = String(locationRef.hostname || "").trim().toLowerCase() || "music.yandex.ru";
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

function normalizeYandexTrackPath(pathname = "") {
  const value = String(pathname || "").trim();
  if (!value) return "";

  const albumTrack = value.match(/\/album\/([^/?#]+)\/track\/([^/?#]+)/i);
  if (albumTrack) {
    return `/album/${albumTrack[1]}/track/${albumTrack[2]}`;
  }

  const trackOnly = value.match(/\/track\/([^/?#]+)/i);
  if (trackOnly) {
    return `/track/${trackOnly[1]}`;
  }

  return "";
}

function normalizeYandexTrackUrl(rawUrl, win = window) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    const base = parseYandexLocationUrl(win)?.toString() || "https://music.yandex.ru/";
    parsed = new URL(raw, base);
  } catch (_) {
    return "";
  }

  if (!/(^|\.)music\.yandex\./i.test(parsed.hostname)) return "";
  const path = normalizeYandexTrackPath(parsed.pathname);
  if (!path) return "";
  return `https://${parsed.hostname}${path}`;
}

function resolveYandexTrackUrl(doc = document, win = window, bar = null) {
  const root = bar || q(YANDEX_CONTROL_ROOT, doc);
  const links = root ? qAll(YANDEX_TRACK_LINK_SELECTOR, root) : [];
  for (const link of links) {
    const normalized = normalizeYandexTrackUrl(attrOf(link, "href"), win);
    if (normalized) return normalized;
  }

  const fromLocation = normalizeYandexTrackUrl(parseYandexLocationUrl(win)?.toString() || "", win);
  if (fromLocation) return fromLocation;

  const fromCanonical = normalizeYandexTrackUrl(attrOf(q('link[rel="canonical"]', doc), "href"), win);
  if (fromCanonical) return fromCanonical;

  const fromOg = normalizeYandexTrackUrl(attrOf(q('meta[property="og:url"]', doc), "content"), win);
  if (fromOg) return fromOg;

  return "";
}

export function inferYandexPlaybackStateFromActionLabel(label) {
  const normalized = String(label || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  if (
    normalized.includes("повтор") ||
    normalized.includes("shuffle") ||
    normalized.includes("перемеш") ||
    normalized.includes("громк") ||
    normalized.includes("volume")
  ) {
    return "";
  }

  if (normalized.includes("пауза") || normalized.includes("pause")) return "playing";

  if (
    normalized === "play" ||
    normalized.startsWith("play ") ||
    normalized.includes("слушать") ||
    normalized === "воспроизведение" ||
    normalized.startsWith("воспроизведение ") ||
    normalized.includes("играть") ||
    normalized.includes("воспроизвести") ||
    normalized.includes("продолжить")
  ) {
    return "paused";
  }

  return "";
}

function extractYandex() {
  const bar = q(YANDEX_CONTROL_ROOT);
  if (!bar) return null;

  const title = textOf(q('[class*="Meta_title__"]', bar));
  const artist = textOf(q('[class*="Meta_artists__"]', bar));
  if (!title && !artist) return null;

  let playbackState = "";
  const transportCandidates = qAll(
    'button[aria-label*="Пауза"], button[aria-label*="Воспроизведение"], button[aria-label*="Слушать"], button[aria-label*="Play"], button[aria-label*="Pause"]',
    bar
  );

  const buttons = transportCandidates.length ? transportCandidates : qAll("button", bar);
  for (const button of buttons) {
    const actionLabel = attrOf(button, "aria-label") || attrOf(button, "title") || textOf(button);
    playbackState = inferYandexPlaybackStateFromActionLabel(actionLabel);
    if (playbackState) break;
  }

  let times = inferYandexTimesFromText(bar.innerText || bar.textContent || "");
  if (!times) {
    const timedNodes = qAll(
      '[role="slider"], [role="progressbar"], [aria-valuetext], input[type="range"]',
      bar
    );

    for (const node of timedNodes) {
      times = inferYandexTimesFromNodeAttrs(node);
      if (times) break;
    }
  }

  const trackUrl = resolveYandexTrackUrl(document, window, bar);

  return {
    title,
    artist,
    ...(trackUrl ? { trackUrl } : {}),
    ...(playbackState ? { playbackState } : {}),
    ...(times || {}),
  };
}

function normalizeControlLabel(node) {
  return String(
    attrOf(node, "aria-label") || attrOf(node, "title") || textOf(node) || ""
  )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const YANDEX_MUTE_CONTROL_SIGNALS = [
  "выключить звук",
  "включить звук",
  "включите звук",
  "без звука",
  "mute",
  "unmute",
  "turn off sound",
  "turn on sound",
  "turn sound off",
  "turn sound on",
  "sound off",
  "sound on",
];

const YANDEX_MUTED_STATE_SIGNALS = [
  "включить звук",
  "включите звук",
  "unmute",
  "turn on sound",
  "turn sound on",
  "sound on",
];

const YANDEX_UNMUTED_STATE_SIGNALS = [
  "выключить звук",
  "без звука",
  "turn off sound",
  "turn sound off",
  "sound off",
];

export function inferYandexMuteStateFromControlLabel(rawLabel = "") {
  const label = String(rawLabel || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!label) return null;

  if (YANDEX_MUTED_STATE_SIGNALS.some((signal) => label.includes(signal))) return true;
  if (
    YANDEX_UNMUTED_STATE_SIGNALS.some((signal) => label.includes(signal)) ||
    (label.includes("mute") && !label.includes("unmute"))
  ) {
    return false;
  }

  return null;
}

function parseFinite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isDisabledControl(node) {
  if (!node) return true;
  if ("disabled" in node && node.disabled) return true;
  const ariaDisabled = String(node.getAttribute?.("aria-disabled") || "")
    .toLowerCase()
    .trim();
  return ariaDisabled === "true";
}

function getYandexRoot(doc = document) {
  return q(YANDEX_CONTROL_ROOT, doc) || doc;
}

function findYandexMuteButton(doc = document) {
  const root = getYandexRoot(doc);
  const buttons = qAll("button, [role='button']", root).filter((node) => !isDisabledControl(node));
  if (!buttons.length) return null;

  for (const button of buttons) {
    const label = normalizeControlLabel(button);
    if (!label) continue;
    if (
      YANDEX_MUTE_CONTROL_SIGNALS.some((signal) => label.includes(signal)) ||
      inferYandexMuteStateFromControlLabel(label) !== null
    ) {
      return button;
    }
  }

  return null;
}

function inferMutedFromButtonLabel(button) {
  const label = normalizeControlLabel(button);
  return inferYandexMuteStateFromControlLabel(label);
}

function clickAtRatio(node, ratio) {
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const safe = clamp01(ratio);
  const clientX = rect.left + rect.width * safe;
  const clientY = rect.top + rect.height / 2;
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
    node.dispatchEvent(
      new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true })
    );
  }
  return true;
}

function findYandexVolumeSlider(doc = document) {
  const root = getYandexRoot(doc);
  const nodes = qAll('input[type="range"], [role="slider"]', root);
  if (!nodes.length) return null;

  let fallback = null;
  for (const node of nodes) {
    if (isDisabledControl(node)) continue;
    if (!fallback) fallback = node;
    const label = normalizeControlLabel(node);
    if (label.includes("громк") || label.includes("volume") || label.includes("звук")) {
      return node;
    }
  }

  return fallback;
}

function readYandexVolume(doc = document) {
  const node = findYandexVolumeSlider(doc);
  if (!node) return Number.NaN;

  const min = parseFinite(node.getAttribute?.("aria-valuemin") ?? node.min, 0);
  const max = parseFinite(node.getAttribute?.("aria-valuemax") ?? node.max, 1);
  const now = parseFinite(node.getAttribute?.("aria-valuenow") ?? node.value, Number.NaN);
  if (!Number.isFinite(now) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Number.NaN;
  }

  return clamp01((now - min) / (max - min));
}

function setYandexVolume(value, doc = document) {
  const node = findYandexVolumeSlider(doc);
  if (!node) return false;

  const ratio = clamp01(value);
  const min = parseFinite(node.getAttribute?.("aria-valuemin") ?? node.min, 0);
  const max = parseFinite(node.getAttribute?.("aria-valuemax") ?? node.max, 1);
  const nextValue = min + ratio * Math.max(1e-9, max - min);

  if (node instanceof HTMLInputElement && node.type === "range") {
    node.value = String(nextValue);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    clickAtRatio(node, ratio);
    return true;
  }

  return clickAtRatio(node, ratio);
}

function setYandexMuted(targetMuted, doc = document) {
  const muteButton = findYandexMuteButton(doc);
  if (!muteButton) return false;

  const currentMuted = inferMutedFromButtonLabel(muteButton);
  if (currentMuted === null || currentMuted !== Boolean(targetMuted)) {
    muteButton.click();
  }
  return true;
}

function toggleYandexMute(doc = document) {
  const muteButton = findYandexMuteButton(doc);
  if (!muteButton) return false;
  muteButton.click();
  return true;
}

function findYandexTransportButton(action, doc = document) {
  const root = getYandexRoot(doc);
  const buttons = qAll("button, [role='button']", root).filter((node) => !isDisabledControl(node));
  if (!buttons.length) return null;

  const signalsByAction = {
    [TRANSPORT_ACTIONS.NEXT]: ["следующ", "next", "skip forward", "вперёд", "вперед"],
    [TRANSPORT_ACTIONS.PREVIOUS]: ["предыдущ", "previous", "skip back", "назад"],
  };
  const signals = signalsByAction[action] || [];
  if (!signals.length) return null;

  for (const button of buttons) {
    const label = normalizeControlLabel(button);
    if (!label) continue;
    if (signals.some((signal) => label.includes(signal))) return button;
  }

  return null;
}

function clickYandexTransport(action, doc = document) {
  const button = findYandexTransportButton(action, doc);
  if (!button) return false;
  button.click();
  return true;
}

function executeYandexControl(action, value, context) {
  const doc = context?.document || document;
  const handlers = {
    [TRANSPORT_ACTIONS.NEXT]: () =>
      clickYandexTransport(TRANSPORT_ACTIONS.NEXT, doc)
        ? ok("yandex-next-button")
        : fail("yandex next control unavailable"),
    [TRANSPORT_ACTIONS.PREVIOUS]: () =>
      clickYandexTransport(TRANSPORT_ACTIONS.PREVIOUS, doc)
        ? ok("yandex-previous-button")
        : fail("yandex previous control unavailable"),
    [AUDIO_ACTIONS.VOLUME]: () => {
      const target = Number(value);
      if (!Number.isFinite(target)) return fail("invalid volume");
      return setYandexVolume(target, doc)
        ? ok("yandex-volume")
        : fail("yandex volume control unavailable");
    },
    [AUDIO_ACTIONS.MUTE]: () => {
      if (setYandexMuted(true, doc)) return ok("yandex-mute-button");
      return setYandexVolume(0, doc)
        ? ok("yandex-mute-volume")
        : fail("yandex mute control unavailable");
    },
    [AUDIO_ACTIONS.UNMUTE]: () => {
      if (setYandexMuted(false, doc)) return ok("yandex-unmute-button");
      const current = readYandexVolume(doc);
      if (Number.isFinite(current) && current > 0.001) return ok("yandex-unmute-keep");
      return setYandexVolume(0.5, doc)
        ? ok("yandex-unmute-volume")
        : fail("yandex unmute control unavailable");
    },
    [AUDIO_ACTIONS.MUTE_TOGGLE]: () => {
      if (toggleYandexMute(doc)) return ok("yandex-mute-toggle-button");
      const current = readYandexVolume(doc);
      const target = Number.isFinite(current) && current > 0.001 ? 0 : 0.5;
      return setYandexVolume(target, doc)
        ? ok("yandex-mute-toggle-volume")
        : fail("yandex mute toggle unavailable");
    },
  };

  return dispatchAction(action, handlers);
}

const sourceModule = {
  snapshotStrategy: "media-session-first",
  snapshotStrategyOptions: {
    requirePlaybackStartForPaused: true,
  },
  meta: {
    id: "yandex-music",
    label: "Yandex Music",
    sender: "YM",
    hosts: ["music.yandex.ru", "music.yandex.com", "music.yandex.by", "music.yandex.kz"],
    controlRoot: YANDEX_CONTROL_ROOT,
    controlActionKeywords: {
      playPause: ["пауза", "воспроизведение", "слушать", "play", "pause"],
      next: ["следующ", "next"],
      previous: ["предыдущ", "previous"],
      volume: ["громк", "volume", "sound", "звук"],
      muteToggle: ["выключить звук", "включить звук", "без звука", "mute", "unmute", "volume"],
    },
    controls: {
      playPause:
        '[class*="PlayerBar"] button[aria-label*="Пауза"], [class*="PlayerBar"] button[aria-label*="Воспроизведение"], [class*="PlayerBar"] button[aria-label*="Слушать"], [class*="PlayerBar"] button[aria-label*="Play"], [class*="PlayerBar"] button[aria-label*="Pause"]',
      next: '[class*="PlayerBar"] button[aria-label*="Следующ"], [class*="PlayerBar"] button[aria-label*="Next"]',
      previous:
        '[class*="PlayerBar"] button[aria-label*="Предыдущ"], [class*="PlayerBar"] button[aria-label*="Previous"]',
      muteToggle:
        '[class*="PlayerBar"] button[aria-label*="Выключить звук"], [class*="PlayerBar"] button[aria-label*="Включить звук"], [class*="PlayerBar"] button[aria-label*="Без звука"], [class*="PlayerBar"] button[aria-label*="Mute"], [class*="PlayerBar"] button[aria-label*="Unmute"]',
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
  extract: extractYandex,
  control: {
    execute(action, value, context) {
      return executeYandexControl(action, value, context);
    },
  },
};

export default sourceModule;
