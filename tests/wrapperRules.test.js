import { describe, expect, test } from "vitest";
import {
  findMatchingWrapperRule,
  getWrapperControlSelector,
  makeBuiltInWrapperRuleId,
  normalizeWrapperRules,
  WRAPPER_CONTROL_EDITOR_ACTIONS,
} from "../src/shared/wrapperRules";

describe("wrapperRules selector resolution", () => {
  test("editor actions expose explicit play/pause and mute/unmute fields", () => {
    expect(WRAPPER_CONTROL_EDITOR_ACTIONS).toEqual([
      "play",
      "pause",
      "previous",
      "next",
      "mute",
      "unmute",
      "volume",
    ]);
  });

  test("play and pause fall back to toggle selector", () => {
    const rule = {
      controlSelectors: {
        toggle: ".player-toggle",
      },
    };
    expect(getWrapperControlSelector(rule, "play")).toBe(".player-toggle");
    expect(getWrapperControlSelector(rule, "pause")).toBe(".player-toggle");
  });

  test("mute and unmute fall back to muteToggle selector", () => {
    const rule = {
      controlSelectors: {
        muteToggle: ".player-mute",
      },
    };
    expect(getWrapperControlSelector(rule, "mute")).toBe(".player-mute");
    expect(getWrapperControlSelector(rule, "unmute")).toBe(".player-mute");
  });

  test("keeps single built-in override per source id", () => {
    const normalized = normalizeWrapperRules([
      {
        id: "first",
        builtinSourceId: "youtube",
        host: "music.youtube.com",
        childSourceIds: ["youtube"],
      },
      {
        id: "second",
        builtinSourceId: "youtube",
        host: "www.youtube.com",
        childSourceIds: ["youtube"],
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe(makeBuiltInWrapperRuleId("youtube"));
    expect(normalized[0].host).toContain("www.youtube.com");
  });

  test("matches built-in override by builtinSourceId", () => {
    const match = findMatchingWrapperRule({
      sourceId: "youtube",
      url: "https://music.youtube.com/watch?v=1",
      wrapperRules: [
        {
          id: "x",
          builtinSourceId: "youtube",
          enabled: true,
          host: "*.youtube.com",
          pathRegex: "",
          childSourceIds: ["spotify"],
        },
      ],
    });
    expect(match?.rule?.builtinSourceId).toBe("youtube");

    const noMatch = findMatchingWrapperRule({
      sourceId: "spotify",
      url: "https://music.youtube.com/watch?v=1",
      wrapperRules: [
        {
          id: "x",
          builtinSourceId: "youtube",
          enabled: true,
          host: "*.youtube.com",
          pathRegex: "",
          childSourceIds: ["spotify"],
        },
      ],
    });
    expect(noMatch).toBeNull();
  });
});
