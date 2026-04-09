import { describe, expect, it } from "vitest";
import { getControlDispatchTarget } from "../src/background/controlDispatch";
import {
  createSessionMachineState,
  reduceSessionMachine,
} from "../src/core/sessionMachine";
import { SourceRegistry } from "../src/core/sourceRegistry";

function settings() {
  return {
    sourceOrder: ["spotify", "youtube"],
    sourceEnabledMap: { spotify: true, youtube: true },
  };
}

function snapshot(sourceId, playbackState, updatedAt) {
  return {
    sourceId,
    sourceLabel: sourceId,
    title: "Track",
    artist: "Artist",
    durationSec: 100,
    positionSec: 10,
    progress: 10,
    playbackState,
    isPlaying: playbackState === "playing",
    updatedAt,
  };
}

describe("background control dispatch smoke", () => {
  it("keeps control target after playing -> paused transition", () => {
    const registry = new SourceRegistry();

    registry.upsert({
      tabId: 123,
      tabTitle: "Spotify",
      url: "https://open.spotify.com/",
      snapshot: snapshot("spotify", "playing", 1000),
    });

    let state = reduceSessionMachine(
      createSessionMachineState(),
      { type: "SESSION_UPSERT" },
      { sessions: registry.values(), settings: settings() }
    );

    registry.upsert({
      tabId: 123,
      tabTitle: "Spotify",
      url: "https://open.spotify.com/",
      snapshot: snapshot("spotify", "paused", 1200),
    });

    state = reduceSessionMachine(state, { type: "SESSION_UPSERT" }, {
      sessions: registry.values(),
      settings: settings(),
    });

    const target = getControlDispatchTarget(state, registry);
    expect(target?.tabId).toBe(123);
    expect(target?.sourceId).toBe("spotify");
    expect(target?.snapshot.playbackState).toBe("paused");
  });
});
