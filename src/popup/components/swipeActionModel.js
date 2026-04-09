const DEFAULT_THRESHOLD_PX = 50;

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function directionFromOffset(offsetPx) {
  if (!Number.isFinite(offsetPx) || Math.abs(offsetPx) < 0.5) return "none";
  return offsetPx < 0 ? "left" : "right";
}

export function resolveThresholdPx(action, dragConfig = {}) {
  const local = Number(action?.thresholdPx);
  if (Number.isFinite(local) && local > 0) return local;

  const global = Number(dragConfig?.thresholdPx);
  if (Number.isFinite(global) && global > 0) return global;

  return DEFAULT_THRESHOLD_PX;
}

export function computeSwipeProgress(distancePx, thresholdPx) {
  const safeDistance = Math.max(0, Number(distancePx) || 0);
  const safeThreshold = Math.max(1, Number(thresholdPx) || DEFAULT_THRESHOLD_PX);
  return clamp01(safeDistance / safeThreshold);
}

export function pickActionByDirection(direction, leftAction, rightAction) {
  if (direction === "left") return leftAction || null;
  if (direction === "right") return rightAction || null;
  return null;
}

export function decideSwipeRelease({
  offsetPx,
  leftAction = null,
  rightAction = null,
  dragConfig = {},
}) {
  const direction = directionFromOffset(offsetPx);
  if (direction === "none") {
    return {
      decision: "revert",
      direction,
      distancePx: 0,
      thresholdPx: resolveThresholdPx(null, dragConfig),
      progress: 0,
      isCommitReady: false,
      action: null,
    };
  }

  const action = pickActionByDirection(direction, leftAction, rightAction);
  const thresholdPx = resolveThresholdPx(action, dragConfig);
  const distancePx = Math.abs(Number(offsetPx) || 0);
  const progress = computeSwipeProgress(distancePx, thresholdPx);
  const isCommitReady = Boolean(action?.enabled) && distancePx >= thresholdPx;

  return {
    decision: isCommitReady ? "commit" : "revert",
    direction,
    distancePx,
    thresholdPx,
    progress,
    isCommitReady,
    action,
  };
}

export function applyDragResistance(rawOffsetPx, maxRevealPx = 136) {
  const offset = Number(rawOffsetPx) || 0;
  const sign = offset < 0 ? -1 : 1;
  const abs = Math.abs(offset);
  const max = Math.max(24, Number(maxRevealPx) || 136);

  if (abs <= max) return offset;

  const overflow = abs - max;
  const damped = max + overflow * 0.22;
  return sign * damped;
}
