import { describe, expect, it } from "vitest";
import { resolveActionBadgeState } from "../src/background/actionBadge";

function makeSettings({
  obsEnabled = false,
  twitchEnabled = false,
  twitchControlEnabled = false,
  twitchAnnounceEnabled = false,
} = {}) {
  return {
    obs: {
      enabled: obsEnabled,
    },
    twitch: {
      enabled: twitchEnabled,
      controlEnabled: twitchControlEnabled,
      announceEnabled: twitchAnnounceEnabled,
    },
  };
}

describe("action badge state", () => {
  it("hides badge when obs/twitch integrations are inactive", () => {
    const state = resolveActionBadgeState({
      settings: makeSettings(),
      obsStatus: { state: "disabled" },
      twitchStatus: { state: "disabled" },
      activeSnapshot: null,
    });

    expect(state.visible).toBe(false);
    expect(state.reason).toBe("inactive");
  });

  it("shows red when active integration is not connected", () => {
    const state = resolveActionBadgeState({
      settings: makeSettings({
        obsEnabled: true,
      }),
      obsStatus: { state: "connecting" },
      twitchStatus: { state: "disabled" },
      activeSnapshot: { title: "Track" },
    });

    expect(state.visible).toBe(true);
    expect(state.reason).toBe("integration_error");
    expect(state.color).toBe("#dc2626");
  });

  it("shows orange when integrations are connected but primary source is missing", () => {
    const state = resolveActionBadgeState({
      settings: makeSettings({
        obsEnabled: true,
      }),
      obsStatus: { state: "connected" },
      twitchStatus: { state: "disabled" },
      activeSnapshot: null,
    });

    expect(state.visible).toBe(true);
    expect(state.reason).toBe("no_primary_source");
    expect(state.color).toBe("#f59e0b");
  });

  it("shows green when integrations are connected and primary source exists", () => {
    const state = resolveActionBadgeState({
      settings: makeSettings({
        obsEnabled: true,
      }),
      obsStatus: { state: "connected" },
      twitchStatus: { state: "disabled" },
      activeSnapshot: { title: "Track" },
    });

    expect(state.visible).toBe(true);
    expect(state.reason).toBe("ok");
    expect(state.color).toBe("#16a34a");
  });

  it("treats twitch as active only when enabled and at least one mode is active", () => {
    const inactiveTwitch = resolveActionBadgeState({
      settings: makeSettings({
        twitchEnabled: true,
        twitchControlEnabled: false,
        twitchAnnounceEnabled: false,
      }),
      obsStatus: { state: "disabled" },
      twitchStatus: { state: "connected" },
      activeSnapshot: { title: "Track" },
    });
    expect(inactiveTwitch.visible).toBe(false);

    const activeTwitch = resolveActionBadgeState({
      settings: makeSettings({
        twitchEnabled: true,
        twitchControlEnabled: true,
        twitchAnnounceEnabled: false,
      }),
      obsStatus: { state: "disabled" },
      twitchStatus: { state: "connected" },
      activeSnapshot: { title: "Track" },
    });
    expect(activeTwitch.visible).toBe(true);
    expect(activeTwitch.color).toBe("#16a34a");
  });
});

