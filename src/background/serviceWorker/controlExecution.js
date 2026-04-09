const CONTROL_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "seek",
  "volume",
  "mute",
  "unmute",
  "muteToggle",
  "next",
  "previous",
];
const DEFAULT_CONTENT_SCRIPT_FILE = "src/content/contentScript.js";

export function createControlExecution({
  runtime,
  sourceRegistry,
  findWrapperMatchForInstance,
  getWrapperControlSelector,
  getWrapperControlMode,
  getEffectiveSettings,
  MSG,
  buildActiveView,
  getSessionFrameOptions,
  rememberWrapperVolumeFromControl,
  pushDiagnostic,
  sanitizeDiagnosticPayload,
  debugLog,
  publishState,
}) {
  function normalizeFrameId(frameId) {
    return Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
  }

  function uniqueCandidateFrames(target) {
    const primary = normalizeFrameId(target?.frameId);
    const frames = [primary, 0];
    return [...new Set(frames)];
  }

  function resolveManifestContentScriptFile() {
    try {
      const file = String(
        chrome?.runtime?.getManifest?.()?.content_scripts?.find(
          (entry) => Array.isArray(entry?.js) && entry.js.length
        )?.js?.[0] || ""
      ).trim();
      return file || DEFAULT_CONTENT_SCRIPT_FILE;
    } catch (_) {
      return DEFAULT_CONTENT_SCRIPT_FILE;
    }
  }

  function isMissingReceiverError(error) {
    const message = String(error || "")
      .trim()
      .toLowerCase();
    if (!message) return false;
    if (message.includes("receiving end does not exist")) return true;
    if (message.includes("could not establish connection")) return true;
    return false;
  }

  async function injectContentScriptOnDemand(tabId, frameId) {
    const scripting = chrome?.scripting;
    if (!scripting?.executeScript || tabId == null) {
      return { ok: false, message: "scripting unavailable" };
    }

    try {
      await scripting.executeScript({
        target: {
          tabId,
          frameIds: [normalizeFrameId(frameId)],
        },
        files: [resolveManifestContentScriptFile()],
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error || "content script inject failed") };
    }
  }

  async function sendWrapperSelectorControlToFrame(target, wrapperControl, frameId, value) {
    try {
      const result = await chrome.tabs.sendMessage(
        target.tabId,
        {
          type: MSG.CONTROL_SELECTOR_EXEC,
          action: wrapperControl.action,
          selector: wrapperControl.selector,
          value,
          mode: String(wrapperControl.mode || ""),
        },
        { frameId: normalizeFrameId(frameId) }
      );
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error || "") };
    }
  }

  function normalizeWrapperSelectorResult(wrapperControl, result, fallbackMessage) {
    if (result?.ok) {
      return {
        ...result,
        path: String(result.path || `wrapper-selector:${wrapperControl.action}`),
      };
    }
    return {
      ...result,
      ok: false,
      path: String(result?.path || `wrapper-selector:${wrapperControl.action}`),
      message: String(result?.message || fallbackMessage || "wrapper selector control failed"),
    };
  }

  function shouldPreferWrapperOnly(wrapperControl, action) {
    if (!wrapperControl?.selector) return false;
    return String(action || "").trim() === "volume";
  }

  function normalizeControlAction(action) {
    const value = String(action || "").trim();
    return CONTROL_ACTIONS.includes(value) ? value : "";
  }

  function hasControlCapability(snapshot, action) {
    const normalizedAction = normalizeControlAction(action);
    if (!normalizedAction) return false;
    return snapshot?.controlCapabilities?.[normalizedAction] === true;
  }

  function resolveWrapperSelectorControl(target, action, settings = getEffectiveSettings()) {
    const normalizedAction = normalizeControlAction(action);
    if (!normalizedAction || !target) return null;
    const match = findWrapperMatchForInstance(target, settings);
    const selector = getWrapperControlSelector(match?.rule, normalizedAction);
    if (!selector) return null;
    const mode =
      typeof getWrapperControlMode === "function"
        ? String(getWrapperControlMode(match?.rule, normalizedAction) || "")
        : "";
    return {
      action: normalizedAction,
      selector,
      mode,
      match,
    };
  }

  async function executeWrapperSelectorControl(target, wrapperControl, value) {
    if (!target || !wrapperControl?.selector) {
      return { ok: false, message: "wrapper selector control missing" };
    }

    let lastFailure = {
      ok: false,
      path: `wrapper-selector:${wrapperControl.action}`,
      message: "wrapper selector control failed",
    };
    const candidateFrames = uniqueCandidateFrames(target);
    for (const frameId of candidateFrames) {
      const attempt = await sendWrapperSelectorControlToFrame(target, wrapperControl, frameId, value);
      if (attempt.ok) {
        const normalized = normalizeWrapperSelectorResult(wrapperControl, attempt.result, "wrapper selector control failed");
        if (normalized.ok) return normalized;
        lastFailure = normalized;
        continue;
      }

      if (!isMissingReceiverError(attempt.error)) {
        lastFailure = normalizeWrapperSelectorResult(wrapperControl, null, attempt.error);
        continue;
      }

      const injected = await injectContentScriptOnDemand(target.tabId, frameId);
      if (!injected.ok) {
        lastFailure = normalizeWrapperSelectorResult(
          wrapperControl,
          null,
          injected.message || attempt.error || "wrapper selector control failed"
        );
        continue;
      }

      const retry = await sendWrapperSelectorControlToFrame(target, wrapperControl, frameId, value);
      if (retry.ok) {
        const normalized = normalizeWrapperSelectorResult(wrapperControl, retry.result, "wrapper selector control failed");
        if (normalized.ok) return normalized;
        lastFailure = normalized;
      } else {
        lastFailure = normalizeWrapperSelectorResult(wrapperControl, null, retry.error || attempt.error);
      }
    }

    return lastFailure;
  }

  function unsupportedControlResult(action, reason = "capability-missing") {
    return {
      ok: false,
      reason: "unsupported",
      unsupportedReason: reason,
      path: "unsupported",
      message: `unsupported action ${action}`,
    };
  }

  function pushControlDiagnostic(scope, target, action, value, result) {
    if (!runtime.settings?.debugMode) return;

    const entry = {
      at: Date.now(),
      sourceId: String(target?.snapshot?.sourceId || "unknown"),
      sourceLabel: String(target?.snapshot?.sourceLabel || target?.snapshot?.sourceId || "unknown"),
      tabId: target?.tabId ?? null,
      frameId: Number.isInteger(target?.frameId) ? target.frameId : 0,
      event: "control.dispatch",
      href: String(target?.url || "").trim(),
      payload: sanitizeDiagnosticPayload({
        scope,
        action,
        value,
        ok: Boolean(result?.ok),
        reason: String(result?.reason || ""),
        unsupported_reason: String(result?.unsupportedReason || ""),
        control_path: String(result?.path || ""),
        message: String(result?.message || ""),
      }),
    };

    pushDiagnostic(entry);
  }

  function flushDiagnosticsIfDebug() {
    if (!runtime.settings?.debugMode) return;
    void publishState({ skipObsSync: true, skipTwitchSync: true });
  }

  async function handleControlActive(action, value) {
    const activeView = buildActiveView(getEffectiveSettings());
    const targetId = activeView.primarySessionId;
    if (!targetId) return { ok: false, message: "no primary session" };

    const target = sourceRegistry.get(targetId);
    if (!target) return { ok: false, message: "no control target" };
    const normalizedAction = normalizeControlAction(action);
    if (!normalizedAction) return unsupportedControlResult(action, "unknown-action");
    const wrapperControl = resolveWrapperSelectorControl(target, normalizedAction);
    const supportsCapability = hasControlCapability(target.snapshot, normalizedAction);
    if (!supportsCapability && !wrapperControl) {
      const result = unsupportedControlResult(normalizedAction, "capability-missing");
      pushControlDiagnostic("active", target, normalizedAction, value, result);
      flushDiagnosticsIfDebug();
      return result;
    }

    try {
      debugLog("control primary", {
        action: normalizedAction,
        value,
        targetId,
      });

      if (wrapperControl) {
        const wrapperResult = await executeWrapperSelectorControl(target, wrapperControl, value);
        if (wrapperResult?.ok) {
          void rememberWrapperVolumeFromControl(target, normalizedAction, value, wrapperResult);
          pushControlDiagnostic("active", target, normalizedAction, value, wrapperResult);
          flushDiagnosticsIfDebug();
          return wrapperResult;
        }
        if (shouldPreferWrapperOnly(wrapperControl, normalizedAction) || !supportsCapability) {
          pushControlDiagnostic("active", target, normalizedAction, value, wrapperResult);
          flushDiagnosticsIfDebug();
          return wrapperResult;
        }
      }

      const payload = {
        type: MSG.CONTROL_EXEC,
        action: normalizedAction,
        value,
        sourceId: target.snapshot.sourceId,
      };
      const options = getSessionFrameOptions(target);
      const result = await chrome.tabs.sendMessage(target.tabId, payload, options);
      const normalizedResult = result || { ok: false, message: "control response missing" };
      void rememberWrapperVolumeFromControl(target, normalizedAction, value, normalizedResult);
      pushControlDiagnostic("active", target, normalizedAction, value, normalizedResult);
      flushDiagnosticsIfDebug();
      return normalizedResult;
    } catch (error) {
      const result = { ok: false, message: String(error) };
      pushControlDiagnostic("active", target, normalizedAction, value, result);
      flushDiagnosticsIfDebug();
      return result;
    }
  }

  async function handleControlSession(sessionId, action, value) {
    const target = sourceRegistry.get(String(sessionId || ""));
    if (!target) return { ok: false, message: "session not found" };
    const normalizedAction = normalizeControlAction(action);
    if (!normalizedAction) return unsupportedControlResult(action, "unknown-action");
    const wrapperControl = resolveWrapperSelectorControl(target, normalizedAction);
    const supportsCapability = hasControlCapability(target.snapshot, normalizedAction);
    if (!supportsCapability && !wrapperControl) {
      const result = unsupportedControlResult(normalizedAction, "capability-missing");
      pushControlDiagnostic("session", target, normalizedAction, value, result);
      flushDiagnosticsIfDebug();
      return result;
    }

    try {
      debugLog("control session", {
        action: normalizedAction,
        value,
        sessionId: String(sessionId || ""),
      });

      if (wrapperControl) {
        const wrapperResult = await executeWrapperSelectorControl(target, wrapperControl, value);
        if (wrapperResult?.ok) {
          void rememberWrapperVolumeFromControl(target, normalizedAction, value, wrapperResult);
          pushControlDiagnostic("session", target, normalizedAction, value, wrapperResult);
          flushDiagnosticsIfDebug();
          return wrapperResult;
        }
        if (shouldPreferWrapperOnly(wrapperControl, normalizedAction) || !supportsCapability) {
          pushControlDiagnostic("session", target, normalizedAction, value, wrapperResult);
          flushDiagnosticsIfDebug();
          return wrapperResult;
        }
      }

      const payload = {
        type: MSG.CONTROL_EXEC,
        action: normalizedAction,
        value,
        sourceId: target.snapshot.sourceId,
      };
      const options = getSessionFrameOptions(target);
      const result = await chrome.tabs.sendMessage(target.tabId, payload, options);
      const normalizedResult = result || { ok: false, message: "control response missing" };
      void rememberWrapperVolumeFromControl(target, normalizedAction, value, normalizedResult);
      pushControlDiagnostic("session", target, normalizedAction, value, normalizedResult);
      flushDiagnosticsIfDebug();
      return normalizedResult;
    } catch (error) {
      const result = { ok: false, message: String(error) };
      pushControlDiagnostic("session", target, normalizedAction, value, result);
      flushDiagnosticsIfDebug();
      return result;
    }
  }

  return {
    handleControlActive,
    handleControlSession,
    unsupportedControlResult,
    normalizeControlAction,
    resolveWrapperSelectorControl,
  };
}
