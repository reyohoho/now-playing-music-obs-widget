function findById(sessions, sessionId) {
  return sessions.find((session) => session.sessionId === sessionId) || null;
}

function playbackRank(playbackState) {
  const value = String(playbackState || "").trim().toLowerCase();
  if (value === "playing") return 0;
  if (value === "paused") return 1;
  if (value === "ended") return 2;
  if (value === "idle") return 3;
  return Number.MAX_SAFE_INTEGER;
}

function sourceIdOf(session) {
  return String(session?.sourceId || "").trim().toLowerCase();
}

function findBestBySource(sessions, sourceId) {
  const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
  if (!normalizedSourceId) return null;

  const candidates = sessions.filter((session) => sourceIdOf(session) === normalizedSourceId);
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const byPlayback = playbackRank(a?.playbackState) - playbackRank(b?.playbackState);
    if (byPlayback !== 0) return byPlayback;

    const byUpdatedAt = (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
    if (byUpdatedAt !== 0) return byUpdatedAt;

    return String(a?.sessionId || "").localeCompare(String(b?.sessionId || ""));
  });

  return candidates[0] || null;
}

function isSourceAutoPickEnabled(sourceAutoPickMap, sourceId) {
  const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
  if (!normalizedSourceId) return false;
  if (!sourceAutoPickMap || typeof sourceAutoPickMap !== "object") return true;
  return sourceAutoPickMap[normalizedSourceId] !== false;
}

function buildSingleSessionAutoPickState(current, sessions, sourceAutoPickMap) {
  if (!Array.isArray(sessions) || sessions.length !== 1) return null;
  const onlySession = sessions[0];
  const onlySourceId = sourceIdOf(onlySession);
  if (!isSourceAutoPickEnabled(sourceAutoPickMap, onlySourceId)) return null;
  return {
    primarySessionId: onlySession.sessionId,
    sessionCount: sessions.length,
    selectedByUser: false,
    selectedSourceId: onlySourceId,
  };
}

export function createPrimarySessionState() {
  return {
    primarySessionId: "",
    sessionCount: 0,
    selectedByUser: false,
    selectedSourceId: "",
  };
}

export function reducePrimarySession(state, event) {
  const current = state || createPrimarySessionState();
  const sessions = Array.isArray(event?.sessions) ? event.sessions : [];
  const sessionCount = sessions.length;
  const sourceAutoPickMap =
    event?.sourceAutoPickMap && typeof event.sourceAutoPickMap === "object"
      ? event.sourceAutoPickMap
      : {};

  if (event?.type === "SELECT") {
    const selectedId = String(event.sessionId || "");
    const selected = selectedId ? findById(sessions, selectedId) : null;
    if (!selected) {
      return {
        primarySessionId: current.primarySessionId || "",
        sessionCount,
        selectedByUser: Boolean(current.selectedByUser),
        selectedSourceId: String(current.selectedSourceId || ""),
      };
    }
    return {
      primarySessionId: selected.sessionId,
      sessionCount,
      selectedByUser: true,
      selectedSourceId: sourceIdOf(selected),
    };
  }

  const currentPrimary = current.primarySessionId
    ? findById(sessions, current.primarySessionId)
    : null;
  if (currentPrimary) {
    return {
      primarySessionId: currentPrimary.sessionId,
      sessionCount,
      selectedByUser: Boolean(current.selectedByUser),
      selectedSourceId: sourceIdOf(currentPrimary) || String(current.selectedSourceId || ""),
    };
  }

  const singleSessionAutoPick = buildSingleSessionAutoPickState(current, sessions, sourceAutoPickMap);

  if (current.selectedByUser && current.primarySessionId) {
    const selectedSourceId = String(current.selectedSourceId || "");
    if (
      selectedSourceId &&
      isSourceAutoPickEnabled(sourceAutoPickMap, selectedSourceId)
    ) {
      const sourceFallback = findBestBySource(sessions, selectedSourceId);
      if (sourceFallback) {
        return {
          primarySessionId: sourceFallback.sessionId,
          sessionCount,
          selectedByUser: true,
          selectedSourceId: sourceIdOf(sourceFallback) || selectedSourceId,
        };
      }
    }

    if (singleSessionAutoPick) return singleSessionAutoPick;

    return {
      primarySessionId: current.primarySessionId,
      sessionCount,
      selectedByUser: true,
      selectedSourceId,
    };
  }

  if (singleSessionAutoPick) return singleSessionAutoPick;

  if (!current.selectedByUser && current.sessionCount === 0 && sessionCount > 0) {
    return {
      primarySessionId: sessions[0].sessionId,
      sessionCount,
      selectedByUser: false,
      selectedSourceId: sourceIdOf(sessions[0]),
    };
  }

  return {
    primarySessionId: "",
    sessionCount,
    selectedByUser: false,
    selectedSourceId: "",
  };
}
