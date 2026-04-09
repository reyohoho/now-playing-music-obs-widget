import { describe, expect, it } from "vitest";
import { normalizeSnapshot } from "../src/core/normalize";

describe("normalizeSnapshot", () => {
  it("clamps position and computes progress", () => {
    const snapshot = normalizeSnapshot({
      sourceId: "youtube",
      title: "Track",
      durationSec: 120,
      positionSec: 400,
      isPlaying: true,
    });

    expect(snapshot.positionSec).toBe(120);
    expect(snapshot.progress).toBe(100);
    expect(snapshot.playbackState).toBe("playing");
    expect(snapshot.isPlaying).toBe(true);
  });

  it("normalizes invalid values to safe defaults", () => {
    const snapshot = normalizeSnapshot({
      sourceId: "x",
      title: "T",
      durationSec: -12,
      positionSec: Number.NaN,
      volume: 2,
    });

    expect(snapshot.durationSec).toBe(0);
    expect(snapshot.positionSec).toBe(0);
    expect(snapshot.volume).toBe(1);
    expect(snapshot.muted).toBe(false);
    expect(snapshot.playbackState).toBe("paused");
  });

  it("keeps explicit muted state", () => {
    const snapshot = normalizeSnapshot({
      sourceId: "x",
      title: "T",
      volume: 0.8,
      muted: true,
    });

    expect(snapshot.volume).toBe(0.8);
    expect(snapshot.muted).toBe(true);
  });

  it("keeps explicit live flag", () => {
    const snapshot = normalizeSnapshot({
      sourceId: "youtube",
      title: "Live stream",
      isLive: true,
      durationSec: 9999,
      positionSec: 123,
    });

    expect(snapshot.isLive).toBe(true);
  });
});
