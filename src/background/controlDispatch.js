export function getControlDispatchTarget(sessionState, sourceRegistry) {
  const sessionId = sessionState?.controlTargetSessionId;
  if (!sessionId) return null;

  const instance = sourceRegistry.get(sessionId);
  if (!instance) return null;

  return {
    sessionId,
    tabId: instance.tabId,
    frameId: Number.isInteger(instance.frameId) ? instance.frameId : 0,
    sourceId: instance.snapshot.sourceId,
    snapshot: instance.snapshot,
  };
}
