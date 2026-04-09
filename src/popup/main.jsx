import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { MSG } from "@/shared/messages";
import {
  createTranslator,
  resolveLocale,
} from "@/shared/i18n";
import { isWrapperSourceId } from "@/shared/wrapperRules";
import { ActiveSourcesSection } from "@/popup/components/ActiveSourcesSection";
import { PopupTopPanel } from "@/popup/components/PopupTopPanel";
import { useSessionDrafts } from "@/popup/hooks/useSessionDrafts";
import {
  COLOR_SCHEME_QUERY,
  collectTabSeedSourceIds,
  isSystemDarkMode,
  normalizeAccentColor,
  normalizeAppearance,
  normalizeSessionIdList,
  normalizeSourceIdList,
  normalizeUiLocale,
  readBulkMutedRestoreVolumeBySession,
  readBulkMutedSessionIds,
  runtimeMessage,
  sendActiveTabMessage,
  sendTabMessageWithRetry,
  sessionKey,
  sourceIdFromSessionId,
  VOLUME_EPSILON,
  writeBulkMutedRestoreVolumeBySession,
  writeBulkMutedSessionIds,
} from "@/popup/popupHelpers";

const LIVE_COVER_FPS = 24;
const LIVE_COVER_INTERVAL_MS = Math.max(16, Math.floor(1000 / LIVE_COVER_FPS));
const LIVE_COVER_MAX_EDGE = 176;
const LIVE_COVER_QUALITY = 0.48;
const LIVE_COVER_INACTIVE_INTERVAL_MS = 350;
const HOVER_PREVIEW_FPS = 60;
const HOVER_PREVIEW_INTERVAL_MS = Math.max(8, Math.floor(1000 / HOVER_PREVIEW_FPS));
const HOVER_PREVIEW_MAX_EDGE = 1400;
const HOVER_PREVIEW_QUALITY = 0.92;
const HOVER_PREVIEW_MARGIN = 10;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function PopupApp() {
  const [view, setView] = useState(null);
  const [connectionError, setConnectionError] = useState("");
  const [actionInfo, setActionInfo] = useState("");
  const [systemDark, setSystemDark] = useState(() => isSystemDarkMode());
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [bulkMutedSessionIds, setBulkMutedSessionIds] = useState(() => readBulkMutedSessionIds());
  const [bulkMutedRestoreVolumeBySession, setBulkMutedRestoreVolumeBySession] = useState(() =>
    readBulkMutedRestoreVolumeBySession()
  );
  const [liveCoverBySessionId, setLiveCoverBySessionId] = useState({});
  const [hoverPreview, setHoverPreview] = useState(null);
  const [hoverPreviewCoverUrl, setHoverPreviewCoverUrl] = useState("");
  const locale = useMemo(() => {
    const uiLocale = normalizeUiLocale(view?.uiLocale);
    return uiLocale || resolveLocale();
  }, [view?.uiLocale]);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const obsLabel = t("services.obs");
  const twitchLabel = t("services.twitch");

  const draggingProviderIdRef = useRef("");
  const liveCoverSessionsRef = useRef([]);
  const liveVideoCoversEnabledRef = useRef(false);
  const hoverPreviewRef = useRef(null);

  const requestVideoFrameCover = useCallback((tabId, frameId = 0, options = {}) => {
    return new Promise((resolve) => {
      if (!chrome?.tabs?.sendMessage) {
        resolve({ ok: false, message: "tabs messaging unavailable" });
        return;
      }

      const maxEdge = clamp(Number(options?.maxEdge) || LIVE_COVER_MAX_EDGE, 48, 2048);
      const quality = clamp(Number(options?.quality) || LIVE_COVER_QUALITY, 0.1, 0.95);

      chrome.tabs.sendMessage(
        tabId,
        {
          type: MSG.POPUP_REQUEST_VIDEO_FRAME_COVER,
          maxEdge,
          quality,
        },
        { frameId: Number.isInteger(frameId) ? frameId : 0 },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, message: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, message: "empty response" });
        }
      );
    });
  }, []);

  const sendSessionControl = useCallback((sessionId, action, value) => {
    return runtimeMessage({
      type: MSG.POPUP_CONTROL_SESSION,
      sessionId,
      action,
      value,
    });
  }, []);

  const sendSetPrimarySession = useCallback((sessionId) => {
    return runtimeMessage({
      type: MSG.POPUP_SET_PRIMARY_SESSION,
      sessionId,
    });
  }, []);

  const sendSeek = useCallback(
    (sessionId, value) => sendSessionControl(sessionId, "seek", value),
    [sendSessionControl]
  );

  const drafts = useSessionDrafts({ sendSeek });
  const { syncDraftsWithPayload } = drafts;

  const refreshState = useCallback(async () => {
    const response = await runtimeMessage({ type: MSG.POPUP_GET_STATE });
    if (response?.ok) {
      setConnectionError("");
      setView(response.payload || null);
      return;
    }
    setConnectionError(String(response?.message || t("popup.errors.backgroundNoResponse")));
  }, [t]);

  useEffect(() => {
    const handler = (message) => {
      if (message?.type !== MSG.STATE_BROADCAST) return;
      syncDraftsWithPayload(message.payload);
      setConnectionError("");
      setView(message.payload);
    };

    chrome.runtime.onMessage.addListener(handler);
    void refreshState();
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refreshState, syncDraftsWithPayload]);

  useEffect(() => {
    liveCoverSessionsRef.current = Array.isArray(view?.activeSessions) ? view.activeSessions : [];
    liveVideoCoversEnabledRef.current = view?.liveVideoCoversInPopup === true;
  }, [view?.activeSessions, view?.liveVideoCoversInPopup]);

  useEffect(() => {
    hoverPreviewRef.current = hoverPreview;
  }, [hoverPreview]);

  useEffect(() => {
    const styleSlot = document.getElementById("customCssSlot");
    if (!styleSlot) return;
    styleSlot.textContent = view?.customCss || "";
  }, [view?.customCss]);

  useEffect(() => {
    writeBulkMutedSessionIds(normalizeSessionIdList(bulkMutedSessionIds));
  }, [bulkMutedSessionIds]);

  useEffect(() => {
    writeBulkMutedRestoreVolumeBySession(bulkMutedRestoreVolumeBySession);
  }, [bulkMutedRestoreVolumeBySession]);

  useEffect(() => {
    const activeIds = new Set(
      (Array.isArray(view?.activeSessions) ? view.activeSessions : [])
        .map((session) => sessionKey(session))
        .filter(Boolean)
    );

    setLiveCoverBySessionId((prev) => {
      const entries = Object.entries(prev || {});
      if (!entries.length) return prev;
      let changed = false;
      const next = {};
      for (const [id, coverUrl] of entries) {
        if (!activeIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = coverUrl;
      }
      return changed ? next : prev;
    });
  }, [view?.activeSessions]);

  useEffect(() => {
    if (view?.liveVideoCoversInPopup === true) return;
    setLiveCoverBySessionId((prev) => {
      if (!prev || !Object.keys(prev).length) return prev;
      return {};
    });
    setHoverPreview(null);
    setHoverPreviewCoverUrl("");
  }, [view?.liveVideoCoversInPopup]);

  useEffect(() => {
    if (!hoverPreview?.sessionId) return;
    const activeSessions = Array.isArray(view?.activeSessions) ? view.activeSessions : [];
    const stillExists = activeSessions.some((session) => sessionKey(session) === hoverPreview.sessionId);
    if (stillExists) return;
    setHoverPreview(null);
    setHoverPreviewCoverUrl("");
  }, [hoverPreview?.sessionId, view?.activeSessions]);

  useEffect(() => {
    const sessionId = String(hoverPreview?.sessionId || "").trim();
    if (!sessionId) {
      setHoverPreviewCoverUrl("");
      return;
    }

    const initialCover = String(liveCoverBySessionId?.[sessionId] || "").trim();
    setHoverPreviewCoverUrl(initialCover.startsWith("data:image/") ? initialCover : "");
  }, [hoverPreview?.sessionId]);

  const handleLivePreviewHoverChange = useCallback((payload) => {
    const next = payload && typeof payload === "object" ? payload : {};
    if (next.active !== true) {
      setHoverPreview(null);
      return;
    }

    const sessionId = String(next.sessionId || "").trim();
    const tabId = Number(next.tabId);
    const frameId = Number.isInteger(next.frameId) ? next.frameId : 0;
    if (!sessionId || !Number.isInteger(tabId) || tabId < 0) return;

    const anchorRect = next.anchorRect && typeof next.anchorRect === "object" ? next.anchorRect : {};
    const left = Number(anchorRect.left) || 0;
    const top = Number(anchorRect.top) || 0;
    const width = Math.max(0, Number(anchorRect.width) || 0);
    const height = Math.max(0, Number(anchorRect.height) || 0);

    setHoverPreview({
      sessionId,
      tabId,
      frameId,
      anchorRect: { left, top, width, height },
    });
  }, []);

  useEffect(() => {
    const sessionId = String(hoverPreview?.sessionId || "").trim();
    const tabId = Number(hoverPreview?.tabId);
    const frameId = Number.isInteger(hoverPreview?.frameId) ? hoverPreview.frameId : 0;
    const liveEnabled = view?.liveVideoCoversInPopup === true;
    if (!sessionId || !Number.isInteger(tabId) || tabId < 0 || !liveEnabled) return;

    let cancelled = false;
    let timerId = 0;
    let inFlight = false;

    const scheduleNextTick = (delayMs) => {
      if (cancelled) return;
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        void tick();
      }, Math.max(0, Number(delayMs) || 0));
    };

    const tick = async () => {
      if (cancelled) return;
      const currentHover = hoverPreviewRef.current;
      if (!currentHover || String(currentHover?.sessionId || "") !== sessionId) return;

      if (document.visibilityState !== "visible") {
        scheduleNextTick(80);
        return;
      }

      if (inFlight) {
        scheduleNextTick(HOVER_PREVIEW_INTERVAL_MS);
        return;
      }

      inFlight = true;
      try {
        const response = await requestVideoFrameCover(tabId, frameId, {
          maxEdge: HOVER_PREVIEW_MAX_EDGE,
          quality: HOVER_PREVIEW_QUALITY,
        });
        const coverUrl = String(response?.coverUrl || "").trim();
        if (response?.ok && coverUrl.startsWith("data:image/")) {
          setHoverPreviewCoverUrl((prev) => (prev === coverUrl ? prev : coverUrl));
        }
      } finally {
        inFlight = false;
        scheduleNextTick(HOVER_PREVIEW_INTERVAL_MS);
      }
    };

    scheduleNextTick(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    hoverPreview?.sessionId,
    hoverPreview?.tabId,
    hoverPreview?.frameId,
    requestVideoFrameCover,
    view?.liveVideoCoversInPopup,
  ]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const onChange = () => {
      setSystemDark(mediaQuery.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  const openOptionsPageSafe = useCallback(() => {
    const fallbackUrl = chrome.runtime.getURL("src/options/index.html");

    if (typeof chrome.runtime.openOptionsPage === "function") {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: fallbackUrl }, () => void chrome.runtime.lastError);
        }
      });
      return;
    }

    chrome.tabs.create({ url: fallbackUrl }, () => void chrome.runtime.lastError);
  }, []);

  const openWrapperOverlayOnActiveTab = useCallback(async () => {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = Number.isInteger(tabs?.[0]?.id) ? tabs[0].id : null;
    const seedChildSourceIds = collectTabSeedSourceIds(view?.activeSessions || [], tabId, isWrapperSourceId);

    const response = await sendActiveTabMessage({
      type: MSG.WRAPPER_OVERLAY_OPEN,
      mode: "create",
      seedChildSourceIds,
    });
    if (!response?.ok) {
      setActionInfo(
        t("popup.wrapper.picker.errors.startFailed", {
          error: String(response?.message || t("status.unknown")),
        })
      );
      return;
    }
    window.close();
  }, [t, view?.activeSessions]);

  const openWrapperOverlayOnTab = useCallback(
    async (tabId, mode = "create", ruleId = "", seedChildSourceIds = []) => {
      if (!Number.isInteger(tabId) || tabId < 0) {
        return { ok: false, message: "No target tab" };
      }
      return sendTabMessageWithRetry(tabId, {
        type: MSG.WRAPPER_OVERLAY_OPEN,
        mode,
        ruleId,
        seedChildSourceIds: normalizeSourceIdList(seedChildSourceIds),
      }, { frameId: 0 });
    },
    []
  );

  const activateTabById = useCallback((tabId) => {
    return new Promise((resolve) => {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, tab: tab || null });
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timerId = 0;
    let inFlight = false;
    const retryAfterByFrame = new Map();

    const scheduleNextTick = (delayMs) => {
      if (cancelled) return;
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        void tick();
      }, Math.max(0, Number(delayMs) || 0));
    };

    const pickTargetFrames = () => {
      const sessions = Array.isArray(liveCoverSessionsRef.current) ? liveCoverSessionsRef.current : [];
      if (!sessions.length) return [];
      const now = Date.now();

      const byFrame = new Map();
      for (const session of sessions) {
        const sessionId = sessionKey(session);
        const tabId = Number(session?.tabId);
        const frameId = Number.isInteger(session?.frameId) ? session.frameId : 0;
        if (!sessionId || !Number.isInteger(tabId) || tabId < 0) continue;

        const key = `${tabId}:${frameId}`;
        const retryAfter = Number(retryAfterByFrame.get(key)) || 0;
        if (retryAfter > now) continue;
        const existing = byFrame.get(key);
        if (existing) {
          existing.sessionIds.push(sessionId);
          continue;
        }

        byFrame.set(key, {
          tabId,
          frameId,
          sessionIds: [sessionId],
        });
      }

      return [...byFrame.values()];
    };

    const tick = async () => {
      if (cancelled) return;
      if (inFlight) {
        scheduleNextTick(LIVE_COVER_INTERVAL_MS);
        return;
      }

      if (!liveVideoCoversEnabledRef.current) {
        scheduleNextTick(LIVE_COVER_INACTIVE_INTERVAL_MS);
        return;
      }

      if (document.visibilityState !== "visible") {
        scheduleNextTick(LIVE_COVER_INACTIVE_INTERVAL_MS);
        return;
      }

      const targets = pickTargetFrames();
      if (!targets.length) {
        scheduleNextTick(LIVE_COVER_INACTIVE_INTERVAL_MS);
        return;
      }

      inFlight = true;
      try {
        const updates = await Promise.all(
          targets.map(async (target) => {
            const response = await requestVideoFrameCover(target.tabId, target.frameId);
            const coverUrl = String(response?.coverUrl || "").trim();
            const frameKey = `${target.tabId}:${target.frameId}`;
            if (!response?.ok || !coverUrl.startsWith("data:image/")) {
              retryAfterByFrame.set(frameKey, Date.now() + 2000);
              return null;
            }
            retryAfterByFrame.delete(frameKey);
            return {
              sessionIds: target.sessionIds,
              coverUrl,
            };
          })
        );

        const validUpdates = updates.filter(Boolean);
        if (validUpdates.length) {
          setLiveCoverBySessionId((prev) => {
            const next = {
              ...(prev || {}),
            };
            let changed = false;
            for (const item of validUpdates) {
              for (const id of item.sessionIds) {
                if (next[id] === item.coverUrl) continue;
                next[id] = item.coverUrl;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      } finally {
        inFlight = false;
        scheduleNextTick(LIVE_COVER_INTERVAL_MS);
      }
    };

    scheduleNextTick(LIVE_COVER_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [requestVideoFrameCover]);

  const handleToggleTracking = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, trackingEnabled: enabled } : prev));
    void runtimeMessage({
      type: MSG.POPUP_SET_TRACKING_ENABLED,
      enabled,
    });
  }, []);

  const handleToggleObsEnabled = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, obsEnabled: enabled } : prev));
    void runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        obs: {
          enabled,
        },
      },
    });
  }, []);

  const handleToggleTwitchEnabled = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, twitchEnabled: enabled } : prev));
    void runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        twitch: {
          enabled,
        },
      },
    });
  }, []);

  const handleToggleTwitchControl = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, twitchControlEnabled: enabled } : prev));
    void runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        twitch: {
          controlEnabled: enabled,
        },
      },
    });
  }, []);

  const handleToggleTwitchAnnounce = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, twitchAnnounceEnabled: enabled } : prev));
    void runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        twitch: {
          announceEnabled: enabled,
        },
      },
    });
  }, []);

  const handleToggleAllowGenericWebInjection = useCallback((enabled) => {
    setView((prev) => (prev ? { ...prev, allowGenericWebInjection: enabled } : prev));
    void runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        allowGenericWebInjection: enabled,
      },
    });
  }, []);

  const handleProviderEnabled = useCallback((sourceId, enabled) => {
    setView((prev) => {
      if (!prev) return prev;
      const providers = (prev.providers || []).map((provider) =>
        provider.id === sourceId ? { ...provider, enabled } : provider
      );
      return { ...prev, providers };
    });

    void runtimeMessage({
      type: MSG.POPUP_SET_ENABLED,
      sourceId,
      enabled,
    });
  }, []);

  const handleProviderDrop = useCallback(
    (targetId) => {
      const draggingId = draggingProviderIdRef.current;
      if (!draggingId || draggingId === targetId || !view) return;

      const order = [...(view.sourceOrder || [])];
      const from = order.indexOf(draggingId);
      const to = order.indexOf(targetId);
      if (from === -1 || to === -1) return;

      order.splice(from, 1);
      order.splice(to, 0, draggingId);

      setView((prev) => (prev ? { ...prev, sourceOrder: order } : prev));
      draggingProviderIdRef.current = "";

      void runtimeMessage({ type: MSG.POPUP_SET_ORDER, order });
    },
    [view]
  );

  const sessionsForDisplay = useMemo(() => {
    const sessions = Array.isArray(view?.activeSessions) ? view.activeSessions : [];
    if (!sessions.length) return [];

    return sessions.map((session) => {
      const id = sessionKey(session);
      if (!id) return session;
      const liveCover = String(liveCoverBySessionId?.[id] || "").trim();
      if (!liveCover.startsWith("data:image/")) return session;
      return {
        ...session,
        coverUrl: liveCover,
      };
    });
  }, [view?.activeSessions, liveCoverBySessionId]);

  const sessionById = useMemo(() => {
    const map = new Map();
    for (const session of sessionsForDisplay) {
      map.set(sessionKey(session), session);
    }
    return map;
  }, [sessionsForDisplay]);

  const wrapperRuleById = useMemo(() => {
    const map = new Map();
    for (const rule of view?.wrapperRules || []) {
      const ruleId = String(rule?.id || "").trim();
      if (!ruleId) continue;
      map.set(ruleId, rule);
    }
    return map;
  }, [view?.wrapperRules]);

  const providersByOrder = useMemo(() => {
    const order = view?.sourceOrder || [];
    const providers = view?.providers || [];
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const sorted = [];

    for (const id of order) {
      const provider = byId.get(id);
      if (provider) {
        sorted.push(provider);
        byId.delete(id);
      }
    }

    for (const provider of byId.values()) sorted.push(provider);
    return sorted;
  }, [view?.providers, view?.sourceOrder]);

  const sessionsBySource = useMemo(() => {
    const map = new Map();
    const sessions = sessionsForDisplay;
    for (const session of sessions) {
      const key = String(session.sourceId || "");
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(session);
    }

    for (const [sourceId, items] of map) {
      items.sort((a, b) => String(a.sessionId || "").localeCompare(String(b.sessionId || "")));
      map.set(sourceId, items);
    }
    return map;
  }, [sessionsForDisplay]);

  const primaryPreviewLine = useMemo(() => {
    const snapshot = view?.activeSnapshot;
    if (!snapshot) return t("popup.primary.empty");
    const artist = snapshot.artist ? `${snapshot.artist} — ` : "";
    return `${artist}${snapshot.title || t("popup.primary.untitled")}`;
  }, [t, view?.activeSnapshot]);

  const bulkMuteDerivedState = useMemo(() => {
    const sessions = sessionsForDisplay;
    const sourceBulkMuteIgnoreMap =
      view?.sourceBulkMuteIgnoreMap && typeof view.sourceBulkMuteIgnoreMap === "object"
        ? view.sourceBulkMuteIgnoreMap
        : {};

    let mutedCount = 0;
    let unmutedCount = 0;
    for (const session of sessions) {
      const sourceId = String(session?.sourceId || "").trim().toLowerCase();
      if (sourceId && sourceBulkMuteIgnoreMap[sourceId] === true) continue;
      const volume = Math.max(0, Math.min(1, Number(session?.volume) || 0));
      const isMuted = Boolean(session?.muted) || volume <= VOLUME_EPSILON;
      if (isMuted) mutedCount += 1;
      else unmutedCount += 1;
    }

    return {
      mutedCount,
      unmutedCount,
      allEligibleMuted: mutedCount > 0 && unmutedCount === 0,
    };
  }, [sessionsForDisplay, view?.sourceBulkMuteIgnoreMap]);

  const bulkMuteToggleActive = bulkMutedSessionIds.length > 0 || bulkMuteDerivedState.allEligibleMuted;

  const handleToggleBulkMute = useCallback(async () => {
    const sessions = sessionsForDisplay;
    const sourceBulkMuteIgnoreMap =
      view?.sourceBulkMuteIgnoreMap && typeof view.sourceBulkMuteIgnoreMap === "object"
        ? view.sourceBulkMuteIgnoreMap
        : {};
    if (!sessions.length) return;

    if (bulkMuteToggleActive) {
      const restoreVolumeBySource = {};
      for (const [storedSessionId, restoreVolume] of Object.entries(bulkMutedRestoreVolumeBySession || {})) {
        const sourceId = sourceIdFromSessionId(storedSessionId);
        const volume = Number(restoreVolume);
        if (!sourceId || !Number.isFinite(volume) || volume <= VOLUME_EPSILON) continue;
        if (!Number.isFinite(Number(restoreVolumeBySource[sourceId]))) {
          restoreVolumeBySource[sourceId] = volume;
        }
      }
      const targets = sessions.filter((session) => {
        const id = sessionKey(session);
        if (!id) return false;
        const sourceId = String(session?.sourceId || "").trim().toLowerCase();
        if (sourceId && sourceBulkMuteIgnoreMap[sourceId] === true) return false;
        const volume = Math.max(0, Math.min(1, Number(session?.volume) || 0));
        const isMuted = Boolean(session?.muted) || volume <= VOLUME_EPSILON;
        return isMuted;
      });

      if (!targets.length) {
        setBulkMutedSessionIds([]);
        setBulkMutedRestoreVolumeBySession({});
        return;
      }

      const results = await Promise.all(
        targets.map((session) => {
          const id = sessionKey(session);
          const sourceId = String(session?.sourceId || "").trim().toLowerCase();
          const currentVolume = Math.max(0, Math.min(1, Number(session?.volume) || 0));
          const restoreVolume = Number(
            bulkMutedRestoreVolumeBySession[id] ?? restoreVolumeBySource[sourceId]
          );
          if (currentVolume <= VOLUME_EPSILON && Number.isFinite(restoreVolume) && restoreVolume > VOLUME_EPSILON) {
            return sendSessionControl(id, "volume", restoreVolume).then((volumeResult) => {
              if (!volumeResult?.ok) return volumeResult;
              return sendSessionControl(id, "unmute");
            });
          }
          return sendSessionControl(id, "unmute");
        })
      );
      const okCount = results.filter((result) => result?.ok).length;
      const failedIds = targets
        .filter((_, index) => !results[index]?.ok)
        .map((session) => sessionKey(session))
        .filter(Boolean);
      const nextRestoreVolumeBySession = Object.fromEntries(
        failedIds
          .map((id) => {
            const sourceId = sourceIdFromSessionId(id);
            const restoreVolume = bulkMutedRestoreVolumeBySession[id] ?? restoreVolumeBySource[sourceId];
            return [id, restoreVolume];
          })
          .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > VOLUME_EPSILON)
      );
      setBulkMutedSessionIds(failedIds);
      setBulkMutedRestoreVolumeBySession(nextRestoreVolumeBySession);

      if (!okCount) {
        setActionInfo(t("popup.activeSources.bulkMute.unmuteFailed"));
      } else if (okCount < targets.length) {
        setActionInfo(t("popup.activeSources.bulkMute.unmuteFailed"));
      } else {
        setActionInfo("");
      }
      void refreshState();
      return;
    }

    const targets = sessions.filter((session) => {
      const sourceId = String(session?.sourceId || "").trim().toLowerCase();
      if (sourceId && sourceBulkMuteIgnoreMap[sourceId] === true) return false;
      const volume = Math.max(0, Math.min(1, Number(session?.volume) || 0));
      return !session?.muted && volume > VOLUME_EPSILON;
    });
    if (!targets.length) {
      setActionInfo(t("popup.activeSources.bulkMute.noneToMute"));
      setBulkMutedSessionIds([]);
      setBulkMutedRestoreVolumeBySession({});
      return;
    }

    const targetIds = targets.map((session) => sessionKey(session)).filter(Boolean);
    const restoreVolumeBySession = Object.fromEntries(
      targets
        .map((session) => [sessionKey(session), Math.max(0, Math.min(1, Number(session?.volume) || 0))])
        .filter(([id, volume]) => Boolean(id) && Number.isFinite(volume) && volume > VOLUME_EPSILON)
    );
    const results = await Promise.all(
      targetIds.map((id) => sendSessionControl(id, "mute"))
    );
    const mutedIds = targetIds.filter((_, index) => results[index]?.ok);
    const nextRestoreVolumeBySession = Object.fromEntries(
      mutedIds
        .map((id) => [id, restoreVolumeBySession[id]])
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > VOLUME_EPSILON)
    );
    setBulkMutedSessionIds(mutedIds);
    setBulkMutedRestoreVolumeBySession(nextRestoreVolumeBySession);

    if (!mutedIds.length) {
      setActionInfo(t("popup.activeSources.bulkMute.muteFailed"));
    } else if (mutedIds.length < targetIds.length) {
      setActionInfo(t("popup.activeSources.bulkMute.muteFailed"));
    } else {
      setActionInfo("");
    }
    void refreshState();
  }, [
    bulkMuteToggleActive,
    bulkMutedRestoreVolumeBySession,
    bulkMutedSessionIds,
    refreshState,
    sendSessionControl,
    t,
    sessionsForDisplay,
    view?.sourceBulkMuteIgnoreMap,
  ]);

  const themeAccentColor = normalizeAccentColor(view?.themeAccentColor);
  const themeAppearance = normalizeAppearance(view?.themeAppearance);
  const resolvedThemeAppearance = themeAppearance === "system" ? (systemDark ? "dark" : "light") : themeAppearance;
  const headerTogglesDisabled = view?.trackingEnabled === false;
  const twitchControlDisabled = headerTogglesDisabled || view?.twitchEnabled === false;
  const twitchAnnounceDisabled = headerTogglesDisabled || view?.twitchEnabled === false;
  const showNowPlayingBlockInPopup = view?.showNowPlayingBlockInPopup !== false;
  const showHoverPreview =
    view?.liveVideoCoversInPopup === true &&
    Boolean(hoverPreview) &&
    String(hoverPreviewCoverUrl || "").startsWith("data:image/");

  const hoverPreviewPosition = useMemo(() => {
    const rect = hoverPreview?.anchorRect;
    if (!rect) return null;

    const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
    const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
    if (!viewportWidth || !viewportHeight) return null;

    const safeLeft = Number(rect.left) || 0;
    const safeTop = Number(rect.top) || 0;
    const safeWidth = Math.max(0, Number(rect.width) || 0);
    const safeHeight = Math.max(0, Number(rect.height) || 0);

    const width = Math.max(0, viewportWidth - HOVER_PREVIEW_MARGIN * 2);
    if (!width) return null;
    const height = Math.round((width * 9) / 16);
    const left = HOVER_PREVIEW_MARGIN;
    const right = HOVER_PREVIEW_MARGIN;

    const panelTopRect = document.querySelector(".panel--top")?.getBoundingClientRect?.();
    const minTopByHeader = Math.max(
      HOVER_PREVIEW_MARGIN,
      (Number(panelTopRect?.bottom) || 0) + HOVER_PREVIEW_MARGIN
    );
    const maxTop = viewportHeight - height - HOVER_PREVIEW_MARGIN;
    const minTop = Math.min(minTopByHeader, maxTop);

    const preferredBelow = safeTop + safeHeight + HOVER_PREVIEW_MARGIN;
    const preferredAbove = safeTop - height - HOVER_PREVIEW_MARGIN;
    const rawTop =
      preferredBelow <= maxTop ? preferredBelow : preferredAbove;
    const top = clamp(rawTop, minTop, maxTop);

    return { left, right, top, width, height };
  }, [
    hoverPreview?.anchorRect?.left,
    hoverPreview?.anchorRect?.top,
    hoverPreview?.anchorRect?.width,
    hoverPreview?.anchorRect?.height,
  ]);

  const cardSharedProps = useMemo(
    () => ({
      primarySessionId: view?.primarySessionId || "",
      t,
      activeSessions: sessionsForDisplay,
      wrapperRules: view?.wrapperRules || [],
      wrapperRuleById,
      sessionById,
      drafts,
      sendSessionControl,
      sendSetPrimarySession,
      sendSeek,
      refreshState,
      setActionInfo,
      setConnectionError,
      openWrapperOverlayOnTab,
      activateTabById,
      onLivePreviewHoverChange: handleLivePreviewHoverChange,
      resolvedThemeAppearance,
    }),
    [
      activateTabById,
      drafts,
      handleLivePreviewHoverChange,
      openWrapperOverlayOnTab,
      refreshState,
      sendSeek,
      sendSessionControl,
      sendSetPrimarySession,
      sessionById,
      t,
      sessionsForDisplay,
      resolvedThemeAppearance,
      view?.primarySessionId,
      view?.wrapperRules,
      wrapperRuleById,
    ]
  );

  const hoverPreviewPortal =
    showHoverPreview && hoverPreviewPosition
      ? createPortal(
          <div
            class="live-preview-hover-layer"
            style={{
              left: `${Math.round(hoverPreviewPosition.left)}px`,
              right: `${Math.round(hoverPreviewPosition.right)}px`,
              top: `${Math.round(hoverPreviewPosition.top)}px`,
              height: `${Math.round(hoverPreviewPosition.height)}px`,
            }}
            aria-hidden="true"
          >
            <img class="live-preview-hover-layer__image" src={hoverPreviewCoverUrl} alt="" draggable={false} />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Theme
        className="np-theme"
        accentColor={themeAccentColor}
        appearance={resolvedThemeAppearance}
        grayColor="slate"
        radius="medium"
        scaling="95%"
        panelBackground="solid"
      >
        <main class="c-stack c-stack--lg">
          {showNowPlayingBlockInPopup ? (
            <PopupTopPanel
              showNowPlayingBlockInPopup={showNowPlayingBlockInPopup}
              sourcesExpanded={sourcesExpanded}
              setSourcesExpanded={setSourcesExpanded}
              t={t}
              primaryPreviewLine={primaryPreviewLine}
              themeAccentColor={themeAccentColor}
              view={view}
              obsLabel={obsLabel}
              twitchLabel={twitchLabel}
              headerTogglesDisabled={headerTogglesDisabled}
              twitchControlDisabled={twitchControlDisabled}
              twitchAnnounceDisabled={twitchAnnounceDisabled}
              locale={locale}
              connectionError={connectionError}
              actionInfo={actionInfo}
              providersByOrder={providersByOrder}
              sessionsBySource={sessionsBySource}
              onToggleObsEnabled={handleToggleObsEnabled}
              onToggleTracking={handleToggleTracking}
              onToggleTwitchEnabled={handleToggleTwitchEnabled}
              onToggleTwitchControl={handleToggleTwitchControl}
              onToggleTwitchAnnounce={handleToggleTwitchAnnounce}
              onToggleAllowGenericWebInjection={handleToggleAllowGenericWebInjection}
              onProviderDragStart={(providerId) => {
                draggingProviderIdRef.current = providerId;
              }}
              onProviderDrop={handleProviderDrop}
              onProviderEnabled={handleProviderEnabled}
            />
          ) : null}

          <ActiveSourcesSection
            t={t}
            connectionError={connectionError}
            actionInfo={actionInfo}
            sessions={sessionsForDisplay}
            accentColor={themeAccentColor}
            bulkMuteToggleActive={bulkMuteToggleActive}
            onToggleBulkMute={() => {
              void handleToggleBulkMute();
            }}
            onAddWrapperFromTab={() => {
              void openWrapperOverlayOnActiveTab();
            }}
            onOpenOptions={openOptionsPageSafe}
            cardSharedProps={cardSharedProps}
          />
        </main>
      </Theme>
      {hoverPreviewPortal}
    </>
  );
}

render(<PopupApp />, document.getElementById("app"));
