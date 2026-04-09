export function registerRuntimeMessageHandlers({
  MSG,
  runtime,
  ensureSettingsLoaded,
  handleSourceUpdate,
  handleSourceRemove,
  handleSourceDiagnostic,
  handleSelectorPickerStart,
  handleSelectorPickerCancel,
  handleSelectorPickerResult,
  handlePopupWrapperDraftGet,
  handlePopupWrapperDraftUpsert,
  handlePopupWrapperDraftClear,
  buildStatePayload,
  applySourceOrder,
  applySourceEnabled,
  applyTrackingEnabled,
  handleControlActive,
  handleControlSession,
  handleSetPrimarySession,
  applySettingsAndSync,
  obsClient,
  twitchService,
}) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MSG.SOURCE_UPDATE) {
      void ensureSettingsLoaded()
        .then(() => handleSourceUpdate(message, sender))
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SOURCE_REMOVE) {
      void ensureSettingsLoaded()
        .then(() => handleSourceRemove(message, sender))
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SOURCE_DIAGNOSTIC) {
      void ensureSettingsLoaded()
        .then(() => handleSourceDiagnostic(message, sender))
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SELECTOR_PICKER_START) {
      void ensureSettingsLoaded()
        .then(() => handleSelectorPickerStart(message))
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SELECTOR_PICKER_CANCEL) {
      void handleSelectorPickerCancel(message)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SELECTOR_PICKER_RESULT) {
      void ensureSettingsLoaded()
        .then(() => handleSelectorPickerResult(message))
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_WRAPPER_DRAFT_GET) {
      void handlePopupWrapperDraftGet(message, sender)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_WRAPPER_DRAFT_UPSERT) {
      void handlePopupWrapperDraftUpsert(message, sender)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_WRAPPER_DRAFT_CLEAR) {
      void handlePopupWrapperDraftClear(message, sender)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_GET_STATE) {
      try {
        sendResponse({
          ok: true,
          payload: buildStatePayload(),
          settingsLoaded: runtime.settingsLoaded,
        });
      } catch (error) {
        console.error("[Now Playing][bg] POPUP_GET_STATE failed", error);
        sendResponse({ ok: false, message: String(error) });
      }

      if (!runtime.settingsLoaded) {
        void ensureSettingsLoaded().catch(() => undefined);
      }
      return;
    }

    if (message?.type === MSG.POPUP_SET_ORDER) {
      void applySourceOrder(message.order)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_SET_ENABLED) {
      void applySourceEnabled(message.sourceId, message.enabled)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_SET_ENGINE_ENABLED) {
      void applyTrackingEnabled(message.enabled)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_SET_BROADCAST_ENABLED) {
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === MSG.POPUP_SET_TRACKING_ENABLED) {
      void applyTrackingEnabled(message.enabled)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_CONTROL_ACTIVE) {
      void handleControlActive(message.action, message.value)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_CONTROL_SESSION) {
      void handleControlSession(message.sessionId, message.action, message.value)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.POPUP_SET_PRIMARY_SESSION) {
      void handleSetPrimarySession(message.sessionId)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SETTINGS_GET) {
      void ensureSettingsLoaded()
        .then(() =>
          sendResponse({
            ok: true,
            settings: runtime.settings,
            obsStatus: runtime.obsStatus,
            twitchStatus: runtime.twitchStatus,
            twitchLog: runtime.twitchLog,
          })
        )
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.SETTINGS_SET) {
      void applySettingsAndSync(message.patch || {})
        .then(() => sendResponse({ ok: true, settings: runtime.settings }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.OBS_RECONNECT) {
      obsClient.reconnect();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === MSG.OBS_GET_STATUS) {
      void ensureSettingsLoaded()
        .then(() => sendResponse({ ok: true, obsStatus: runtime.obsStatus }))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.TWITCH_RECONNECT) {
      twitchService.reconnect();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === MSG.TWITCH_GET_STATUS) {
      void ensureSettingsLoaded()
        .then(() =>
          sendResponse({
            ok: true,
            twitchStatus: runtime.twitchStatus,
            twitchLog: runtime.twitchLog,
          })
        )
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }

    if (message?.type === MSG.TWITCH_AUTH_START) {
      void twitchService
        .startAuthFlow()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, message: String(error) }));
      return true;
    }
  });
}
