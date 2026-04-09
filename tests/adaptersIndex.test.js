import { describe, expect, it } from "vitest";
import { getAdapterByHost, getAdapterById, listAdapters } from "../src/content/adapters/index";

describe("content adapters index", () => {
  it("keeps known host mapping for built-in providers", () => {
    expect(getAdapterByHost("open.spotify.com")?.id).toBe("spotify");
    expect(getAdapterByHost("music.youtube.com")?.id).toBe("youtube-music");
  });

  it("falls back to web-media adapter for unknown hosts", () => {
    const adapter = getAdapterByHost("unknown.example.test");
    expect(adapter?.id).toBe("web-media");
  });

  it("exposes web-media adapter by id and in catalog", () => {
    expect(getAdapterById("web-media")?.id).toBe("web-media");
    expect(listAdapters().some((adapter) => adapter.id === "web-media")).toBe(true);
  });
});
