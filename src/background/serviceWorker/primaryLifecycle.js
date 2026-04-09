export function createPrimaryLifecycle({
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
  ensurePopupDraftsLoaded,
  isServiceEnabled,
  getRuntimeObsSettings,
  getRuntimeTwitchSettings,
  syncActionBadge = async () => {},
  onSettingsApplied = async () => {},
}) {
  let settingsLoadPromise = null;

  function providerOrderWithFallback(settings) {
    const order = [];
    if (Array.isArray(settings.sourceOrder)) {
      for (const id of settings.sourceOrder) {
        if (!order.includes(id)) order.push(id);
      }
    }

    const knownIds = new Set(order);
    for (const provider of PROVIDERS) {
      if (!knownIds.has(provider.id)) order.push(provider.id);
    }

    return order;
  }

  function getEffectiveSettings() {
    return {
      ...runtime.settings,
      sourceOrder: providerOrderWithFallback(runtime.settings),
    };
  }

  function buildActiveView(settings = getEffectiveSettings()) {
    const activeSessions = buildActiveSessions(sourceRegistry.values(), settings);
    runtime.primaryState = reducePrimarySession(runtime.primaryState, {
      type: "SYNC",
      sessions: activeSessions,
      sourceAutoPickMap: settings.primarySourceAutoPickMap,
    });

    const primarySessionId = runtime.primaryState.primarySessionId || "";
    const primary = primarySessionId
      ? activeSessions.find((session) => session.sessionId === primarySessionId) || null
      : null;

    debugLog("active view", {
      sessions: activeSessions.length,
      primarySessionId,
    });

    return {
      activeSessions,
      primarySessionId,
      activeSnapshot: primary ? { ...primary } : null,
    };
  }

  function buildStatePayload() {
    const settings = getEffectiveSettings();
    const instances = sourceRegistry.values();
    const serviceEnabled = isServiceEnabled(settings);

    let providerRows = [];
    try {
      providerRows = buildProviderRows(instances, PROVIDERS, settings);
    } catch (error) {
      console.error("[Now Playing][bg] buildStatePayload providerRows failed", error, {
        instanceCount: instances.length,
      });
    }

    let activeView = {
      activeSessions: [],
      primarySessionId: "",
      activeSnapshot: null,
    };
    try {
      activeView = buildActiveView(settings);
    } catch (error) {
      console.error("[Now Playing][bg] buildStatePayload activeView failed", error, {
        instanceCount: instances.length,
      });
    }

    runtime.providerRows = providerRows;

    return {
      serviceEnabled,
      trackingEnabled: serviceEnabled,
      engineEnabled: serviceEnabled,
      uiLocale: settings.uiLocale || "system",
      liveVideoCoversInPopup: settings.liveVideoCoversInPopup === true,
      allowGenericWebInjection: settings.allowGenericWebInjection !== false,
      twitchEnabled: settings.twitch?.enabled !== false,
      twitchControlEnabled: settings.twitch?.controlEnabled === true,
      twitchAnnounceEnabled: settings.twitch?.announceEnabled === true,
      themeAppearance: settings.themeAppearance || "system",
      themeAccentColor: settings.themeAccentColor || "teal",
      showNowPlayingBlockInPopup: settings.showNowPlayingBlockInPopup !== false,
      obsEnabled: settings.obs?.enabled === true,
      sourceOrder: settings.sourceOrder,
      sourceEnabledMap: settings.sourceEnabledMap,
      sourceBulkMuteIgnoreMap: settings.sourceBulkMuteIgnoreMap,
      wrapperRules: normalizeWrapperRules(settings.wrapperRules || []),
      customCss: settings.customCss || "",
      providers: providerRows,
      activeSessions: activeView.activeSessions,
      activeSnapshot: activeView.activeSnapshot,
      primarySessionId: activeView.primarySessionId,
      sessionMode: activeView.activeSnapshot?.playbackState || "EMPTY",
      obsStatus: runtime.obsStatus,
      twitchStatus: runtime.twitchStatus,
      twitchLog: runtime.twitchLog,
      diagnostics: runtime.diagnostics,
    };
  }

  async function syncActiveToObs(payload) {
    if (!isServiceEnabled(runtime.settings)) return;
    if (!runtime.settings.obs?.enabled) return;
    if (!payload.activeSnapshot) {
      obsClient.pushBrowserEvent(null, {
        customCss: runtime.settings.customCss || "",
      });
      return;
    }

    const line = renderTrackTemplate(
      runtime.settings.obs.textTemplate,
      payload.activeSnapshot
    );

    obsClient.pushTrack(payload.activeSnapshot, line, {
      customCss: runtime.settings.customCss || "",
    });
  }

  async function syncActiveToTwitch(payload) {
    if (!isServiceEnabled(runtime.settings)) return;
    if (runtime.settings.twitch?.enabled === false) return;
    twitchService.onSnapshot(payload.activeSnapshot);
  }

  async function publishState(options = {}) {
    const skipTwitchSync = Boolean(options.skipTwitchSync);
    const skipObsSync = Boolean(options.skipObsSync);
    let payload;
    try {
      payload = buildStatePayload();
    } catch (error) {
      console.error("[Now Playing][bg] buildStatePayload failed", error);
      return;
    }

    try {
      await setLocalState(LOCAL_STATE_KEYS.POPUP_STATE, payload);
      await setLocalState(LOCAL_STATE_KEYS.ACTIVE_SNAPSHOT, payload.activeSnapshot);
      await setLocalState(LOCAL_STATE_KEYS.DIAGNOSTICS, payload.diagnostics);
      await setLocalState(LOCAL_STATE_KEYS.PRIMARY_STATE, runtime.primaryState);
    } catch (error) {
      console.warn("[Now Playing][bg] local state write failed", error);
    }

    if (!skipObsSync) {
      try {
        await syncActiveToObs(payload);
      } catch (error) {
        console.error("[Now Playing][bg] syncActiveToObs failed", error);
      }
    }

    if (!skipTwitchSync) {
      try {
        await syncActiveToTwitch(payload);
      } catch (error) {
        console.error("[Now Playing][bg] syncActiveToTwitch failed", error);
      }
    }

    try {
      await syncActionBadge(payload);
    } catch (error) {
      console.warn("[Now Playing][bg] syncActionBadge failed", error);
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: MSG.STATE_BROADCAST,
          payload,
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      console.warn("[Now Playing][bg] state broadcast failed", error);
    }
  }

  async function applySettingsAndSync(patch) {
    const previousSettings = runtime.settings;
    const nextSettings = await patchSettings(patch);
    nextSettings.sourceOrder = providerOrderWithFallback(nextSettings);
    if (previousSettings?.debugMode && !nextSettings?.debugMode) {
      runtime.diagnostics = [];
    }

    if (shouldPushObsHideBeforeSettingsUpdate(previousSettings, nextSettings)) {
      try {
        obsClient.pushBrowserEvent(null, {
          customCss: previousSettings.customCss || "",
        });
      } catch (error) {
        console.warn("[Now Playing][bg] hide event before settings update failed", error);
      }
    }

    runtime.settings = nextSettings;
    obsClient.updateSettings(getRuntimeObsSettings(runtime.settings));
    twitchService.updateSettings(getRuntimeTwitchSettings(runtime.settings));
    await publishState();
    try {
      await onSettingsApplied(runtime.settings, { reason: "patch" });
    } catch (error) {
      console.warn("[Now Playing][bg] settings apply hook failed", error);
    }
    return runtime.settings;
  }

  async function reloadSettings() {
    await ensurePrimaryStateLoaded();
    await ensureWrapperVolumeMemoryLoaded();
    await ensurePopupDraftsLoaded();
    runtime.settings = await getSettings();
    runtime.settings.sourceOrder = providerOrderWithFallback(runtime.settings);
    obsClient.updateSettings(getRuntimeObsSettings(runtime.settings));
    twitchService.updateSettings(getRuntimeTwitchSettings(runtime.settings));
    runtime.settingsLoaded = true;
    await publishState();
    try {
      await onSettingsApplied(runtime.settings, { reason: "reload" });
    } catch (error) {
      console.warn("[Now Playing][bg] settings reload hook failed", error);
    }
  }

  function ensureSettingsLoaded() {
    if (runtime.settingsLoaded) return Promise.resolve();
    if (!settingsLoadPromise) {
      settingsLoadPromise = reloadSettings().finally(() => {
        settingsLoadPromise = null;
      });
    }
    return settingsLoadPromise;
  }

  async function applySourceOrder(order) {
    const normalized = providerOrderWithFallback({
      ...runtime.settings,
      sourceOrder: Array.isArray(order) ? order : defaultSourceOrder(),
    });
    await applySettingsAndSync({ sourceOrder: normalized });
  }

  async function applySourceEnabled(sourceId, enabled) {
    const normalizedId = String(sourceId || "").trim();
    if (!normalizedId) return;

    const nextMap = {
      ...(runtime.settings.sourceEnabledMap || {}),
      [normalizedId]: Boolean(enabled),
    };

    await applySettingsAndSync({ sourceEnabledMap: nextMap });
  }

  async function applyTrackingEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (!nextEnabled) {
      sourceRegistry.clear();
      runtime.primaryState = createPrimarySessionState();
      runtime.wrapperVolumeAppliedBySession = {};
      runtime.audibleFallbackByTab = {};
    }
    await applySettingsAndSync({ trackingEnabled: nextEnabled });
  }

  return {
    providerOrderWithFallback,
    getEffectiveSettings,
    buildActiveView,
    buildStatePayload,
    publishState,
    applySettingsAndSync,
    reloadSettings,
    ensureSettingsLoaded,
    applySourceOrder,
    applySourceEnabled,
    applyTrackingEnabled,
  };
}
