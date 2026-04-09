import { describe, expect, it } from "vitest";
import {
  buildObsBrowserEventPayload,
  buildObsTextPayload,
} from "../src/background/obsPayload";

describe("OBS payload builders", () => {
  it("builds SetInputSettings payload", () => {
    const payload = buildObsTextPayload("NowPlaying", "Artist - Track");
    expect(payload).toEqual({
      inputName: "NowPlaying",
      inputSettings: { text: "Artist - Track" },
      overlay: true,
    });
  });

  it("builds obs-browser vendor payload", () => {
    const payload = buildObsBrowserEventPayload(
      "nowplaying:update",
      {
        title: "Track",
        artist: "Artist",
        durationSec: 120,
        positionSec: 15,
        progress: 12.5,
        sourceId: "spotify",
        isPlaying: true,
      },
      { customCss: ".widget{color:red;}" }
    );

    expect(payload.vendorName).toBe("obs-browser");
    expect(payload.requestType).toBe("emit_event");
    expect(payload.requestData.event_name).toBe("nowplaying:update");
    expect(payload.requestData.event_data.title).toBe("Track");
    expect(payload.requestData.event_data.artist).toBe("Artist");
    expect(payload.requestData.event_data.sourceId).toBe("spotify");
    expect(payload.requestData.event_data.isPlaying).toBe(true);
    expect(payload.requestData.event_data.customCss).toBe(".widget{color:red;}");
  });

  it("includes track link aliases in obs-browser payload", () => {
    const payload = buildObsBrowserEventPayload("nowplaying:update", {
      title: "Track",
      artist: "Artist",
      trackUrl: "https://example.com/track/abc",
    });

    expect(payload.requestData.event_data.link).toBe("https://example.com/track/abc");
    expect(payload.requestData.event_data.trackUrl).toBe("https://example.com/track/abc");
  });
});
