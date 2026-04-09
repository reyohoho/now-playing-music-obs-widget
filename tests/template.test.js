import { describe, expect, it } from "vitest";
import { renderTrackTemplate } from "../src/core/template";

describe("renderTrackTemplate", () => {
  it("renders known placeholders", () => {
    const line = renderTrackTemplate(
      "{{artist}} - {{title}} ({{position}}/{{duration}}) {{progress}}",
      {
        artist: "Artist",
        title: "Track",
        positionSec: 30,
        durationSec: 120,
        progress: 25,
      }
    );

    expect(line).toContain("Artist - Track");
    expect(line).toContain("00:30/02:00");
    expect(line).toContain("25%");
  });

  it("renders track link placeholders", () => {
    const line = renderTrackTemplate("{{title}} {{link}} {{trackUrl}}", {
      title: "Track",
      trackUrl: "https://example.com/track/123",
    });

    expect(line).toContain("Track");
    expect(line).toContain("https://example.com/track/123");
  });
});
