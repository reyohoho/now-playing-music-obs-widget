import { defaultEnabledMap, defaultSourceOrder } from "@/shared/providers";
import { createDefaultTwitchControlRouter, normalizeTwitchControlRouter } from "@/shared/twitchControlRouter";
import { resolveLocale } from "@/shared/i18n/index";
import {
  isBuiltInWrapperRule,
  isWrapperSourceId,
  makeWrapperSourceId,
  normalizeWrapperRules,
} from "@/shared/wrapperRules";
import {
  WEB_MEDIA_MIN_DURATION_SEC_DEFAULT,
  WEB_MEDIA_SOURCE_ID,
  SOURCE_MIN_DURATION_SEC_DISABLED,
  defaultSourceMinDurationSecMap,
  normalizeSourceMinDurationSec,
  normalizeWebMediaMinDurationSec,
} from "@/shared/webMediaSettings";

export const DEFAULT_SETTINGS = {
  trackingEnabled: true,
  allowGenericWebInjection: true,
  sourceMinDurationSecMap: defaultSourceMinDurationSecMap(defaultSourceOrder()),
  liveVideoCoversInPopup: true,
  broadcastEnabled: true,
  debugMode: false,
  uiLocale: resolveLocale(),
  themeAppearance: "system",
  themeAccentColor: "teal",
  showNowPlayingBlockInPopup: true,
  sourceOrder: defaultSourceOrder(),
  sourceEnabledMap: defaultEnabledMap(),
  sourceBulkMuteIgnoreMap: Object.fromEntries(defaultSourceOrder().map((sourceId) => [sourceId, false])),
  primarySourceAutoPickMap: Object.fromEntries(defaultSourceOrder().map((sourceId) => [sourceId, true])),
  wrapperRules: [],
  obs: {
    enabled: false,
    host: "127.0.0.1",
    port: 4455,
    password: "",
    textSourceName: "NowPlaying",
    textTemplate: "{{artist}} - {{title}} ({{position}} / {{duration}})",
    browserEventEnabled: true,
    browserEventName: "nowplaying:update",
  },
  customCss: "",
  twitch: {
    enabled: false,
    controlEnabled: false,
    announceEnabled: false,
    channel: "",
    controlRouter: createDefaultTwitchControlRouter(),
    announceMinIntervalMs: 30000,
    announceTemplate: "Now playing: {{artist}} - {{title}}",
    clientId: "",
    username: "",
    oauthToken: "",
  },
};

export const LOCAL_STATE_KEYS = {
  ACTIVE_SNAPSHOT: "nowPlayingActiveSnapshot",
  DIAGNOSTICS: "nowPlayingDiagnostics",
  OBS_STATUS: "nowPlayingObsStatus",
  POPUP_STATE: "nowPlayingPopupState",
  TWITCH_STATUS: "nowPlayingTwitchStatus",
  TWITCH_LOG: "nowPlayingTwitchLog",
  WRAPPER_VOLUME_BY_HOST: "nowPlayingWrapperVolumeByHost",
  POPUP_WRAPPER_DRAFTS: "nowPlayingPopupWrapperDrafts",
  PRIMARY_STATE: "nowPlayingPrimaryState",
};

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

function normalizeUiLocale(value, fallback = "en") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ru" || normalized === "en") return normalized;
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("en")) return "en";
  return fallback;
}

function wrapperSourceIdsSet(wrapperRules) {
  const set = new Set();
  for (const rule of wrapperRules) {
    if (isBuiltInWrapperRule(rule)) continue;
    const sourceId = makeWrapperSourceId(rule.id);
    if (sourceId) set.add(sourceId);
  }
  return set;
}

function normalizeSourceOrder(sourceOrder, wrapperRules, fallbackOrder) {
  const raw = Array.isArray(sourceOrder) ? sourceOrder : [];
  const knownProviderIds = new Set(defaultSourceOrder());
  const allowedWrapperIds = wrapperSourceIdsSet(wrapperRules);
  const next = [];

  for (const item of raw) {
    const sourceId = String(item || "").trim();
    if (!sourceId || next.includes(sourceId)) continue;
    if (knownProviderIds.has(sourceId)) {
      next.push(sourceId);
      continue;
    }
    if (isWrapperSourceId(sourceId) && allowedWrapperIds.has(sourceId)) {
      next.push(sourceId);
    }
  }

  const defaults = Array.isArray(fallbackOrder) ? fallbackOrder : defaultSourceOrder();
  for (const providerId of defaults) {
    if (!next.includes(providerId)) next.push(providerId);
  }
  for (const wrapperId of allowedWrapperIds) {
    if (!next.includes(wrapperId)) next.push(wrapperId);
  }

  return next;
}

function normalizeSourceEnabledMap(sourceEnabledMap, wrapperRules) {
  const knownProviderIds = new Set(defaultSourceOrder());
  const allowedWrapperIds = wrapperSourceIdsSet(wrapperRules);
  const defaults = defaultEnabledMap();
  const raw = typeof sourceEnabledMap === "object" && sourceEnabledMap ? sourceEnabledMap : {};
  const next = {};

  for (const [providerId, enabled] of Object.entries(defaults)) {
    next[providerId] = parseBoolean(enabled, true);
  }
  for (const wrapperId of allowedWrapperIds) {
    next[wrapperId] = true;
  }

  for (const [sourceId, enabled] of Object.entries(raw)) {
    if (knownProviderIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, true);
      continue;
    }
    if (isWrapperSourceId(sourceId) && allowedWrapperIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, true);
    }
  }

  return next;
}

function normalizeSourceBulkMuteIgnoreMap(sourceBulkMuteIgnoreMap, wrapperRules) {
  const knownProviderIds = new Set(defaultSourceOrder());
  const allowedWrapperIds = wrapperSourceIdsSet(wrapperRules);
  const raw =
    typeof sourceBulkMuteIgnoreMap === "object" && sourceBulkMuteIgnoreMap ? sourceBulkMuteIgnoreMap : {};
  const next = {};

  for (const providerId of knownProviderIds) {
    next[providerId] = false;
  }
  for (const wrapperId of allowedWrapperIds) {
    next[wrapperId] = false;
  }

  for (const [sourceId, enabled] of Object.entries(raw)) {
    if (knownProviderIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, false);
      continue;
    }
    if (isWrapperSourceId(sourceId) && allowedWrapperIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, false);
    }
  }

  return next;
}

function normalizePrimarySourceAutoPickMap(primarySourceAutoPickMap, wrapperRules) {
  const knownProviderIds = new Set(defaultSourceOrder());
  const allowedWrapperIds = wrapperSourceIdsSet(wrapperRules);
  const raw =
    typeof primarySourceAutoPickMap === "object" && primarySourceAutoPickMap
      ? primarySourceAutoPickMap
      : {};
  const next = {};

  for (const sourceId of knownProviderIds) {
    next[sourceId] = true;
  }
  for (const wrapperId of allowedWrapperIds) {
    next[wrapperId] = true;
  }

  for (const [sourceId, enabled] of Object.entries(raw)) {
    if (knownProviderIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, true);
      continue;
    }
    if (isWrapperSourceId(sourceId) && allowedWrapperIds.has(sourceId)) {
      next[sourceId] = parseBoolean(enabled, true);
    }
  }

  return next;
}

function normalizeSourceMinDurationSecMap(
  sourceMinDurationSecMap,
  wrapperRules,
  legacyWebMediaMinDurationSec = undefined
) {
  const knownProviderIds = new Set(defaultSourceOrder());
  const allowedWrapperIds = wrapperSourceIdsSet(wrapperRules);
  const defaults = defaultSourceMinDurationSecMap([...knownProviderIds]);
  const raw =
    typeof sourceMinDurationSecMap === "object" && sourceMinDurationSecMap
      ? sourceMinDurationSecMap
      : {};
  const next = {};

  for (const sourceId of knownProviderIds) {
    next[sourceId] = normalizeSourceMinDurationSec(
      defaults[sourceId],
      SOURCE_MIN_DURATION_SEC_DISABLED
    );
  }
  for (const wrapperId of allowedWrapperIds) {
    next[wrapperId] = SOURCE_MIN_DURATION_SEC_DISABLED;
  }

  for (const [sourceId, value] of Object.entries(raw)) {
    if (knownProviderIds.has(sourceId)) {
      next[sourceId] = normalizeSourceMinDurationSec(
        value,
        defaults[sourceId] ?? SOURCE_MIN_DURATION_SEC_DISABLED
      );
      continue;
    }
    if (isWrapperSourceId(sourceId) && allowedWrapperIds.has(sourceId)) {
      next[sourceId] = normalizeSourceMinDurationSec(value, SOURCE_MIN_DURATION_SEC_DISABLED);
    }
  }

  if (legacyWebMediaMinDurationSec !== undefined && knownProviderIds.has(WEB_MEDIA_SOURCE_ID)) {
    next[WEB_MEDIA_SOURCE_ID] = normalizeWebMediaMinDurationSec(
      legacyWebMediaMinDurationSec,
      next[WEB_MEDIA_SOURCE_ID] ?? WEB_MEDIA_MIN_DURATION_SEC_DEFAULT
    );
  }

  return next;
}

function mergeSettings(base, patch) {
  const legacyEngineEnabled = patch?.engineEnabled;
  const trackingEnabled =
    typeof patch?.trackingEnabled === "boolean"
      ? patch.trackingEnabled
      : typeof legacyEngineEnabled === "boolean"
        ? legacyEngineEnabled
        : base.trackingEnabled;
  const broadcastEnabled =
    typeof patch?.broadcastEnabled === "boolean"
      ? patch.broadcastEnabled
      : typeof legacyEngineEnabled === "boolean"
        ? legacyEngineEnabled
        : base.broadcastEnabled;
  const mergedObs = {
    ...base.obs,
    ...(patch?.obs ?? {}),
  };
  const mergedTwitch = {
    ...base.twitch,
    ...(patch?.twitch ?? {}),
  };
  const wrapperRules = normalizeWrapperRules(patch?.wrapperRules ?? base.wrapperRules);
  const mergedSourceEnabledMap = {
    ...base.sourceEnabledMap,
    ...(patch?.sourceEnabledMap ?? {}),
  };
  const mergedSourceBulkMuteIgnoreMap = {
    ...(base.sourceBulkMuteIgnoreMap || {}),
    ...(patch?.sourceBulkMuteIgnoreMap ?? {}),
  };
  const mergedSourceMinDurationSecMap = {
    ...(base.sourceMinDurationSecMap || {}),
    ...(patch?.sourceMinDurationSecMap ?? {}),
  };
  const mergedPrimarySourceAutoPickMap = {
    ...(base.primarySourceAutoPickMap || {}),
    ...(patch?.primarySourceAutoPickMap ?? {}),
  };

  return {
    ...base,
    ...patch,
    uiLocale: normalizeUiLocale(patch?.uiLocale, base.uiLocale),
    trackingEnabled,
    allowGenericWebInjection: parseBoolean(
      patch?.allowGenericWebInjection,
      base.allowGenericWebInjection
    ),
    sourceMinDurationSecMap: normalizeSourceMinDurationSecMap(
      mergedSourceMinDurationSecMap,
      wrapperRules,
      patch?.webMediaMinDurationSec
    ),
    liveVideoCoversInPopup: parseBoolean(
      patch?.liveVideoCoversInPopup,
      base.liveVideoCoversInPopup
    ),
    broadcastEnabled,
    showNowPlayingBlockInPopup: parseBoolean(
      patch?.showNowPlayingBlockInPopup,
      base.showNowPlayingBlockInPopup
    ),
    sourceOrder: normalizeSourceOrder(
      Array.isArray(patch?.sourceOrder) ? patch.sourceOrder : base.sourceOrder,
      wrapperRules,
      base.sourceOrder
    ),
    sourceEnabledMap: normalizeSourceEnabledMap(
      mergedSourceEnabledMap,
      wrapperRules
    ),
    sourceBulkMuteIgnoreMap: normalizeSourceBulkMuteIgnoreMap(
      mergedSourceBulkMuteIgnoreMap,
      wrapperRules
    ),
    primarySourceAutoPickMap: normalizePrimarySourceAutoPickMap(
      mergedPrimarySourceAutoPickMap,
      wrapperRules
    ),
    wrapperRules,
    obs: {
      ...mergedObs,
      enabled: parseBoolean(mergedObs.enabled, base.obs.enabled),
      browserEventEnabled: parseBoolean(mergedObs.browserEventEnabled, base.obs.browserEventEnabled),
    },
    twitch: {
      ...mergedTwitch,
      enabled: parseBoolean(mergedTwitch.enabled, base.twitch.enabled),
      controlEnabled: parseBoolean(mergedTwitch.controlEnabled, base.twitch.controlEnabled),
      announceEnabled: parseBoolean(mergedTwitch.announceEnabled, base.twitch.announceEnabled),
      controlRouter: normalizeTwitchControlRouter(
        mergedTwitch.controlRouter ?? base.twitch.controlRouter
      ),
    },
  };
}

export async function getSettings() {
  const raw = await chrome.storage.sync.get({ settings: DEFAULT_SETTINGS });
  return mergeSettings(DEFAULT_SETTINGS, raw.settings);
}

export async function patchSettings(patch) {
  const current = await getSettings();
  const next = mergeSettings(current, patch);
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function getLocalState(key, fallback) {
  const result = await chrome.storage.local.get({ [key]: fallback });
  return result[key];
}

export async function setLocalState(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
