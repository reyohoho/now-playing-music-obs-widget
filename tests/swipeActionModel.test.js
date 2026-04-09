import { describe, expect, it } from "vitest";
import { computeSwipeProgress, decideSwipeRelease } from "../src/popup/components/swipeActionModel";

describe("swipeActionModel", () => {
  const leftAction = { enabled: true, thresholdPx: 50 };
  const rightActionDisabled = { enabled: false, thresholdPx: 50 };

  it("reverts when distance is below threshold", () => {
    const result = decideSwipeRelease({
      offsetPx: -42,
      leftAction,
      rightAction: rightActionDisabled,
      dragConfig: { thresholdPx: 50 },
    });

    expect(result.decision).toBe("revert");
    expect(result.direction).toBe("left");
    expect(result.isCommitReady).toBe(false);
    expect(result.progress).toBeCloseTo(0.84);
  });

  it("commits left when distance reaches threshold", () => {
    const result = decideSwipeRelease({
      offsetPx: -50,
      leftAction,
      rightAction: rightActionDisabled,
      dragConfig: { thresholdPx: 50 },
    });

    expect(result.decision).toBe("commit");
    expect(result.direction).toBe("left");
    expect(result.isCommitReady).toBe(true);
    expect(result.progress).toBe(1);
  });

  it("never commits right when right action is disabled", () => {
    const result = decideSwipeRelease({
      offsetPx: 120,
      leftAction,
      rightAction: rightActionDisabled,
      dragConfig: { thresholdPx: 50 },
    });

    expect(result.decision).toBe("revert");
    expect(result.direction).toBe("right");
    expect(result.isCommitReady).toBe(false);
    expect(result.progress).toBe(1);
  });

  it("clamps progress for long distances", () => {
    expect(computeSwipeProgress(400, 50)).toBe(1);
    expect(computeSwipeProgress(10, 50)).toBeCloseTo(0.2);
    expect(computeSwipeProgress(-30, 50)).toBe(0);
  });
});

