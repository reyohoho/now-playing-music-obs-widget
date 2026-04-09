import { describe, expect, it } from "vitest";
import {
  inferYandexPlaybackStateFromActionLabel,
  inferYandexTimesFromText,
} from "../src/content/extractors";

describe("inferYandexPlaybackStateFromActionLabel", () => {
  it("maps pause action label to playing state", () => {
    expect(inferYandexPlaybackStateFromActionLabel("Пауза")).toBe("playing");
    expect(inferYandexPlaybackStateFromActionLabel("Pause")).toBe("playing");
  });

  it("maps play action label to paused state", () => {
    expect(inferYandexPlaybackStateFromActionLabel("Слушать")).toBe("paused");
    expect(inferYandexPlaybackStateFromActionLabel("Воспроизведение")).toBe("paused");
    expect(inferYandexPlaybackStateFromActionLabel("Play")).toBe("paused");
  });

  it("returns empty state for unrelated labels", () => {
    expect(inferYandexPlaybackStateFromActionLabel("Следующий трек")).toBe("");
    expect(inferYandexPlaybackStateFromActionLabel("Повторять воспроизведение")).toBe("");
    expect(inferYandexPlaybackStateFromActionLabel("")).toBe("");
  });
});

describe("inferYandexTimesFromText", () => {
  it("parses elapsed + remaining timer format", () => {
    expect(inferYandexTimesFromText("1:10 -2:50")).toEqual({
      positionSec: 70,
      durationSec: 240,
    });
  });

  it("parses two positive timestamps", () => {
    expect(inferYandexTimesFromText("00:45 / 03:20")).toEqual({
      positionSec: 45,
      durationSec: 200,
    });
  });
});
