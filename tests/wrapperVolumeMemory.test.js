import { describe, expect, it } from "vitest";
import {
  normalizeWrapperVolumeByHost,
  normalizeVolumeValue,
  rememberWrapperVolumeByHost,
  resolveVolumeForControlAction,
} from "../src/background/wrapperVolumeMemory";

describe("wrapperVolumeMemory", () => {
  it("normalizes and clamps host volume map", () => {
    const normalized = normalizeWrapperVolumeByHost({
      "StreamElements.com": 1.4,
      "": 0.5,
      "moo.bot": "0.25",
      "invalid": "x",
    });

    expect(normalized).toEqual({
      "streamelements.com": 1,
      "moo.bot": 0.25,
    });
  });

  it("remembers volume by host and ignores same value writes", () => {
    const first = rememberWrapperVolumeByHost({}, "streamelements.com", 0.42);
    expect(first.changed).toBe(true);
    expect(first.map["streamelements.com"]).toBe(0.42);

    const second = rememberWrapperVolumeByHost(first.map, "streamelements.com", 0.42);
    expect(second.changed).toBe(false);
    expect(second.map).toEqual(first.map);
  });

  it("resolves control action volume values", () => {
    expect(resolveVolumeForControlAction("volume", 0.3, {}, 0.9)).toBe(0.3);
    expect(resolveVolumeForControlAction("mute", undefined, {}, 0.9)).toBe(0);
    expect(resolveVolumeForControlAction("unmute", undefined, { volume: 0.6 }, 0.2)).toBe(0.6);
    expect(resolveVolumeForControlAction("unmute", undefined, { volume: 0 }, 0.2)).toBe(0.2);
    expect(resolveVolumeForControlAction("unknown", undefined, {}, 0.2)).toSatisfy(Number.isNaN);
  });

  it("clamps normalizeVolumeValue", () => {
    expect(normalizeVolumeValue(-1)).toBe(0);
    expect(normalizeVolumeValue(2)).toBe(1);
    expect(normalizeVolumeValue("0.5")).toBe(0.5);
  });
});
