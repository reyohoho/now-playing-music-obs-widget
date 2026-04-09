import { resolveLocale } from "@/shared/i18n/index";
import { normalizeTwitchControlRouter } from "@/shared/twitchControlRouter";
import { defaultSourceOrder } from "@/shared/providers";
import { makeWrapperSourceId, normalizeWrapperRules } from "@/shared/wrapperRules";
import {
  SOURCE_MIN_DURATION_SEC_DISABLED,
  defaultSourceMinDurationSecMap,
  normalizeSourceMinDurationSec,
} from "@/shared/webMediaSettings";

export const RADIX_ACCENTS = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
];

export const DEFAULT_TWITCH_ANNOUNCE_TEMPLATE = "Now playing: {{artist}} - {{title}}";

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off" || normalized === "") {
      return false;
    }
  }
  return fallback;
}

function normalizeSourceBulkMuteIgnoreMapForModel(rawMap, wrapperRules = []) {
  const sourceIds = new Set(defaultSourceOrder());
  for (const rule of wrapperRules) {
    const sourceId = makeWrapperSourceId(rule?.id);
    if (!sourceId) continue;
    sourceIds.add(sourceId);
  }

  const source =
    rawMap && typeof rawMap === "object"
      ? rawMap
      : {};
  const next = {};
  for (const sourceId of sourceIds) {
    next[sourceId] = parseBoolean(source[sourceId], false);
  }
  return next;
}

function normalizeSourceMinDurationSecMapForModel(rawMap, wrapperRules = []) {
  const sourceIds = new Set(defaultSourceOrder());
  for (const rule of wrapperRules) {
    const sourceId = makeWrapperSourceId(rule?.id);
    if (!sourceId) continue;
    sourceIds.add(sourceId);
  }

  const defaults = defaultSourceMinDurationSecMap([...sourceIds]);
  const source =
    rawMap && typeof rawMap === "object"
      ? rawMap
      : {};
  const next = {};
  for (const sourceId of sourceIds) {
    next[sourceId] = normalizeSourceMinDurationSec(
      source[sourceId],
      defaults[sourceId] ?? SOURCE_MIN_DURATION_SEC_DISABLED
    );
  }
  return next;
}

export function normalizeAppearance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "light" || normalized === "dark") return normalized;
  return "system";
}

export function normalizeAccentColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return RADIX_ACCENTS.includes(normalized) ? normalized : "teal";
}

export function normalizeUiLocale(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ru" || normalized.startsWith("ru")) return "ru";
  if (normalized === "en" || normalized.startsWith("en")) return "en";
  return "en";
}

export function readInitialThemeFromStorage(storageApi = globalThis?.localStorage) {
  let appearance = "system";
  let accentColor = "teal";
  try {
    if (storageApi && typeof storageApi.getItem === "function") {
      appearance = normalizeAppearance(storageApi.getItem("nph.themeAppearance"));
      accentColor = normalizeAccentColor(storageApi.getItem("nph.themeAccentColor"));
    }
  } catch {
    // ignore
  }
  return { appearance, accentColor };
}

export function resolveAppearance(appearance, systemDark) {
  const normalized = normalizeAppearance(appearance);
  if (normalized !== "system") return normalized;
  return systemDark ? "dark" : "light";
}

export function modelFromSettings(settings = {}, fallbackLocale = resolveLocale()) {
  const obs = settings.obs || {};
  const twitch = settings.twitch || {};
  const normalizedWrapperRules = normalizeWrapperRules(settings.wrapperRules || []);
  return {
    trackingEnabled: settings.trackingEnabled !== false,
    allowGenericWebInjection: settings.allowGenericWebInjection !== false,
    sourceBulkMuteIgnoreMap: normalizeSourceBulkMuteIgnoreMapForModel(
      settings.sourceBulkMuteIgnoreMap,
      normalizedWrapperRules
    ),
    sourceMinDurationSecMap: normalizeSourceMinDurationSecMapForModel(
      settings.sourceMinDurationSecMap,
      normalizedWrapperRules
    ),
    liveVideoCoversInPopup: settings.liveVideoCoversInPopup === true,
    showNowPlayingBlockInPopup: settings.showNowPlayingBlockInPopup !== false,
    debugMode: Boolean(settings.debugMode),
    uiLocale: normalizeUiLocale(settings.uiLocale || fallbackLocale),
    themeAppearance: normalizeAppearance(settings.themeAppearance),
    themeAccentColor: normalizeAccentColor(settings.themeAccentColor),
    customCss: settings.customCss || "",
    obs: {
      enabled: Boolean(obs.enabled),
      host: obs.host || "127.0.0.1",
      port: Number(obs.port) || 4455,
      password: obs.password || "",
      textSourceName: obs.textSourceName || "NowPlaying",
      textTemplate: obs.textTemplate || "{{artist}} - {{title}}",
      browserEventEnabled: obs.browserEventEnabled !== false,
      browserEventName: obs.browserEventName || "nowplaying:update",
    },
    twitch: {
      enabled: twitch.enabled !== false,
      controlEnabled: Boolean(twitch.controlEnabled),
      announceEnabled: Boolean(twitch.announceEnabled),
      channel: twitch.channel || "",
      controlRouter: normalizeTwitchControlRouter(twitch.controlRouter),
      username: twitch.username || "",
      clientId: twitch.clientId || "",
      oauthToken: twitch.oauthToken || "",
      announceMinIntervalMs: Number(twitch.announceMinIntervalMs) || 30000,
      announceTemplate: twitch.announceTemplate || DEFAULT_TWITCH_ANNOUNCE_TEMPLATE,
    },
    primarySourceAutoPickMap:
      settings.primarySourceAutoPickMap && typeof settings.primarySourceAutoPickMap === "object"
        ? { ...settings.primarySourceAutoPickMap }
        : {},
    wrapperRules: normalizedWrapperRules,
  };
}

export function buildPatch(model = {}) {
  const obs = model.obs || {};
  const twitch = model.twitch || {};
  const normalizedWrapperRules = normalizeWrapperRules(model.wrapperRules);
  return {
    trackingEnabled: model.trackingEnabled,
    allowGenericWebInjection: model.allowGenericWebInjection !== false,
    sourceBulkMuteIgnoreMap: normalizeSourceBulkMuteIgnoreMapForModel(
      model.sourceBulkMuteIgnoreMap,
      normalizedWrapperRules
    ),
    sourceMinDurationSecMap: normalizeSourceMinDurationSecMapForModel(
      model.sourceMinDurationSecMap,
      normalizedWrapperRules
    ),
    liveVideoCoversInPopup: model.liveVideoCoversInPopup === true,
    showNowPlayingBlockInPopup: model.showNowPlayingBlockInPopup !== false,
    debugMode: model.debugMode,
    uiLocale: normalizeUiLocale(model.uiLocale),
    themeAppearance: normalizeAppearance(model.themeAppearance),
    themeAccentColor: normalizeAccentColor(model.themeAccentColor),
    obs: {
      enabled: obs.enabled,
      host: String(obs.host || "").trim() || "127.0.0.1",
      port: Number(obs.port) || 4455,
      password: obs.password || "",
      textSourceName: String(obs.textSourceName || "").trim() || "NowPlaying",
      textTemplate: String(obs.textTemplate || "").trim() || "{{artist}} - {{title}}",
      browserEventEnabled: obs.browserEventEnabled,
      browserEventName: String(obs.browserEventName || "").trim() || "nowplaying:update",
    },
    customCss: model.customCss || "",
    primarySourceAutoPickMap:
      model.primarySourceAutoPickMap && typeof model.primarySourceAutoPickMap === "object"
        ? { ...model.primarySourceAutoPickMap }
        : {},
    twitch: {
      enabled: twitch.enabled,
      controlEnabled: twitch.controlEnabled,
      announceEnabled: twitch.announceEnabled,
      channel: String(twitch.channel || "").trim(),
      controlRouter: normalizeTwitchControlRouter(twitch.controlRouter),
      username: String(twitch.username || "").trim(),
      clientId: String(twitch.clientId || "").trim(),
      oauthToken: String(twitch.oauthToken || "").trim(),
      announceMinIntervalMs: Number(twitch.announceMinIntervalMs) || 30000,
      announceTemplate: String(twitch.announceTemplate || "").trim() || DEFAULT_TWITCH_ANNOUNCE_TEMPLATE,
    },
    wrapperRules: normalizedWrapperRules,
  };
}
