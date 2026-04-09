import { describe, expect, it, vi } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";

function makeMedia(overrides = {}) {
  return {
    paused: true,
    ended: false,
    duration: 120,
    currentTime: 10,
    volume: 1,
    muted: false,
    play: vi.fn(async function play() {
      this.paused = false;
    }),
    pause: vi.fn(function pause() {
      this.paused = true;
    }),
    ...overrides,
  };
}

function makeDocument(mediaList = []) {
  const doc = {
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === "audio,video") return mediaList;
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: vi.fn(() => true),
    body: {
      dispatchEvent: vi.fn(() => true),
    },
    documentElement: {
      querySelectorAll() {
        return [];
      },
    },
  };
  return doc;
}

function makeVideoWithSpaceToggle(doc, overrides = {}) {
  const video = {
    tagName: "VIDEO",
    paused: false,
    ended: false,
    duration: 120,
    currentTime: 10,
    volume: 1,
    muted: false,
    focus: vi.fn(() => {
      doc.activeElement = video;
    }),
    dispatchEvent: vi.fn((event) => {
      const type = String(event?.type || "");
      const code = String(event?.code || "");
      if (type === "keydown" && code === "Space") {
        video.paused = !video.paused;
      }
      return true;
    }),
    play: vi.fn(async function play() {
      this.paused = false;
    }),
    pause: vi.fn(function pause() {
      this.paused = true;
    }),
    ...overrides,
  };
  return video;
}

describe("createDomMediaAdapter control hook", () => {
  it("uses source-specific control result when provided", async () => {
    const sourceModule = {
      meta: {
        id: "test",
        label: "Test",
        hosts: ["example.com"],
        controls: {},
        controlCapabilities: {
          toggle: true,
        },
      },
      extract: () => ({ title: "track" }),
      control: {
        execute: vi.fn(async () => ({ ok: true, message: "custom" })),
      },
    };

    const adapter = createDomMediaAdapter(sourceModule);
    const context = { document: makeDocument([makeMedia()]), window: {} };

    const result = await adapter.execute("toggle", undefined, context);
    expect(sourceModule.control.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, message: "custom" });
  });

  it("falls back to generic controls when source-specific returns null", async () => {
    const media = makeMedia({ paused: true });
    const sourceModule = {
      meta: {
        id: "test-fallback",
        label: "Test Fallback",
        hosts: ["example.org"],
        controls: {},
        controlCapabilities: {
          play: true,
        },
        mediaElementFallback: {
          play: true,
        },
      },
      extract: () => ({ title: "track" }),
      control: {
        execute: vi.fn(async () => null),
      },
    };

    const adapter = createDomMediaAdapter(sourceModule);
    const context = { document: makeDocument([media]), window: {} };

    const result = await adapter.execute("play", undefined, context);
    expect(sourceModule.control.execute).toHaveBeenCalledTimes(1);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("uses focused video + Space fallback when pause button is missing", async () => {
    const doc = makeDocument();
    const media = makeVideoWithSpaceToggle(doc, { paused: false });
    doc.querySelectorAll = (selector) => (selector === "audio,video" ? [media] : []);

    const sourceModule = {
      meta: {
        id: "test-video-space-pause",
        label: "Test Video Space Pause",
        hosts: ["example.video"],
        controls: {},
        controlCapabilities: {
          pause: true,
        },
        mediaElementFallback: {
          pause: false,
        },
      },
      extract: () => ({ title: "track" }),
    };

    const adapter = createDomMediaAdapter(sourceModule);
    const result = await adapter.execute("pause", undefined, { document: doc, window: {} });

    expect(result).toMatchObject({ ok: true, path: "video-space-toggle" });
    expect(media.paused).toBe(true);
    expect(media.focus).toHaveBeenCalledTimes(1);
    expect(media.dispatchEvent).toHaveBeenCalled();
  });

  it("uses focused video + Space fallback when play button is missing", async () => {
    const doc = makeDocument();
    const media = makeVideoWithSpaceToggle(doc, { paused: true });
    doc.querySelectorAll = (selector) => (selector === "audio,video" ? [media] : []);

    const sourceModule = {
      meta: {
        id: "test-video-space-play",
        label: "Test Video Space Play",
        hosts: ["example.video"],
        controls: {},
        controlCapabilities: {
          play: true,
        },
        mediaElementFallback: {
          play: false,
        },
      },
      extract: () => ({ title: "track" }),
    };

    const adapter = createDomMediaAdapter(sourceModule);
    const result = await adapter.execute("play", undefined, { document: doc, window: {} });

    expect(result).toMatchObject({ ok: true, path: "video-space-toggle" });
    expect(media.paused).toBe(false);
    expect(media.focus).toHaveBeenCalledTimes(1);
    expect(media.dispatchEvent).toHaveBeenCalled();
  });
});
