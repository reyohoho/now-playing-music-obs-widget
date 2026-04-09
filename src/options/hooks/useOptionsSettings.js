import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { MSG } from "@/shared/messages";
import {
  TWITCH_CONTROL_COMMAND_ORDER,
  buildCommandAliasIndex,
} from "@/shared/twitchControlRouter";
import { createTranslator, resolveLocale } from "@/shared/i18n/index";
import {
  buildPatch,
  modelFromSettings,
  normalizeUiLocale,
  readInitialThemeFromStorage,
} from "@/options/optionsModel";
import {
  getObsStatus,
  getPopupState,
  getSettings,
  getTwitchStatus,
  obsReconnect,
  setSettings,
  startTwitchAuth,
  twitchReconnect,
} from "@/options/optionsApi";

function validateControlRouter(controlRouter, t) {
  const trigger = String(controlRouter?.trigger || "").trim();
  if (!trigger) return t("options.validation.triggerRequired");
  if (/\s/.test(trigger)) return t("options.validation.triggerNoSpaces");

  const { duplicates } = buildCommandAliasIndex(controlRouter.commands);
  if (duplicates.length) {
    const first = duplicates[0];
    return t("options.validation.aliasConflict", { alias: first.alias });
  }

  for (const commandId of TWITCH_CONTROL_COMMAND_ORDER) {
    const aliases = controlRouter.commands?.[commandId]?.aliases || [];
    if (!aliases.length) return t("options.validation.commandAliasRequired", { commandId });
  }

  return "";
}

export function useOptionsSettings({ showToast }) {
  const [model, setModel] = useState(() => {
    const initialTheme = readInitialThemeFromStorage();
    return modelFromSettings(
      {
        themeAppearance: initialTheme.appearance,
        themeAccentColor: initialTheme.accentColor,
      },
      resolveLocale()
    );
  });
  const [obsStatus, setObsStatus] = useState(null);
  const [twitchStatus, setTwitchStatus] = useState(null);
  const [twitchLog, setTwitchLog] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [activeSnapshot, setActiveSnapshot] = useState(null);
  const [routerValidation, setRouterValidation] = useState("");
  const [connectionError, setConnectionError] = useState("");

  const hydratingRef = useRef(true);
  const modelRef = useRef(model);
  const saveTimerRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const lastSaveToastAtRef = useRef(0);
  const skipAutosaveCountRef = useRef(0);

  modelRef.current = model;

  const resolvedUiLocale = useMemo(
    () => normalizeUiLocale(model.uiLocale || resolveLocale()),
    [model.uiLocale]
  );
  const t = useMemo(() => createTranslator(resolvedUiLocale), [resolvedUiLocale]);
  const fallbackT = useMemo(() => createTranslator(resolveLocale()), []);

  const updateModel = useCallback((updater) => {
    setModel((prev) => {
      const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      return next;
    });
  }, []);

  const persistSettings = useCallback(async () => {
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    const current = modelRef.current;
    const validationError = validateControlRouter(current.twitch.controlRouter, t);
    setRouterValidation(validationError);
    if (validationError) return;

    saveInFlightRef.current = true;
    const response = await setSettings(buildPatch(current));

    if (!response?.ok) {
      showToast(response?.message || t("options.toasts.saveError"), "error");
    } else if (!saveQueuedRef.current) {
      const now = Date.now();
      if (now - lastSaveToastAtRef.current > 900) {
        showToast(t("options.toasts.saved"), "success");
        lastSaveToastAtRef.current = now;
      }
    }

    saveInFlightRef.current = false;
    if (saveQueuedRef.current) {
      saveQueuedRef.current = false;
      void persistSettings();
    }
  }, [showToast, t]);

  useEffect(() => {
    if (hydratingRef.current) return;
    if (skipAutosaveCountRef.current > 0) {
      skipAutosaveCountRef.current -= 1;
      return;
    }

    const validationError = validateControlRouter(model.twitch.controlRouter, t);
    setRouterValidation(validationError);
    if (validationError) return;

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persistSettings();
    }, 350);

    return () => {
      window.clearTimeout(saveTimerRef.current);
    };
  }, [model, persistSettings, t]);

  const loadSettings = useCallback(async () => {
    const [settingsResp, stateResp] = await Promise.all([
      getSettings(),
      getPopupState(),
    ]);

    if (!settingsResp?.ok) {
      setConnectionError(settingsResp?.message || fallbackT("options.errors.loadSettings"));
      hydratingRef.current = false;
      return;
    }

    const nextModel = modelFromSettings(settingsResp.settings || {});
    // Focus + visibilitychange can trigger load twice; skip autosave for each model hydration.
    skipAutosaveCountRef.current += 1;
    setModel(nextModel);
    setObsStatus(settingsResp.obsStatus || null);
    setTwitchStatus(settingsResp.twitchStatus || null);
    setTwitchLog(settingsResp.twitchLog || []);
    setActiveSnapshot(stateResp?.ok ? stateResp.payload?.activeSnapshot || null : null);
    setDiagnostics(stateResp?.ok ? stateResp.payload?.diagnostics || [] : []);
    setConnectionError("");
    hydratingRef.current = false;
  }, [fallbackT]);

  useEffect(() => {
    void loadSettings();

    const handler = (message) => {
      if (message?.type !== MSG.STATE_BROADCAST) return;
      const payload = message.payload || {};
      setObsStatus(payload.obsStatus || null);
      setTwitchStatus(payload.twitchStatus || null);
      setTwitchLog(payload.twitchLog || []);
      setActiveSnapshot(payload.activeSnapshot || null);
      setDiagnostics(payload.diagnostics || []);
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [loadSettings]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadSettings();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadSettings]);

  const updateObs = useCallback(
    (patch) => {
      updateModel((prev) => ({
        ...prev,
        obs: { ...prev.obs, ...patch },
      }));
    },
    [updateModel]
  );

  const updateTwitch = useCallback(
    (patch) => {
      updateModel((prev) => ({
        ...prev,
        twitch: { ...prev.twitch, ...patch },
      }));
    },
    [updateModel]
  );

  const updateRouter = useCallback(
    (patch) => {
      updateModel((prev) => ({
        ...prev,
        twitch: {
          ...prev.twitch,
          controlRouter: {
            ...prev.twitch.controlRouter,
            ...patch,
          },
        },
      }));
    },
    [updateModel]
  );

  const updateCommand = useCallback(
    (commandId, updater) => {
      updateModel((prev) => {
        const current = prev.twitch.controlRouter.commands?.[commandId] || {};
        const nextCommand = typeof updater === "function" ? updater(current) : { ...current, ...updater };
        return {
          ...prev,
          twitch: {
            ...prev.twitch,
            controlRouter: {
              ...prev.twitch.controlRouter,
              commands: {
                ...prev.twitch.controlRouter.commands,
                [commandId]: nextCommand,
              },
            },
          },
        };
      });
    },
    [updateModel]
  );

  const onObsReconnect = useCallback(async () => {
    await obsReconnect();
    const response = await getObsStatus();
    if (response?.ok) setObsStatus(response.obsStatus || null);
  }, []);

  const onTwitchReconnect = useCallback(async () => {
    await twitchReconnect();
    const response = await getTwitchStatus();
    if (response?.ok) {
      setTwitchStatus(response.twitchStatus || null);
      setTwitchLog(response.twitchLog || []);
      showToast(
        response.twitchStatus?.state === "connected"
          ? t("options.toasts.twitchReconnected")
          : response.twitchStatus?.message || t("options.toasts.twitchStatusUpdated"),
        response.twitchStatus?.state === "connected" ? "success" : "info"
      );
      return;
    }
    showToast(response?.message || t("options.toasts.twitchStatusFailed"), "error");
  }, [showToast, t]);

  const onStartTwitchOAuth = useCallback(async () => {
    const saveResp = await setSettings({
      twitch: {
        clientId: String(modelRef.current?.twitch?.clientId || "").trim(),
      },
    });

    if (!saveResp?.ok) {
      showToast(saveResp?.message || t("options.toasts.clientIdSaveFailed"), "error");
      return;
    }

    const response = await startTwitchAuth();
    if (!response?.ok) {
      showToast(response?.message || t("options.toasts.twitchOAuthError"), "error");
      return;
    }

    showToast(
      t("options.toasts.twitchOAuthDone", {
        username: response.username || t("options.common.unknown"),
      }),
      "success"
    );
    await loadSettings();
  }, [loadSettings, showToast, t]);

  return {
    model,
    obsStatus,
    twitchStatus,
    twitchLog,
    diagnostics,
    activeSnapshot,
    routerValidation,
    connectionError,
    resolvedUiLocale,
    t,
    updateModel,
    updateObs,
    updateTwitch,
    updateRouter,
    updateCommand,
    onObsReconnect,
    onTwitchReconnect,
    onStartTwitchOAuth,
  };
}
