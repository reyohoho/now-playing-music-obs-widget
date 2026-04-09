import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import {
  SEEK_SYNC_EPSILON,
  VOLUME_SYNC_EPSILON,
  normalizePlaybackState,
  sessionKey,
} from "@/popup/popupHelpers";

export function useSessionDrafts({ sendSeek }) {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const nowMsRef = useRef(Date.now());
  const seekDraggingIdRef = useRef("");
  const seekTimersRef = useRef(new Map());
  const seekDraftsRef = useRef(new Map());
  const volumeDraftsRef = useRef(new Map());
  const playbackDraftsRef = useRef(new Map());
  const lastNonZeroVolumesRef = useRef(new Map());

  const requestUiRefresh = useCallback(() => {
    forceUpdate();
  }, []);

  const clearSeekTimer = useCallback((sessionId) => {
    const timer = seekTimersRef.current.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    seekTimersRef.current.delete(sessionId);
  }, []);

  const scheduleSeek = useCallback(
    (sessionId, value) => {
      clearSeekTimer(sessionId);
      const timer = setTimeout(() => {
        seekTimersRef.current.delete(sessionId);
        void sendSeek(sessionId, value);
      }, 120);
      seekTimersRef.current.set(sessionId, timer);
    },
    [clearSeekTimer, sendSeek]
  );

  const syncDraftsWithPayload = useCallback(
    (payload) => {
      const sessions = payload?.activeSessions || [];
      const byId = new Map(sessions.map((session) => [sessionKey(session), session]));
      const aliveIds = new Set(byId.keys());

      for (const [key, draft] of playbackDraftsRef.current) {
        const session = byId.get(key);
        if (!session) {
          playbackDraftsRef.current.delete(key);
          continue;
        }
        const actualPlayback = normalizePlaybackState(session.playbackState);
        if (actualPlayback === draft) playbackDraftsRef.current.delete(key);
      }

      for (const [key, draft] of seekDraftsRef.current) {
        const session = byId.get(key);
        if (!session) {
          seekDraftsRef.current.delete(key);
          continue;
        }
        const actualPosition = Math.max(0, Number(session.positionSec) || 0);
        if (Number.isFinite(draft) && Math.abs(draft - actualPosition) <= SEEK_SYNC_EPSILON) {
          seekDraftsRef.current.delete(key);
        }
      }

      for (const [key, draft] of volumeDraftsRef.current) {
        const session = byId.get(key);
        if (!session) {
          volumeDraftsRef.current.delete(key);
          continue;
        }
        const actualVolume = Math.max(0, Math.min(1, Number(session.volume) || 0));
        if (Number.isFinite(draft) && Math.abs(draft - actualVolume) <= VOLUME_SYNC_EPSILON) {
          volumeDraftsRef.current.delete(key);
        }
      }

      if (seekDraggingIdRef.current && !aliveIds.has(seekDraggingIdRef.current)) {
        seekDraggingIdRef.current = "";
        seekDraftsRef.current.clear();
      }

      for (const key of [...lastNonZeroVolumesRef.current.keys()]) {
        if (!aliveIds.has(key)) lastNonZeroVolumesRef.current.delete(key);
      }

      for (const key of [...seekTimersRef.current.keys()]) {
        if (!aliveIds.has(key)) clearSeekTimer(key);
      }
    },
    [clearSeekTimer]
  );

  useEffect(() => {
    let rafId = 0;
    let lastTs = 0;

    const tick = (ts) => {
      if (ts - lastTs >= 250) {
        lastTs = ts;
        nowMsRef.current = Date.now();
        requestUiRefresh();
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [requestUiRefresh]);

  useEffect(
    () => () => {
      for (const timer of seekTimersRef.current.values()) {
        clearTimeout(timer);
      }
      seekTimersRef.current.clear();
    },
    []
  );

  return {
    nowMsRef,
    seekDraggingIdRef,
    seekDraftsRef,
    volumeDraftsRef,
    playbackDraftsRef,
    lastNonZeroVolumesRef,
    requestUiRefresh,
    clearSeekTimer,
    scheduleSeek,
    syncDraftsWithPayload,
  };
}
