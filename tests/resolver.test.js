import { describe, expect, it } from "vitest";
import { buildActiveSessions, buildProviderRows, findWrapperMatchForInstance, resolveActiveSource } from "../src/core/resolver";

function instance(sourceId, updatedAt, playbackState = "playing", tabId = 1, url = "https://example.com/") {
  return {
    key: `${tabId}:0:${sourceId}`,
    tabId,
    frameId: 0,
    url,
    snapshot: {
      sourceId,
      sourceLabel: sourceId,
      updatedAt,
      playbackState,
      isPlaying: playbackState === "playing",
      title: sourceId,
    },
  };
}

function withCapabilities(instanceValue, controlCapabilities) {
  return {
    ...instanceValue,
    snapshot: {
      ...instanceValue.snapshot,
      controlCapabilities: { ...(controlCapabilities || {}) },
    },
  };
}

function withDuration(instanceValue, durationSec) {
  return {
    ...instanceValue,
    snapshot: {
      ...instanceValue.snapshot,
      durationSec,
    },
  };
}

function settings(overrides = {}) {
  return {
    sourceOrder: ["spotify", "youtube"],
    sourceEnabledMap: { spotify: true, youtube: true },
    wrapperRules: [],
    ...overrides,
  };
}

describe("resolveActiveSource", () => {
  it("chooses paused source by sourceOrder when no playing exists", () => {
    const active = resolveActiveSource(
      [instance("youtube", 2000, "paused"), instance("spotify", 1000, "paused")],
      settings()
    );

    expect(active?.snapshot.sourceId).toBe("spotify");
    expect(active?.snapshot.playbackState).toBe("paused");
  });

  it("skips disabled source even if it is playing", () => {
    const active = resolveActiveSource(
      [instance("spotify", 3000, "playing"), instance("youtube", 2000, "paused")],
      settings({
        sourceEnabledMap: { spotify: false, youtube: true },
      })
    );

    expect(active?.snapshot.sourceId).toBe("youtube");
  });
});

describe("wrapper rules matcher", () => {
  it("matches host + child source and empty pathRegex as wildcard", () => {
    const match = findWrapperMatchForInstance(
      instance("youtube", 1000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general"),
      settings({
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    expect(match?.rule?.id).toBe("se");
  });

  it("matches comma-separated hosts and wildcard host masks", () => {
    const match = findWrapperMatchForInstance(
      instance("youtube", 1000, "playing", 1, "https://alerts.streamelements.com/dashboard/mediarequest/general"),
      settings({
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com, *.streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    expect(match?.rule?.id).toBe("se");
  });

  it("does not match apex host for wildcard-only host mask", () => {
    const match = findWrapperMatchForInstance(
      instance("youtube", 1000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general"),
      settings({
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "*.streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    expect(match).toBeNull();
  });

  it("does not match invalid regex", () => {
    const match = findWrapperMatchForInstance(
      instance("youtube", 1000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general"),
      settings({
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com",
            pathRegex: "(broken",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    expect(match).toBeNull();
  });

  it("respects first matching rule order", () => {
    const ruleSettings = settings({
      sourceOrder: ["wrapper:first", "wrapper:second", "youtube"],
      sourceEnabledMap: { youtube: true, "wrapper:first": true, "wrapper:second": true },
      wrapperRules: [
        {
          id: "first",
          enabled: true,
          host: "streamelements.com",
          pathRegex: "",
          label: "First",
          childSourceIds: ["youtube"],
        },
        {
          id: "second",
          enabled: true,
          host: "streamelements.com",
          pathRegex: "",
          label: "Second",
          childSourceIds: ["youtube"],
        },
      ],
    });

    const sessions = buildActiveSessions(
      [instance("youtube", 1000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general")],
      ruleSettings
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceId).toBe("wrapper:first");
    expect(sessions[0].sourceLabel).toBe("First");
  });
});

describe("buildActiveSessions", () => {
  it("returns all non-idle sessions sorted by source order and stable session key", () => {
    const sessions = buildActiveSessions(
      [
        instance("youtube", 3000, "paused", 1),
        instance("spotify", 2000, "playing", 2),
        instance("youtube", 1000, "playing", 3),
      ],
      settings()
    );

    expect(sessions.map((x) => x.sessionId)).toEqual(["2:0:spotify", "1:0:youtube", "3:0:youtube"]);
  });

  it("does not map to wrapper when no rules exist", () => {
    const sessions = buildActiveSessions(
      [instance("youtube", 3000, "playing", 1, "https://random-widget.example/path")],
      settings()
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceId).toBe("youtube");
    expect(sessions[0].baseSourceId).toBe("youtube");
  });

  it("adds wrapper selector controls to session capabilities", () => {
    const base = withCapabilities(
      instance("youtube", 3000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general"),
      { next: false, previous: false, toggle: true }
    );

    const sessions = buildActiveSessions(
      [base],
      settings({
        sourceOrder: ["wrapper:se", "youtube"],
        sourceEnabledMap: { youtube: true, "wrapper:se": true },
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
            controlSelectors: {
              next: ".next-btn",
              previous: ".prev-btn",
            },
          },
        ],
      })
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceId).toBe("wrapper:se");
    expect(sessions[0].baseSourceId).toBe("youtube");
    expect(sessions[0].controlCapabilities.next).toBe(true);
    expect(sessions[0].controlCapabilities.previous).toBe(true);
    expect(sessions[0].controlCapabilities.toggle).toBe(true);
  });

  it("keeps built-in source id for built-in override rule", () => {
    const base = withCapabilities(
      instance("youtube", 3000, "playing", 1, "https://music.youtube.com/watch?v=1"),
      { next: false, previous: false, toggle: true }
    );

    const sessions = buildActiveSessions(
      [base],
      settings({
        sourceOrder: ["youtube"],
        sourceEnabledMap: { youtube: true },
        wrapperRules: [
          {
            id: "rule-a",
            builtinSourceId: "youtube",
            enabled: true,
            host: "*.youtube.com",
            pathRegex: "",
            label: "YouTube",
            childSourceIds: ["spotify"],
            controlSelectors: {
              next: ".next-btn",
            },
          },
        ],
      })
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceId).toBe("youtube");
    expect(sessions[0].baseSourceId).toBe("youtube");
    expect(sessions[0].controlCapabilities.next).toBe(true);
  });

  it("filters source sessions by per-source short-duration threshold", () => {
    const sessions = buildActiveSessions(
      [
        withDuration(instance("youtube", 3000, "playing", 1), 20),
        withDuration(instance("spotify", 2000, "playing", 2), 180),
      ],
      settings({
        sourceMinDurationSecMap: {
          youtube: 40,
          spotify: 0,
        },
      })
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceId).toBe("spotify");
  });

  it("applies short-duration threshold to wrapper source id", () => {
    const sessions = buildActiveSessions(
      [
        withDuration(
          instance("youtube", 3000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general"),
          20
        ),
      ],
      settings({
        sourceOrder: ["wrapper:se", "youtube"],
        sourceEnabledMap: { youtube: true, "wrapper:se": true },
        sourceMinDurationSecMap: { "wrapper:se": 40, youtube: 0 },
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    expect(sessions).toHaveLength(0);
  });
});

describe("buildProviderRows", () => {
  it("adds dynamic wrapper row when rule matches", () => {
    const rows = buildProviderRows(
      [instance("youtube", 3000, "playing", 1, "https://streamelements.com/dashboard/mediarequest/general")],
      [{ id: "youtube", label: "YouTube" }],
      settings({
        sourceOrder: ["youtube", "wrapper:se"],
        sourceEnabledMap: { youtube: true, "wrapper:se": true },
        wrapperRules: [
          {
            id: "se",
            enabled: true,
            host: "streamelements.com",
            pathRegex: "",
            label: "StreamElements",
            childSourceIds: ["youtube"],
          },
        ],
      })
    );

    const wrapperRow = rows.find((row) => row.id === "wrapper:se");
    expect(wrapperRow).toBeTruthy();
    expect(wrapperRow?.label).toBe("StreamElements");
    expect(wrapperRow?.isActive).toBe(true);

    const youtubeRow = rows.find((row) => row.id === "youtube");
    expect(youtubeRow?.isActive).toBe(false);
  });

  it("includes bulk mute ignore flag per source", () => {
    const rows = buildProviderRows(
      [instance("youtube", 3000, "paused", 1, "https://music.youtube.com/watch?v=1")],
      [{ id: "youtube", label: "YouTube" }],
      settings({
        sourceBulkMuteIgnoreMap: { youtube: true },
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("youtube");
    expect(rows[0].ignoreBulkMute).toBe(true);
  });
});
