export function createWrapperOverlayFlow({
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
  applySettingsAndSync,
  publishState,
}) {
  const CONTENT_SCRIPT_FILE_FALLBACK = "src/content/contentScript.js";
  let popupDraftLoadPromise = null;
  const pickerSessionByTab = new Map();
  const pickerSessionByRequestId = new Map();

  function isMissingReceiverErrorMessage(message) {
    return /could not establish connection|receiving end does not exist/i.test(
      String(message || "")
    );
  }

  async function injectContentScriptOnTab(tabId) {
    if (!Number.isInteger(tabId)) {
      return { ok: false, message: "invalid tab id" };
    }

    if (!chrome?.scripting?.executeScript) {
      return { ok: false, message: "Scripting API unavailable" };
    }

    const manifestScriptFile = String(
      chrome?.runtime?.getManifest?.()?.content_scripts?.find((entry) => Array.isArray(entry?.js) && entry.js.length)
        ?.js?.[0] || ""
    ).trim();
    const scriptFile = manifestScriptFile || CONTENT_SCRIPT_FILE_FALLBACK;

    try {
      await chrome.scripting.executeScript({
        target: {
          tabId,
          allFrames: true,
        },
        files: [scriptFile],
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error || "Content script injection failed") };
    }
  }

  async function sendTabMessageWithContentScriptRetry(tabId, payload, options = { frameId: 0 }) {
    try {
      return await chrome.tabs.sendMessage(tabId, payload, options);
    } catch (error) {
      const message = String(error || "");
      if (!isMissingReceiverErrorMessage(message)) {
        return { ok: false, message };
      }

      const injection = await injectContentScriptOnTab(tabId);
      if (!injection?.ok) {
        return { ok: false, message: injection?.message || message };
      }

      try {
        return await chrome.tabs.sendMessage(tabId, payload, options);
      } catch (retryError) {
        return { ok: false, message: String(retryError || "picker start failed") };
      }
    }
  }

  function normalizePopupDraftsState(value) {
    const raw = value && typeof value === "object" ? value : {};
    const next = {};
    for (const [key, entry] of Object.entries(raw)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) continue;
      if (!entry || typeof entry !== "object") continue;
      const draft = entry?.draft && typeof entry.draft === "object" ? entry.draft : null;
      if (!draft) continue;
      next[normalizedKey] = {
        mode: String(entry.mode || "edit"),
        draft,
        autoPrimary:
          typeof entry.autoPrimary === "boolean"
            ? entry.autoPrimary
            : draft.autoPrimary !== false,
        updatedAt: Number(entry.updatedAt) || Date.now(),
      };
    }
    return next;
  }

  async function ensurePopupDraftsLoaded() {
    if (popupDraftLoadPromise) return popupDraftLoadPromise;
    popupDraftLoadPromise = getLocalState(LOCAL_STATE_KEYS.POPUP_WRAPPER_DRAFTS, {}).then((value) => {
      runtime.popupWrapperDrafts = normalizePopupDraftsState(value);
    });
    try {
      await popupDraftLoadPromise;
    } finally {
      popupDraftLoadPromise = null;
    }
  }

  async function persistPopupDrafts() {
    try {
      await setLocalState(LOCAL_STATE_KEYS.POPUP_WRAPPER_DRAFTS, runtime.popupWrapperDrafts);
    } catch (error) {
      console.warn("[Now Playing][bg] popup draft persist failed", error);
    }
  }

  function clearPopupDraftsByTab(tabId) {
    if (!Number.isInteger(tabId)) return false;
    const prefix = `${tabId}|`;
    let changed = false;
    const next = { ...runtime.popupWrapperDrafts };
    for (const key of Object.keys(next)) {
      if (!key.startsWith(prefix)) continue;
      delete next[key];
      changed = true;
    }
    if (changed) runtime.popupWrapperDrafts = next;
    return changed;
  }

  function clearSelectorPickerSessionsByTab(tabId) {
    if (!Number.isInteger(tabId)) return;
    const session = pickerSessionByTab.get(tabId);
    if (!session) return;
    pickerSessionByTab.delete(tabId);
    if (session.requestId) {
      pickerSessionByRequestId.delete(session.requestId);
    }
  }

  function normalizePickerAction(action) {
    const normalized = String(action || "").trim();
    return WRAPPER_CONTROL_ACTIONS.includes(normalized) ? normalized : "";
  }

  function setPickerSession(session) {
    if (!session || !Number.isInteger(session.tabId)) return;
    const previous = pickerSessionByTab.get(session.tabId);
    if (previous?.requestId) pickerSessionByRequestId.delete(previous.requestId);
    pickerSessionByTab.set(session.tabId, session);
    if (session.requestId) pickerSessionByRequestId.set(session.requestId, session);
  }

  function removePickerSession(session) {
    if (!session || !Number.isInteger(session.tabId)) return;
    pickerSessionByTab.delete(session.tabId);
    if (session.requestId) pickerSessionByRequestId.delete(session.requestId);
  }

  function findPickerSession(message = {}) {
    const requestId = String(message.requestId || "").trim();
    if (requestId) return pickerSessionByRequestId.get(requestId) || null;
    const tabId = Number(message.tabId);
    if (Number.isInteger(tabId)) return pickerSessionByTab.get(tabId) || null;
    return null;
  }

  async function resolveActiveTabForPicker() {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    const tabId = tab?.id;
    const urlKey = normalizePopupTabUrl(tab?.url || "");
    if (!Number.isInteger(tabId) || !urlKey) return null;
    return {
      tabId,
      urlKey,
    };
  }

  async function cancelPickerSession(session) {
    if (!session || !Number.isInteger(session.tabId)) return { ok: true };
    removePickerSession(session);
    try {
      const response = await chrome.tabs.sendMessage(
        session.tabId,
        {
          type: MSG.SELECTOR_PICKER_CANCEL,
          requestId: session.requestId,
        },
        { frameId: 0 }
      );
      return response?.ok ? { ok: true } : { ok: false, message: String(response?.message || "picker cancel failed") };
    } catch (error) {
      return { ok: false, message: String(error || "picker cancel failed") };
    }
  }

  async function handleSelectorPickerStart(message = {}) {
    const requestId = String(message.requestId || "").trim();
    const ruleId = String(message.ruleId || "").trim();
    const action = normalizePickerAction(message.action);

    if (!requestId) return { ok: false, message: "picker request id missing" };
    if (!ruleId) return { ok: false, message: "wrapper rule id missing" };
    if (!action) return { ok: false, message: "unsupported picker action" };

    const rules = normalizeWrapperRules(runtime.settings.wrapperRules || []);
    const rule = rules.find((entry) => entry.id === ruleId);
    if (!rule) return { ok: false, message: "wrapper rule not found" };

    const activeTab = await resolveActiveTabForPicker();
    if (!activeTab) return { ok: false, message: "active tab not found" };
    const tabId = activeTab.tabId;

    const currentSession = pickerSessionByTab.get(tabId) || null;
    const transition = resolvePickerStartTransition(currentSession, {
      action,
      ruleId,
    });

    if (transition.cancelCurrent && currentSession) {
      await cancelPickerSession(currentSession);
    }
    if (transition.mode === "toggle-off") {
      await publishState({ skipObsSync: true, skipTwitchSync: true });
      return {
        ok: true,
        canceled: true,
      };
    }

    const response = await sendTabMessageWithContentScriptRetry(
      tabId,
      {
        type: MSG.SELECTOR_PICKER_START,
        requestId,
      },
      { frameId: 0 }
    );

    if (!response?.ok) {
      return {
        ok: false,
        message: String(response?.message || "picker start failed"),
      };
    }

    setPickerSession({
      requestId,
      ruleId,
      action,
      tabId,
      urlKey: activeTab.urlKey,
      startedAt: Date.now(),
    });

    await publishState({ skipObsSync: true, skipTwitchSync: true });

    return {
      ok: true,
      requestId,
      tabId,
    };
  }

  async function handleSelectorPickerCancel(message = {}) {
    let session = findPickerSession(message);
    if (!session) {
      const activeTab = await resolveActiveTabForPicker();
      if (activeTab?.tabId != null) {
        session = pickerSessionByTab.get(activeTab.tabId) || null;
      }
    }
    if (!session) return { ok: true };

    const result = await cancelPickerSession(session);
    await publishState({ skipObsSync: true, skipTwitchSync: true });
    return result;
  }

  async function handleSelectorPickerResult(message = {}) {
    const requestId = String(message.requestId || "").trim();
    if (!requestId) return { ok: false, message: "picker request id missing" };

    const session = pickerSessionByRequestId.get(requestId) || null;
    if (!session) return { ok: true, ignored: true };
    removePickerSession(session);

    const selector = String(message.selector || "").trim();
    if (message?.ok !== true || !selector) {
      await publishState({ skipObsSync: true, skipTwitchSync: true });
      return { ok: true };
    }

    const rules = normalizeWrapperRules(runtime.settings.wrapperRules || []);
    const ruleIdx = rules.findIndex((rule) => rule.id === session.ruleId);
    if (ruleIdx < 0) return { ok: false, message: "wrapper rule not found" };

    const currentRule = rules[ruleIdx];
    const nextRule = {
      ...currentRule,
      controlSelectors: normalizeWrapperControlSelectors({
        ...(currentRule.controlSelectors || {}),
        [session.action]: selector,
      }),
    };
    const nextRules = [...rules];
    nextRules[ruleIdx] = nextRule;

    await applySettingsAndSync({
      wrapperRules: nextRules,
    });

    try {
      await chrome.action.openPopup();
    } catch (_) {
      // best effort
    }

    await publishState({ skipObsSync: true, skipTwitchSync: true });

    return { ok: true, updated: true };
  }

  function sanitizeDraftRuleId(ruleId) {
    const normalized = String(ruleId || "").trim();
    return normalized || POPUP_WRAPPER_DRAFT_CREATE_RULE_ID;
  }

  function resolvePopupDraftKeyFromMessage(message = {}, sender = {}) {
    const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : sender?.tab?.id;
    const ruleId = sanitizeDraftRuleId(message.ruleId);
    const urlKey = normalizePopupTabUrl(message.urlKey || message.url || sender?.tab?.url || "");
    return makePopupWrapperDraftKey(tabId, urlKey, ruleId);
  }

  async function handlePopupWrapperDraftGet(message = {}, sender = {}) {
    await ensurePopupDraftsLoaded();
    const key = resolvePopupDraftKeyFromMessage(message, sender);
    if (!key) return { ok: false, message: "invalid draft key" };
    return {
      ok: true,
      key,
      entry: runtime.popupWrapperDrafts[key] || null,
    };
  }

  async function handlePopupWrapperDraftUpsert(message = {}, sender = {}) {
    await ensurePopupDraftsLoaded();
    const key = resolvePopupDraftKeyFromMessage(message, sender);
    if (!key) return { ok: false, message: "invalid draft key" };
    const draft = message?.draft && typeof message.draft === "object" ? message.draft : null;
    if (!draft) return { ok: false, message: "invalid draft payload" };

    runtime.popupWrapperDrafts = {
      ...runtime.popupWrapperDrafts,
      [key]: {
        mode: String(message.mode || "edit"),
        draft,
        autoPrimary:
          typeof message?.autoPrimary === "boolean"
            ? message.autoPrimary
            : draft.autoPrimary !== false,
        updatedAt: Date.now(),
      },
    };

    await persistPopupDrafts();
    return { ok: true, key };
  }

  async function handlePopupWrapperDraftClear(message = {}, sender = {}) {
    await ensurePopupDraftsLoaded();
    const key = resolvePopupDraftKeyFromMessage(message, sender);
    if (!key) return { ok: false, message: "invalid draft key" };
    if (!runtime.popupWrapperDrafts[key]) return { ok: true, key, cleared: false };

    const next = { ...runtime.popupWrapperDrafts };
    delete next[key];
    runtime.popupWrapperDrafts = next;
    await persistPopupDrafts();
    return { ok: true, key, cleared: true };
  }

  return {
    ensurePopupDraftsLoaded,
    persistPopupDrafts,
    clearPopupDraftsByTab,
    clearSelectorPickerSessionsByTab,
    handleSelectorPickerStart,
    handleSelectorPickerCancel,
    handleSelectorPickerResult,
    handlePopupWrapperDraftGet,
    handlePopupWrapperDraftUpsert,
    handlePopupWrapperDraftClear,
  };
}
