import { describe, expect, it } from "vitest";
import { __selectorControlInternals } from "../src/sources/shared/selectorControl";

describe("selectorControl shadow selector resolution", () => {
  it("splits shadow chain selector", () => {
    expect(__selectorControlInternals.splitShadowSelector("host >>> .button >>> .icon")).toEqual([
      "host",
      ".button",
      ".icon",
    ]);
    expect(__selectorControlInternals.splitShadowSelector(".plain-selector")).toEqual([]);
  });

  it("resolves nodes through host shadow roots", () => {
    const playButton = { id: "play" };
    const hostShadowRoot = {
      querySelectorAll(selector) {
        if (selector === ".play-btn") return [playButton];
        return [];
      },
    };
    const hostElement = {
      shadowRoot: hostShadowRoot,
    };
    const doc = {
      querySelectorAll(selector) {
        if (selector === "music-player") return [hostElement];
        return [];
      },
    };

    const nodes = __selectorControlInternals.resolveSelectorNodes("music-player >>> .play-btn", doc);
    expect(nodes).toEqual([playButton]);
  });

  it("continues chain in light dom when shadowRoot is absent", () => {
    const target = { id: "target" };
    const container = {
      querySelectorAll(selector) {
        if (selector === ".target") return [target];
        return [];
      },
    };
    const doc = {
      querySelectorAll(selector) {
        if (selector === ".container") return [container];
        return [];
      },
    };

    const nodes = __selectorControlInternals.resolveSelectorNodes(".container >>> .target", doc);
    expect(nodes).toEqual([target]);
  });
});
