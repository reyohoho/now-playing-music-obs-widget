import { describe, expect, it } from "vitest";
import {
  createSessionMachineState,
  reduceSessionMachine,
} from "../src/core/sessionMachine";

function session(sourceId, tabId, updatedAt, playbackState) {
  return {
    key: `${tabId}:${sourceId}`,
    tabId,
    snapshot: {
      sourceId,
      updatedAt,
      playbackState,
      isPlaying: playbackState === "playing",
      title: sourceId,
    },
  };
}

function ctx(sessions, sourceOrder = ["spotify", "youtube"]) {
  return {
    sessions,
    settings: {
      sourceOrder,
      sourceEnabledMap: { spotify: true, youtube: true },
    },
  };
}

describe("sessionMachine", () => {
  it("keeps same session when playing becomes paused", () => {
    const initial = reduceSessionMachine(
      createSessionMachineState(),
      { type: "SESSION_UPSERT" },
      ctx([session("spotify", 1, 1000, "playing")])
    );

    const next = reduceSessionMachine(
      initial,
      { type: "SESSION_UPSERT" },
      ctx([session("spotify", 1, 1200, "paused")])
    );

    expect(next.activeSessionId).toBe("1:spotify");
    expect(next.controlTargetSessionId).toBe("1:spotify");
    expect(next.mode).toBe("ACTIVE_PAUSED");
  });

  it("switches to higher-priority playing session while active is paused", () => {
    const pausedState = reduceSessionMachine(
      createSessionMachineState(),
      { type: "SESSION_UPSERT" },
      ctx([session("youtube", 2, 1000, "paused")], ["spotify", "youtube"])
    );

    const switched = reduceSessionMachine(
      pausedState,
      { type: "SESSION_UPSERT" },
      ctx(
        [session("youtube", 2, 1000, "paused"), session("spotify", 1, 1300, "playing")],
        ["spotify", "youtube"]
      )
    );

    expect(switched.activeSessionId).toBe("1:spotify");
    expect(switched.mode).toBe("ACTIVE_PLAYING");
  });

  it("falls back to paused/ended candidate after SESSION_REMOVE of active", () => {
    const playing = session("spotify", 1, 1200, "playing");
    const paused = session("youtube", 2, 1100, "paused");

    const state = reduceSessionMachine(
      createSessionMachineState(),
      { type: "SESSION_UPSERT" },
      ctx([playing, paused])
    );

    const afterRemove = reduceSessionMachine(
      state,
      { type: "SESSION_REMOVE" },
      ctx([paused])
    );

    expect(afterRemove.activeSessionId).toBe("2:youtube");
    expect(afterRemove.mode).toBe("ACTIVE_PAUSED");
  });

  it("moves to EMPTY when TAB_REMOVE removes last session", () => {
    const state = reduceSessionMachine(
      createSessionMachineState(),
      { type: "SESSION_UPSERT" },
      ctx([session("spotify", 1, 1000, "playing")])
    );

    const empty = reduceSessionMachine(state, { type: "TAB_REMOVE" }, ctx([]));
    expect(empty.mode).toBe("EMPTY");
    expect(empty.activeSessionId).toBeNull();
    expect(empty.controlTargetSessionId).toBeNull();
  });
});
