import { describe, expect, it, vi } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import youtubeModule from "../src/sources/providers/youtube/module";
import youtubeMusicModule from "../src/sources/providers/youtube-music/module";

function makeDocument() {
  return {
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    documentElement: {
      querySelectorAll() {
        return [];
      },
    },
  };
}

describe("strict control core", () => {
  it("disables next/previous for unsupported sources", () => {
    const youtubeAdapter = createDomMediaAdapter(youtubeModule);
    const ytmAdapter = createDomMediaAdapter(youtubeMusicModule);

    expect(youtubeAdapter.supportsControls("next")).toBe(false);
    expect(youtubeAdapter.supportsControls("previous")).toBe(false);
    expect(ytmAdapter.supportsControls("next")).toBe(true);
    expect(ytmAdapter.supportsControls("previous")).toBe(true);
  });

  it("returns deterministic unsupported for next without capability", async () => {
    const adapter = createDomMediaAdapter({
      meta: {
        id: "demo",
        label: "Demo",
        hosts: ["example.com"],
        controlCapabilities: {
          next: false,
        },
      },
      extract: () => ({ title: "Track" }),
    });

    const result = await adapter.execute("next", undefined, {
      document: makeDocument(),
      window: {},
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported",
      unsupportedReason: "capability-missing",
    });
  });

  it("executes next only via source-specific handler", async () => {
    const control = {
      execute: vi.fn(async (action) => {
        if (action === "next") return null;
        return { ok: false };
      }),
    };
    const adapter = createDomMediaAdapter({
      meta: {
        id: "demo-next",
        label: "Demo next",
        hosts: ["example.com"],
        controls: {
          next: ".next-button",
        },
        controlCapabilities: {
          next: true,
        },
      },
      extract: () => ({ title: "Track" }),
      control,
    });

    const result = await adapter.execute("next", undefined, {
      document: makeDocument(),
      window: {},
    });

    expect(control.execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported",
      unsupportedReason: "source-specific-required",
    });
  });
});
