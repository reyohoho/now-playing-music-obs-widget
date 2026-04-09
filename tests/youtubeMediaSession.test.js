import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import youtubeModule from "../src/sources/providers/youtube/module";

function makeDocument(title = "") {
  return {
    title,
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "audio,video") return [];
      return [];
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

function makeWindow(mediaSession = null) {
  return {
    navigator: {
      mediaSession,
    },
    ytInitialPlayerResponse: null,
    ytplayer: null,
    getComputedStyle() {
      return {
        display: "block",
        visibility: "visible",
      };
    },
  };
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.location = originalLocation;
});

describe("YouTube media-session-first snapshot", () => {
  it("uses media session metadata and playback state when available", () => {
    const mediaSession = {
      metadata: {
        title: "MS Title",
        artist: "MS Artist",
        artwork: [{ src: "https://example.com/ms-yt.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeDocument = makeDocument("Fallback - YouTube");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/watch",
      search: "?v=abc123",
      hostname: "www.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.title).toBe("MS Title");
    expect(snapshot.artist).toBe("MS Artist");
    expect(snapshot.coverUrl).toBe("https://example.com/ms-yt.jpg");
    expect(snapshot.trackUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(snapshot.playbackState).toBe("playing");
  });

  it("builds trackUrl from embed location when running in youtube embed", () => {
    const mediaSession = {
      metadata: {
        title: "MS Title",
        artist: "MS Artist",
        artwork: [{ src: "https://example.com/ms-yt.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeMedia = {
      paused: false,
      ended: false,
      currentTime: 12,
      duration: 240,
      volume: 0.8,
      muted: false,
      poster: "",
    };
    const fakeDocument = {
      ...makeDocument("Fallback - YouTube"),
      querySelector(selector) {
        if (String(selector || "").includes("video")) return fakeMedia;
        return null;
      },
      querySelectorAll(selector) {
        const normalized = String(selector || "");
        if (normalized.includes("video")) return [fakeMedia];
        if (normalized === "audio,video") return [fakeMedia];
        return [];
      },
    };

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/embed/xyz987",
      search: "?list=PL123",
      hostname: "www.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://www.youtube.com/watch?v=xyz987&list=PL123");
  });

  it("builds trackUrl from bridge snapshot when embed url has no video id", () => {
    const mediaSession = {
      metadata: {
        title: "MS Title",
        artist: "MS Artist",
        artwork: [{ src: "https://example.com/ms-yt.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeMedia = {
      paused: false,
      ended: false,
      currentTime: 12,
      duration: 240,
      volume: 0.8,
      muted: false,
      poster: "",
    };
    const fakeDocument = {
      ...makeDocument("Fallback - YouTube"),
      querySelector(selector) {
        if (String(selector || "").includes("video")) return fakeMedia;
        return null;
      },
      querySelectorAll(selector) {
        const normalized = String(selector || "");
        if (normalized.includes("video")) return [fakeMedia];
        if (normalized === "audio,video") return [fakeMedia];
        return [];
      },
    };

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/embed/",
      search: "?list=PL123",
      hostname: "www.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
      youtubeBridgeSnapshot: {
        videoId: "bridge123",
        listId: "PL123",
      },
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://www.youtube.com/watch?v=bridge123&list=PL123");
  });

  it("builds trackUrl from title link when embed location has no video id", () => {
    const mediaSession = {
      metadata: {
        title: "MS Title",
        artist: "MS Artist",
        artwork: [{ src: "https://example.com/ms-yt.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeMedia = {
      paused: false,
      ended: false,
      currentTime: 12,
      duration: 240,
      volume: 0.8,
      muted: false,
      poster: "",
    };
    const fakeLink = {
      getAttribute(name) {
        if (name === "href") return "https://www.youtube.com/watch?v=fromlink123&list=PLLINK";
        return "";
      },
    };
    const fakeDocument = {
      ...makeDocument("Fallback - YouTube"),
      querySelector(selector) {
        if (String(selector || "").includes("video")) return fakeMedia;
        return null;
      },
      querySelectorAll(selector) {
        const normalized = String(selector || "");
        if (normalized.includes("video")) return [fakeMedia];
        if (normalized === "audio,video") return [fakeMedia];
        if (normalized.includes("a")) return [fakeLink];
        return [];
      },
    };

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/embed/",
      search: "",
      hostname: "www.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://www.youtube.com/watch?v=fromlink123&list=PLLINK");
  });

  it("does not use legacy metadata when media session metadata is empty", () => {
    const mediaSession = {
      metadata: {
        title: "",
        artist: "",
        artwork: [],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeDocument = makeDocument("Fallback YouTube Track - YouTube");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/watch",
      search: "?v=abc123",
      hostname: "www.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeNull();
  });
});
