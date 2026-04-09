import { describe, expect, it } from "vitest";
import { parseChatCommandV2 } from "../src/background/twitch/commandParser";
import { normalizeTwitchControlRouter } from "../src/shared/twitchControlRouter";

function router(overrides = {}) {
  return normalizeTwitchControlRouter({
    trigger: "!ww",
    ...overrides,
  });
}

describe("parseChatCommandV2", () => {
  it("treats trigger-only command as np", () => {
    expect(parseChatCommandV2("!ww", router())).toMatchObject({
      type: "command",
      canonicalCommand: "np",
      action: "announce",
    });
    expect(parseChatCommandV2("!ww   ", router())).toMatchObject({
      type: "command",
      canonicalCommand: "np",
      action: "announce",
    });
  });

  it("parses valid commands with and without space after trigger", () => {
    expect(parseChatCommandV2("!ww pause", router())).toMatchObject({
      type: "command",
      canonicalCommand: "pause",
      action: "pause",
    });
    expect(parseChatCommandV2("!wwpause", router())).toMatchObject({
      type: "command",
      canonicalCommand: "pause",
      action: "pause",
    });
    expect(parseChatCommandV2("!ww pause\u200b", router())).toMatchObject({
      type: "command",
      canonicalCommand: "pause",
      action: "pause",
    });
    expect(parseChatCommandV2("!ww   vol 40", router())).toMatchObject({
      type: "command",
      canonicalCommand: "volume",
      action: "volume",
      value: 0.4,
    });
    expect(parseChatCommandV2("!ww seek 1:23", router())).toMatchObject({
      type: "command",
      canonicalCommand: "seek",
      action: "seek",
      value: 83,
    });
  });

  it("returns invalid for malformed commands after trigger", () => {
    expect(parseChatCommandV2("!ww seek nope", router())).toMatchObject({
      type: "invalid",
      reason: "seek_value",
    });
    expect(parseChatCommandV2("!ww vol 150", router())).toMatchObject({
      type: "invalid",
      reason: "volume_value",
    });
  });

  it("supports custom aliases from command config", () => {
    const config = router({
      commands: {
        pause: { enabled: true, aliases: ["p", "stop"] },
      },
    });

    expect(parseChatCommandV2("!ww p", config)).toMatchObject({
      type: "command",
      canonicalCommand: "pause",
      action: "pause",
    });
  });
});
