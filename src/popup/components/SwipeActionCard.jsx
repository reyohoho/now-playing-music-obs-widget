import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { applyDragResistance, clamp01, decideSwipeRelease, directionFromOffset, pickActionByDirection } from "@/popup/components/swipeActionModel";

const DEFAULT_IGNORE_SELECTOR = "button,input,textarea,select,a,[role=\"slider\"],[data-swipe-ignore]";
const DEFAULT_DRAG_CONFIG = {
  thresholdPx: 50,
  maxRevealPx: 148,
  lockThresholdPx: 8,
  flyOutExtraPx: 124,
  flyOutDurationMs: 210,
  snapBackDurationMs: 170,
};

function mergeDragConfig(value) {
  return {
    ...DEFAULT_DRAG_CONFIG,
    ...(value || {}),
  };
}

function toResultOk(result) {
  if (result === false) return false;
  if (result && typeof result === "object" && result.ok === false) return false;
  return true;
}

export function SwipeActionCard({
  children,
  leftAction = null,
  rightAction = null,
  ignoreSelector = DEFAULT_IGNORE_SELECTOR,
  dragConfig = DEFAULT_DRAG_CONFIG,
  className = "",
}) {
  const rootRef = useRef(null);
  const gestureRef = useRef(null);
  const settleTimerRef = useRef(0);
  const phaseRef = useRef("idle");

  const [offsetPx, setOffsetPx] = useState(0);
  const [phase, setPhase] = useState("idle");

  const cfg = useMemo(() => mergeDragConfig(dragConfig), [dragConfig]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  const direction = directionFromOffset(offsetPx);
  const activeAction = pickActionByDirection(direction, leftAction, rightAction);
  const releasePreview = decideSwipeRelease({
    offsetPx,
    leftAction,
    rightAction,
    dragConfig: cfg,
  });
  const progress = releasePreview.progress;
  const isCommitReady = releasePreview.isCommitReady;

  const underlayContent = activeAction?.renderUnderlay?.({
    direction,
    distancePx: Math.abs(offsetPx),
    progress,
    isCommitReady,
  });

  const setPhaseSafe = (next) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const scheduleSettle = (nextPhase, ms) => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = 0;
      setPhaseSafe(nextPhase);
    }, ms);
  };

  const snapBack = () => {
    setPhaseSafe("snap-back");
    setOffsetPx(0);
    scheduleSettle("idle", cfg.snapBackDurationMs);
  };

  const handleCommit = async (decision, rawOffsetPx) => {
    const action = decision.action;
    if (!action?.onCommit) {
      snapBack();
      return;
    }

    const width = Math.max(280, Number(rootRef.current?.offsetWidth) || 0);
    const sign = decision.direction === "left" ? -1 : 1;
    const flyDistance = sign * (width + Math.max(24, Number(cfg.flyOutExtraPx) || 0));
    const flyPhase = decision.direction === "left" ? "fly-left" : "fly-right";

    setPhaseSafe(flyPhase);
    setOffsetPx(flyDistance);

    const ctx = {
      direction: decision.direction,
      distancePx: Math.abs(rawOffsetPx),
      progress: clamp01(decision.progress),
      isCommitReady: true,
    };

    await new Promise((resolve) => {
      scheduleSettle(phaseRef.current, cfg.flyOutDurationMs);
      window.setTimeout(resolve, cfg.flyOutDurationMs);
    });

    try {
      const result = await action.onCommit(ctx);
      if (toResultOk(result)) {
        setPhaseSafe("committed");
        return;
      }
      snapBack();
    } catch (_) {
      snapBack();
    }
  };

  const resetGesture = () => {
    gestureRef.current = null;
  };

  const onPointerDown = (event) => {
    if (phaseRef.current === "committed") return;
    if (event.button !== undefined && event.button !== 0) return;

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(ignoreSelector)) return;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rawDx: 0,
      axis: "pending",
      captured: false,
      captureTarget: event.currentTarget,
    };
  };

  const onPointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.rawDx = dx;

    if (gesture.axis === "pending") {
      const lockThreshold = Math.max(1, Number(cfg.lockThresholdPx) || 1);
      if (Math.abs(dx) < lockThreshold && Math.abs(dy) < lockThreshold) return;
      gesture.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (gesture.axis !== "x") {
        resetGesture();
        snapBack();
        return;
      }
      if (!gesture.captured) {
        gesture.captureTarget?.setPointerCapture?.(event.pointerId);
        gesture.captured = true;
      }
    }

    if (gesture.axis !== "x") return;
    event.preventDefault();
    if (phaseRef.current !== "dragging") setPhaseSafe("dragging");
    setOffsetPx(applyDragResistance(dx, cfg.maxRevealPx));
  };

  const finishPointer = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (gesture.captured) {
      gesture.captureTarget?.releasePointerCapture?.(event.pointerId);
    }
    resetGesture();

    if (gesture.axis !== "x") {
      snapBack();
      return;
    }

    const decision = decideSwipeRelease({
      offsetPx: gesture.rawDx,
      leftAction,
      rightAction,
      dragConfig: cfg,
    });

    if (decision.decision === "commit") {
      void handleCommit(decision, gesture.rawDx);
      return;
    }

    snapBack();
  };

  const onPointerCancel = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.captured) {
      gesture.captureTarget?.releasePointerCapture?.(event.pointerId);
    }
    resetGesture();
    snapBack();
  };

  return (
    <div
      ref={rootRef}
      class={[
        "swipe-card",
        className,
        direction !== "none" ? `swipe-card--${direction}` : "",
        phase !== "idle" ? `swipe-card--${phase}` : "",
        phase === "dragging" ? "swipe-card--dragging" : "",
        isCommitReady ? "swipe-card--commit-ready" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--swipe-progress": String(progress) }}
    >
      <div class={`swipe-card__underlay ${direction !== "none" ? `swipe-card__underlay--${direction}` : ""}`.trim()}>
        {underlayContent || null}
      </div>
      <div
        className="swipe-card__foreground"
        style={{ transform: `translate3d(${offsetPx}px, 0, 0)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={onPointerCancel}
      >
        {children}
      </div>
    </div>
  );
}
