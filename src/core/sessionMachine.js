function orderRank(sourceId, sourceOrder) {
  const idx = sourceOrder.indexOf(sourceId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function playbackRank(playbackState) {
  if (playbackState === "playing") return 0;
  if (playbackState === "paused") return 1;
  if (playbackState === "ended") return 2;
  return Number.MAX_SAFE_INTEGER;
}

function snapshotUpdatedAt(session) {
  return Number(session?.snapshot?.updatedAt) || 0;
}

function stateToMode(playbackState) {
  if (playbackState === "playing") return "ACTIVE_PLAYING";
  if (playbackState === "paused") return "ACTIVE_PAUSED";
  if (playbackState === "ended") return "ACTIVE_ENDED";
  return "EMPTY";
}

function isSessionEnabled(session, settings) {
  const enabledMap = settings?.sourceEnabledMap || {};
  return enabledMap[session.snapshot.sourceId] !== false;
}

export function pickBestSession(sessions, settings) {
  const sourceOrder = settings?.sourceOrder || [];

  const candidates = sessions
    .filter((session) => isSessionEnabled(session, settings))
    .filter((session) => playbackRank(session.snapshot.playbackState) < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => {
      const byPlayback = playbackRank(a.snapshot.playbackState) - playbackRank(b.snapshot.playbackState);
      if (byPlayback !== 0) return byPlayback;

      const byOrder =
        orderRank(a.snapshot.sourceId, sourceOrder) - orderRank(b.snapshot.sourceId, sourceOrder);
      if (byOrder !== 0) return byOrder;

      return snapshotUpdatedAt(b) - snapshotUpdatedAt(a);
    });

  return candidates[0] ?? null;
}

export function createSessionMachineState() {
  return {
    mode: "EMPTY",
    activeSessionId: null,
    controlTargetSessionId: null,
  };
}

function isKnownEvent(eventType) {
  return (
    eventType === "SESSION_UPSERT" ||
    eventType === "SESSION_REMOVE" ||
    eventType === "TAB_REMOVE" ||
    eventType === "SETTINGS_CHANGED"
  );
}

export function reduceSessionMachine(state, event, context) {
  const previous = state || createSessionMachineState();
  if (!isKnownEvent(event?.type)) return previous;

  const sessions = context?.sessions || [];
  const settings = context?.settings || {};
  const active = pickBestSession(sessions, settings);

  if (!active) {
    return createSessionMachineState();
  }

  return {
    mode: stateToMode(active.snapshot.playbackState),
    activeSessionId: active.key,
    controlTargetSessionId: active.key,
  };
}
