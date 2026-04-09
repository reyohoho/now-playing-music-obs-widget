import { normalizeSnapshot } from "@/core/normalize";
import {
  buildActiveSessions,
  buildProviderRows,
  findWrapperMatchForInstance,
} from "@/core/resolver";
import { createPrimarySessionState, reducePrimarySession } from "@/core/primarySession";
import { SourceRegistry } from "@/core/sourceRegistry";
import { renderTrackTemplate } from "@/core/template";
import { ObsClient } from "@/background/obsClient";
import { TwitchService } from "@/background/twitch/service";
import {
  normalizeVolumeValue,
  normalizeWrapperVolumeByHost,
  rememberWrapperVolumeByHost,
  resolveVolumeForControlAction,
} from "@/background/wrapperVolumeMemory";
import { createPrimaryLifecycle } from "@/background/serviceWorker/primaryLifecycle";
import { createControlExecution } from "@/background/serviceWorker/controlExecution";
import { createWrapperOverlayFlow } from "@/background/serviceWorker/wrapperOverlayFlow";
import { registerRuntimeMessageHandlers } from "@/background/serviceWorker/messageHandlers";
import { syncDynamicContentScriptRegistration } from "@/background/contentScriptRegistry";
import { syncExtensionActionBadge } from "@/background/actionBadge";
import { MSG } from "@/shared/messages";
import { PROVIDERS, defaultSourceOrder, getProviderById } from "@/shared/providers";
import {
  getWrapperControlMode,
  getWrapperControlSelector,
  normalizeWrapperControlSelectors,
  normalizeWrapperRules,
  WRAPPER_CONTROL_ACTIONS,
} from "@/shared/wrapperRules";
import {
  makePopupWrapperDraftKey,
  normalizePopupTabUrl,
  POPUP_WRAPPER_DRAFT_CREATE_RULE_ID,
  resolvePickerStartTransition,
} from "@/shared/popupPicker";
import {
  DEFAULT_SETTINGS,
  LOCAL_STATE_KEYS,
  getLocalState,
  getSettings,
  patchSettings,
  setLocalState,
} from "@/shared/storage";

const sourceRegistry = new SourceRegistry();

const runtime = {
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  primaryState: createPrimarySessionState(),
  providerRows: [],
  diagnostics: [],
  obsStatus: {
    state: "idle",
    message: "Ожидание запуска.",
    lastError: "",
    updatedAt: Date.now(),
  },
  twitchStatus: {
    state: "disabled",
    message: "Twitch интеграция выключена.",
    lastError: "",
    updatedAt: Date.now(),
  },
  twitchLog: [],
  wrapperVolumeByHost: {},
  wrapperVolumeAppliedBySession: {},
  popupWrapperDrafts: {},
  audibleFallbackByTab: {},
};

let wrapperVolumeLoadPromise = null;
let primaryStateLoadPromise = null;
let twitchService;
let overlayFlow = null;

let publishState = async () => {};
let applySettingsAndSync = async () => runtime.settings;
let reloadSettings = async () => {};
let ensureSettingsLoaded = async () => {};
let applySourceOrder = async () => {};
let applySourceEnabled = async () => {};
let applyTrackingEnabled = async () => {};
let buildStatePayload = () => ({});
let getEffectiveSettings = () => runtime.settings;
let buildActiveView = () => ({
  activeSessions: [],
  primarySessionId: "",
  activeSnapshot: null,
});
let handleControlActive = async () => ({ ok: false, message: "control unavailable" });
let handleControlSession = async () => ({ ok: false, message: "control unavailable" });

const DIAGNOSTIC_LIMIT = 120;
const WRAPPER_VOLUME_EPSILON = 0.01;
const tabMinContextStartedAt = new Map();
const GENERIC_WEB_MEDIA_SOURCE_ID = "web-media";
const AUDIBLE_FALLBACK_FRAME_ID = 2147483000;

function debugLog(event, payload) {
  if (!runtime.settings?.debugMode) return;
  console.debug(`[Now Playing][bg] ${event}`, payload || "");
}

async function syncContentScriptRegistration(settings = runtime.settings, reason = "unknown") {
  try {
    const result = await syncDynamicContentScriptRegistration({
      settings,
      providers: PROVIDERS,
    });
    const audibleChanged = await refreshAudibleFallbacks(`registration:${reason}`);
    debugLog("content script registration sync", {
      reason,
      ok: result.ok,
      matchCount: result.matches?.length || 0,
      audibleChanged,
    });
    if (audibleChanged) await publishState();
  } catch (error) {
    console.warn("[Now Playing][bg] content script registration sync failed", {
      reason,
      message: String(error || ""),
    });
  }
}

function sanitizeDiagnosticPayload(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch (_) {
    return { nonSerializable: true };
  }
}

function pushDiagnostic(entry) {
  runtime.diagnostics = [...runtime.diagnostics, entry].slice(-DIAGNOSTIC_LIMIT);
}

function isServiceEnabled(settings = runtime.settings) {
  return settings?.trackingEnabled !== false;
}

function getRuntimeObsSettings(settings = runtime.settings) {
  const obs = settings?.obs || {};
  if (isServiceEnabled(settings)) return obs;
  return {
    ...obs,
    enabled: false,
  };
}

function getRuntimeTwitchSettings(settings = runtime.settings) {
  const twitch = settings?.twitch || {};
  if (isServiceEnabled(settings)) return twitch;
  return {
    ...twitch,
    enabled: false,
  };
}

function getSessionFrameOptions(session) {
  return Number.isInteger(session?.frameId) ? { frameId: session.frameId } : undefined;
}

function normalizeContextStartedAt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed > 0 ? parsed : 0;
}

function markTabNavigation(tabId, at = Date.now()) {
  if (!Number.isInteger(tabId)) return;
  const marker = normalizeContextStartedAt(at) || Date.now();
  const previous = tabMinContextStartedAt.get(tabId) || 0;
  tabMinContextStartedAt.set(tabId, Math.max(previous, marker));
}

function isStaleContextMessage(tabId, message) {
  if (!Number.isInteger(tabId)) return false;
  const minContextStartedAt = tabMinContextStartedAt.get(tabId) || 0;
  if (!minContextStartedAt) return false;

  const contextStartedAt = normalizeContextStartedAt(message?.contextStartedAt);
  if (!contextStartedAt) return false;
  return contextStartedAt < minContextStartedAt;
}

function clearWrapperAppliedByPrefix(prefix) {
  if (!prefix) return;
  const next = { ...runtime.wrapperVolumeAppliedBySession };
  let changed = false;
  for (const key of Object.keys(next)) {
    if (!key.startsWith(prefix)) continue;
    delete next[key];
    changed = true;
  }
  if (changed) runtime.wrapperVolumeAppliedBySession = next;
}

function clearWrapperAppliedForSession(sessionId) {
  const key = String(sessionId || "");
  if (!key) return;
  if (!(key in runtime.wrapperVolumeAppliedBySession)) return;
  const next = { ...runtime.wrapperVolumeAppliedBySession };
  delete next[key];
  runtime.wrapperVolumeAppliedBySession = next;
}

function parseTabHost(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = String(parsed.hostname || "").trim().toLowerCase();
    return host.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function isTrackableTabUrl(url) {
  const value = String(url || "").trim().toLowerCase();
  return value.startsWith("http://") || value.startsWith("https://");
}

function instancesByTab(tabId) {
  return sourceRegistry.values().filter((instance) => instance.tabId === tabId);
}

function removeAudibleFallbackForTab(tabId) {
  if (!Number.isInteger(tabId)) return false;
  const key = runtime.audibleFallbackByTab?.[tabId];
  if (!key) return false;
  delete runtime.audibleFallbackByTab[tabId];
  clearWrapperAppliedForSession(key);
  return sourceRegistry.removeKey(key);
}

function clearAllAudibleFallbacks() {
  const keys = Object.values(runtime.audibleFallbackByTab || {});
  let changed = false;
  for (const key of keys) {
    clearWrapperAppliedForSession(key);
    changed = sourceRegistry.removeKey(key) || changed;
  }
  runtime.audibleFallbackByTab = {};
  return changed;
}

function buildAudibleFallbackSnapshot(tab, playbackState = "playing") {
  const provider = getProviderById(GENERIC_WEB_MEDIA_SOURCE_ID);
  const sourceId = provider?.id || GENERIC_WEB_MEDIA_SOURCE_ID;
  const sourceLabel = provider?.label || "Web Media Session";
  const tabTitle = String(tab?.title || "").trim();
  const hostLabel = parseTabHost(tab?.url);
  const normalizedState = String(playbackState || "").toLowerCase() === "paused" ? "paused" : "playing";

  return normalizeSnapshot({
    sourceId,
    sourceLabel,
    title: tabTitle,
    artist: hostLabel,
    playbackState: normalizedState,
    isPlaying: normalizedState === "playing",
    isLive: true,
    updatedAt: Date.now(),
  });
}

function upsertAudibleFallbackForTab(tab, playbackState = "playing") {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) return false;
  const normalizedState = String(playbackState || "").toLowerCase() === "paused" ? "paused" : "playing";

  const existingKey = runtime.audibleFallbackByTab?.[tabId] || "";
  const existing = existingKey ? sourceRegistry.get(existingKey) : null;
  const nextSnapshot = buildAudibleFallbackSnapshot(tab, normalizedState);

  if (
    existing &&
    String(existing?.snapshot?.playbackState || "") === nextSnapshot.playbackState &&
    String(existing?.snapshot?.title || "") === String(nextSnapshot.title || "") &&
    String(existing?.snapshot?.artist || "") === String(nextSnapshot.artist || "") &&
    String(existing?.url || "") === String(tab?.url || "")
  ) {
    return false;
  }

  const key = sourceRegistry.upsert({
    tabId,
    frameId: AUDIBLE_FALLBACK_FRAME_ID,
    tabTitle: String(tab?.title || ""),
    url: String(tab?.url || ""),
    snapshot: nextSnapshot,
  });
  runtime.audibleFallbackByTab[tabId] = key;
  return true;
}

function findLatestInstanceByTabAndSource(tabId, sourceId) {
  const items = sourceRegistry
    .values()
    .filter(
      (instance) =>
        instance.tabId === tabId && String(instance?.snapshot?.sourceId || "") === sourceId
    )
    .sort((a, b) => Number(b?.snapshot?.updatedAt || 0) - Number(a?.snapshot?.updatedAt || 0));
  return items[0] || null;
}

function keepWebMediaAsPausedOnMissingRemove(tabId, frameId, providerId, sender) {
  if (providerId !== GENERIC_WEB_MEDIA_SOURCE_ID) return false;

  const exactKey = SourceRegistry.key(tabId, providerId, frameId);
  const existing = sourceRegistry.get(exactKey) || findLatestInstanceByTabAndSource(tabId, providerId);
  if (!existing?.snapshot) return false;

  const pausedSnapshot = normalizeSnapshot({
    ...existing.snapshot,
    playbackState: "paused",
    isPlaying: false,
    updatedAt: Date.now(),
  });

  sourceRegistry.upsert({
    tabId,
    frameId: existing.frameId,
    tabTitle: sender.tab?.title || existing.tabTitle || "",
    url: sender.tab?.url || existing.url || "",
    snapshot: pausedSnapshot,
  });

  return true;
}

function shouldRetainWebMediaOnRemove(providerId, reason) {
  if (providerId !== GENERIC_WEB_MEDIA_SOURCE_ID) return false;
  const normalized = String(reason || "").trim().toLowerCase();
  if (!normalized) return true;

  const destructiveReasons = new Set([
    "pagehide",
    "unload",
    "tracking_disabled",
    "generic_injection_disabled",
    "context_stop",
    "runtime_unavailable",
    "send_exception",
    "extension_context_invalidated",
  ]);

  return !destructiveReasons.has(normalized);
}

function ensureAudibleFallbackForTab(tab) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) return false;

  if (!isServiceEnabled(runtime.settings) || runtime.settings?.allowGenericWebInjection === false) {
    return removeAudibleFallbackForTab(tabId);
  }

  if (!isTrackableTabUrl(tab?.url)) {
    return removeAudibleFallbackForTab(tabId);
  }

  const instances = instancesByTab(tabId);
  const hasNonGeneric = instances.some(
    (instance) => String(instance?.snapshot?.sourceId || "") !== GENERIC_WEB_MEDIA_SOURCE_ID
  );
  if (hasNonGeneric) return removeAudibleFallbackForTab(tabId);

  const hasRealGeneric = instances.some(
    (instance) =>
      String(instance?.snapshot?.sourceId || "") === GENERIC_WEB_MEDIA_SOURCE_ID &&
      Number(instance?.frameId) !== AUDIBLE_FALLBACK_FRAME_ID
  );
  if (hasRealGeneric) return removeAudibleFallbackForTab(tabId);

  if (tab?.audible === true) {
    return upsertAudibleFallbackForTab(tab, "playing");
  }

  if (runtime.audibleFallbackByTab?.[tabId]) {
    return upsertAudibleFallbackForTab(tab, "paused");
  }

  return false;
}

async function syncAudibleFallbacksFromTabs(tabs = []) {
  if (!isServiceEnabled(runtime.settings) || runtime.settings?.allowGenericWebInjection === false) {
    return clearAllAudibleFallbacks();
  }

  let changed = false;
  const seenTabIds = new Set();
  const list = Array.isArray(tabs) ? tabs : [];

  for (const tab of list) {
    if (!Number.isInteger(tab?.id)) continue;
    seenTabIds.add(tab.id);
    changed = ensureAudibleFallbackForTab(tab) || changed;
  }

  for (const tabIdRaw of Object.keys(runtime.audibleFallbackByTab || {})) {
    const tabId = Number(tabIdRaw);
    if (seenTabIds.has(tabId)) continue;
    changed = removeAudibleFallbackForTab(tabId) || changed;
  }

  return changed;
}

async function refreshAudibleFallbacks(reason = "refresh") {
  if (!chrome?.tabs?.query) return false;
  try {
    const tabs = await chrome.tabs.query({});
    const changed = await syncAudibleFallbacksFromTabs(tabs);
    if (changed) {
      debugLog("audible fallback updated", { reason });
    }
    return changed;
  } catch (_) {
    return false;
  }
}

function normalizePrimaryStateRecord(raw) {
  const fallback = createPrimarySessionState();
  if (!raw || typeof raw !== "object") return fallback;

  return {
    primarySessionId: String(raw.primarySessionId || ""),
    sessionCount: Math.max(0, Number(raw.sessionCount) || 0),
    selectedByUser: raw.selectedByUser === true,
    selectedSourceId: String(raw.selectedSourceId || "").trim().toLowerCase(),
  };
}

async function ensurePrimaryStateLoaded() {
  if (primaryStateLoadPromise) return primaryStateLoadPromise;
  primaryStateLoadPromise = getLocalState(
    LOCAL_STATE_KEYS.PRIMARY_STATE,
    createPrimarySessionState()
  ).then((value) => {
    runtime.primaryState = normalizePrimaryStateRecord(value);
  });
  try {
    await primaryStateLoadPromise;
  } finally {
    primaryStateLoadPromise = null;
  }
}

async function ensureWrapperVolumeMemoryLoaded() {
  if (wrapperVolumeLoadPromise) return wrapperVolumeLoadPromise;
  wrapperVolumeLoadPromise = getLocalState(LOCAL_STATE_KEYS.WRAPPER_VOLUME_BY_HOST, {}).then((value) => {
    runtime.wrapperVolumeByHost = normalizeWrapperVolumeByHost(value);
  });
  try {
    await wrapperVolumeLoadPromise;
  } finally {
    wrapperVolumeLoadPromise = null;
  }
}

async function persistWrapperVolumeMemory() {
  try {
    await setLocalState(LOCAL_STATE_KEYS.WRAPPER_VOLUME_BY_HOST, runtime.wrapperVolumeByHost);
  } catch (error) {
    console.warn("[Now Playing][bg] wrapper volume persist failed", error);
  }
}

async function rememberWrapperVolume(host, value) {
  const next = rememberWrapperVolumeByHost(runtime.wrapperVolumeByHost, host, value);
  if (!next.changed) return;
  runtime.wrapperVolumeByHost = next.map;
  await persistWrapperVolumeMemory();
}

async function rememberWrapperVolumeFromControl(target, action, value, result) {
  if (!result?.ok) return;
  if (!target) return;
  if (!["volume", "mute", "unmute", "muteToggle"].includes(String(action || ""))) return;

  const match = findWrapperMatchForInstance(target, getEffectiveSettings());
  if (!match?.host) return;

  const nextVolume = resolveVolumeForControlAction(
    action,
    value,
    target?.snapshot,
    runtime.wrapperVolumeByHost[match.host]
  );
  if (!Number.isFinite(nextVolume)) return;

  await rememberWrapperVolume(match.host, nextVolume);
}

async function maybeApplyWrapperVolume(instance) {
  if (!instance) return;

  const match = findWrapperMatchForInstance(instance, getEffectiveSettings());
  if (!match?.host) return;

  const rememberedVolume = normalizeVolumeValue(runtime.wrapperVolumeByHost[match.host]);
  if (!Number.isFinite(rememberedVolume)) return;

  const sessionId = String(instance.key || "");
  if (!sessionId) return;

  const snapshotVolume = normalizeVolumeValue(instance?.snapshot?.volume);
  if (Number.isFinite(snapshotVolume) && Math.abs(snapshotVolume - rememberedVolume) <= WRAPPER_VOLUME_EPSILON) {
    runtime.wrapperVolumeAppliedBySession = {
      ...runtime.wrapperVolumeAppliedBySession,
      [sessionId]: rememberedVolume,
    };
    return;
  }

  const previouslyApplied = normalizeVolumeValue(runtime.wrapperVolumeAppliedBySession[sessionId]);
  if (Number.isFinite(previouslyApplied) && Math.abs(previouslyApplied - rememberedVolume) < 0.001) return;

  try {
    const result = await chrome.tabs.sendMessage(
      instance.tabId,
      {
        type: MSG.CONTROL_EXEC,
        action: "volume",
        value: rememberedVolume,
        sourceId: instance.snapshot.sourceId,
      },
      getSessionFrameOptions(instance)
    );

    if (result?.ok) {
      runtime.wrapperVolumeAppliedBySession = {
        ...runtime.wrapperVolumeAppliedBySession,
        [sessionId]: rememberedVolume,
      };
    }
  } catch (error) {
    debugLog("wrapper volume apply failed", {
      message: String(error || ""),
      tabId: instance.tabId,
      sourceId: instance?.snapshot?.sourceId,
    });
  }
}

function shouldPushObsHideBeforeSettingsUpdate(previous, next) {
  const wasTrackingEnabled = previous?.trackingEnabled !== false;
  const willTrackingEnabled = next?.trackingEnabled !== false;

  const wasObsEnabled = previous?.obs?.enabled === true;
  const wasObsBrowserEventEnabled = previous?.obs?.browserEventEnabled !== false;
  const willObsEnabled = next?.obs?.enabled === true;

  if (!wasObsEnabled || !wasObsBrowserEventEnabled) return false;

  const trackingDisabled = wasTrackingEnabled && !willTrackingEnabled;
  const obsDisabled = wasObsEnabled && !willObsEnabled;

  return trackingDisabled || obsDisabled;
}

const obsClient = new ObsClient((status) => {
  runtime.obsStatus = status;
  void setLocalState(LOCAL_STATE_KEYS.OBS_STATUS, status);
  void publishState();
});

function setupTwitchService() {
  twitchService = new TwitchService({
    onStatus: (status) => {
      runtime.twitchStatus = status;
      void setLocalState(LOCAL_STATE_KEYS.TWITCH_STATUS, status);
      void publishState({ skipTwitchSync: true });
    },
    onLog: (entries) => {
      runtime.twitchLog = entries;
      void setLocalState(LOCAL_STATE_KEYS.TWITCH_LOG, entries);
      void publishState({ skipTwitchSync: true });
    },
    onControl: (action, value) => handleControlActive(action, value),
    getActiveSnapshot: () => buildActiveView(getEffectiveSettings()).activeSnapshot,
    patchSettings: (patch) => applySettingsAndSync(patch),
  });
}

setupTwitchService();

const primaryLifecycle = createPrimaryLifecycle({
  MSG,
  runtime,
  sourceRegistry,
  PROVIDERS,
  defaultSourceOrder,
  normalizeWrapperRules,
  buildProviderRows,
  buildActiveSessions,
  reducePrimarySession,
  renderTrackTemplate,
  createPrimarySessionState,
  setLocalState,
  patchSettings,
  getSettings,
  LOCAL_STATE_KEYS,
  obsClient,
  twitchService,
  debugLog,
  shouldPushObsHideBeforeSettingsUpdate,
  ensurePrimaryStateLoaded,
  ensureWrapperVolumeMemoryLoaded,
  ensurePopupDraftsLoaded: async () => {
    if (!overlayFlow) return;
    await overlayFlow.ensurePopupDraftsLoaded();
  },
  isServiceEnabled,
  getRuntimeObsSettings,
  getRuntimeTwitchSettings,
  syncActionBadge: (payload) =>
    syncExtensionActionBadge({
      actionApi: chrome?.action,
      settings: runtime.settings,
      obsStatus: runtime.obsStatus,
      twitchStatus: runtime.twitchStatus,
      activeSnapshot: payload?.activeSnapshot || null,
    }),
  onSettingsApplied: (settings, context) =>
    syncContentScriptRegistration(settings, context?.reason || "settings"),
});

publishState = primaryLifecycle.publishState;
applySettingsAndSync = primaryLifecycle.applySettingsAndSync;
reloadSettings = primaryLifecycle.reloadSettings;
ensureSettingsLoaded = primaryLifecycle.ensureSettingsLoaded;
applySourceOrder = primaryLifecycle.applySourceOrder;
applySourceEnabled = primaryLifecycle.applySourceEnabled;
applyTrackingEnabled = primaryLifecycle.applyTrackingEnabled;
buildStatePayload = primaryLifecycle.buildStatePayload;
getEffectiveSettings = primaryLifecycle.getEffectiveSettings;
buildActiveView = primaryLifecycle.buildActiveView;

const controlExecution = createControlExecution({
  runtime,
  sourceRegistry,
  findWrapperMatchForInstance,
  getWrapperControlSelector,
  getWrapperControlMode,
  getEffectiveSettings: () => getEffectiveSettings(),
  MSG,
  buildActiveView: (settings) => buildActiveView(settings),
  getSessionFrameOptions,
  rememberWrapperVolumeFromControl,
  pushDiagnostic,
  sanitizeDiagnosticPayload,
  debugLog,
  publishState: (options) => publishState(options),
});

handleControlActive = controlExecution.handleControlActive;
handleControlSession = controlExecution.handleControlSession;

overlayFlow = createWrapperOverlayFlow({
  runtime,
  WRAPPER_CONTROL_ACTIONS,
  normalizeWrapperRules,
  normalizeWrapperControlSelectors,
  resolvePickerStartTransition,
  normalizePopupTabUrl,
  makePopupWrapperDraftKey,
  POPUP_WRAPPER_DRAFT_CREATE_RULE_ID,
  MSG,
  getLocalState,
  setLocalState,
  LOCAL_STATE_KEYS,
  applySettingsAndSync: (patch) => applySettingsAndSync(patch),
  publishState: (options) => publishState(options),
});

async function handleSourceUpdate(message, sender) {
  if (!isServiceEnabled(runtime.settings)) return;
  await ensureWrapperVolumeMemoryLoaded();

  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  if (isStaleContextMessage(tabId, message)) {
    debugLog("source update skipped: stale context", {
      tabId,
      frameId,
      contextStartedAt: Number(message?.contextStartedAt) || 0,
      minContextStartedAt: tabMinContextStartedAt.get(tabId) || 0,
    });
    return;
  }

  const provider = getProviderById(message.providerId || message.snapshot?.sourceId);
  if (!provider) return;

  if (
    provider.id !== GENERIC_WEB_MEDIA_SOURCE_ID ||
    frameId !== AUDIBLE_FALLBACK_FRAME_ID
  ) {
    removeAudibleFallbackForTab(tabId);
  }

  const snapshot = normalizeSnapshot({
    ...message.snapshot,
    sourceId: provider.id,
    sourceLabel: provider.label,
    controlCapabilities:
      message?.snapshot?.controlCapabilities && typeof message.snapshot.controlCapabilities === "object"
        ? message.snapshot.controlCapabilities
        : provider.controlCapabilities,
    updatedAt: Date.now(),
  });

  if (snapshot.playbackState === "idle" && sender.tab?.audible === true) {
    snapshot.playbackState = "playing";
    snapshot.isPlaying = true;
  }

  const key = sourceRegistry.upsert({
    tabId,
    frameId,
    tabTitle: sender.tab?.title || "",
    url: sender.tab?.url || "",
    snapshot,
  });

  const instance = sourceRegistry.get(key);
  if (instance) {
    void maybeApplyWrapperVolume(instance);
  }

  debugLog("source upsert", {
    providerId: provider.id,
    tabId,
    frameId,
    playbackState: snapshot.playbackState,
    title: snapshot.title || "",
  });

  await publishState();
}

async function handleSourceRemove(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  if (isStaleContextMessage(tabId, message)) {
    debugLog("source remove skipped: stale context", {
      tabId,
      frameId,
      contextStartedAt: Number(message?.contextStartedAt) || 0,
      minContextStartedAt: tabMinContextStartedAt.get(tabId) || 0,
    });
    return;
  }

  const provider = getProviderById(message.providerId || message.sourceId);
  if (!provider) return;

  const removeReason = String(message?.reason || "").trim().toLowerCase();
  if (shouldRetainWebMediaOnRemove(provider.id, removeReason)) {
    const retained = keepWebMediaAsPausedOnMissingRemove(tabId, frameId, provider.id, sender);
    if (retained) {
      debugLog("source retained as paused", {
        providerId: provider.id,
        tabId,
        frameId,
        reason: removeReason,
      });
      await publishState();
      return;
    }
  }

  const removed = sourceRegistry.remove(tabId, provider.id, frameId);
  if (!removed) return;
  clearWrapperAppliedForSession(`${tabId}:${frameId}:${provider.id}`);

  debugLog("source remove", {
    providerId: provider.id,
    tabId,
    frameId,
  });

  ensureAudibleFallbackForTab({
    id: tabId,
    title: sender.tab?.title || "",
    url: sender.tab?.url || "",
    audible: sender.tab?.audible === true,
  });

  await publishState();
}

async function handleSourceDiagnostic(message, sender) {
  if (!runtime.settings?.debugMode) return;

  const providerIdRaw = String(message.providerId || message.sourceId || "").trim();
  const provider = getProviderById(providerIdRaw);
  const sourceId = provider?.id || providerIdRaw || "unknown";
  const sourceLabel = provider?.label || sourceId;
  const tabId = sender.tab?.id ?? null;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const event = String(message.event || "event").trim() || "event";

  const entry = {
    at: Number(message.at) || Date.now(),
    sourceId,
    sourceLabel,
    tabId,
    frameId,
    event,
    href: String(message.href || sender.tab?.url || "").trim(),
    payload: sanitizeDiagnosticPayload(message.payload),
  };

  pushDiagnostic(entry);
  debugLog("source diagnostic", {
    sourceId: entry.sourceId,
    tabId: entry.tabId,
    frameId: entry.frameId,
    event: entry.event,
  });

  await publishState({ skipTwitchSync: true, skipObsSync: true });
}

async function handleSetPrimarySession(sessionId) {
  const settings = getEffectiveSettings();
  const activeSessions = buildActiveSessions(sourceRegistry.values(), settings);
  runtime.primaryState = reducePrimarySession(runtime.primaryState, {
    type: "SELECT",
    sessionId,
    sessions: activeSessions,
    sourceAutoPickMap: settings.primarySourceAutoPickMap,
  });

  debugLog("primary selected", {
    primarySessionId: runtime.primaryState.primarySessionId || "",
  });

  await publishState();
}

chrome.runtime.onInstalled.addListener(() => {
  runtime.settingsLoaded = false;
  void reloadSettings();
});

chrome.runtime.onStartup.addListener(() => {
  runtime.settingsLoaded = false;
  void reloadSettings();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMinContextStartedAt.delete(tabId);
  removeAudibleFallbackForTab(tabId);
  sourceRegistry.removeTab(tabId);
  clearWrapperAppliedByPrefix(`${tabId}:`);
  overlayFlow.clearSelectorPickerSessionsByTab(tabId);
  if (overlayFlow.clearPopupDraftsByTab(tabId)) {
    void overlayFlow.persistPopupDrafts();
  }
  void publishState();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!Number.isInteger(tabId)) return;
  let changed = false;

  if (changeInfo?.status === "loading") {
    markTabNavigation(tabId);
    changed = removeAudibleFallbackForTab(tabId) || changed;
    sourceRegistry.removeTab(tabId);
    clearWrapperAppliedByPrefix(`${tabId}:`);
    overlayFlow.clearSelectorPickerSessionsByTab(tabId);
    if (changeInfo?.url && overlayFlow.clearPopupDraftsByTab(tabId)) {
      void overlayFlow.persistPopupDrafts();
    }
    changed = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(changeInfo || {}, "audible") ||
    Object.prototype.hasOwnProperty.call(changeInfo || {}, "title") ||
    Object.prototype.hasOwnProperty.call(changeInfo || {}, "url")
  ) {
    changed = ensureAudibleFallbackForTab({
      id: tabId,
      title: tab?.title || changeInfo?.title || "",
      url: tab?.url || changeInfo?.url || "",
      audible: tab?.audible === true,
    }) || changed;
  }

  if (changed) {
    void publishState();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (!changes.settings) return;
  runtime.settingsLoaded = false;
  void reloadSettings();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

registerRuntimeMessageHandlers({
  MSG,
  runtime,
  ensureSettingsLoaded: () => ensureSettingsLoaded(),
  handleSourceUpdate,
  handleSourceRemove,
  handleSourceDiagnostic,
  handleSelectorPickerStart: (message) => overlayFlow.handleSelectorPickerStart(message),
  handleSelectorPickerCancel: (message) => overlayFlow.handleSelectorPickerCancel(message),
  handleSelectorPickerResult: (message) => overlayFlow.handleSelectorPickerResult(message),
  handlePopupWrapperDraftGet: (message, sender) => overlayFlow.handlePopupWrapperDraftGet(message, sender),
  handlePopupWrapperDraftUpsert: (message, sender) => overlayFlow.handlePopupWrapperDraftUpsert(message, sender),
  handlePopupWrapperDraftClear: (message, sender) => overlayFlow.handlePopupWrapperDraftClear(message, sender),
  buildStatePayload: () => buildStatePayload(),
  applySourceOrder: (order) => applySourceOrder(order),
  applySourceEnabled: (sourceId, enabled) => applySourceEnabled(sourceId, enabled),
  applyTrackingEnabled: (enabled) => applyTrackingEnabled(enabled),
  handleControlActive: (action, value) => handleControlActive(action, value),
  handleControlSession: (sessionId, action, value) => handleControlSession(sessionId, action, value),
  handleSetPrimarySession,
  applySettingsAndSync: (patch) => applySettingsAndSync(patch),
  obsClient,
  twitchService,
});

void ensureSettingsLoaded().then(async () => {
  const changed = await refreshAudibleFallbacks("bootstrap");
  if (changed) await publishState();
});
