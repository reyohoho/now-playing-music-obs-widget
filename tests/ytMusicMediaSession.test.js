import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import youtubeMusicModule from "../src/sources/providers/youtube-music/module";

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
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
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

describe("YouTube Music media-session-first snapshot", () => {
  it("uses media session metadata and playback state when available", () => {
    const mediaSession = {
      metadata: {
        title: "MS Title",
        artist: "MS Artist",
        artwork: [{ src: "https://example.com/ms.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeDocument = makeDocument("");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/watch",
      search: "?v=ytm123",
      hostname: "music.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeMusicModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.title).toBe("MS Title");
    expect(snapshot.artist).toBe("MS Artist");
    expect(snapshot.coverUrl).toBe("https://example.com/ms.jpg");
    expect(snapshot.trackUrl).toBe("https://music.youtube.com/watch?v=ytm123");
    expect(snapshot.playbackState).toBe("playing");
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
    const fakeDocument = makeDocument("Fallback Track - YouTube Music");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;

    const adapter = createDomMediaAdapter(youtubeMusicModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeNull();
  });

  it("keeps previous metadata during short media-session metadata gaps", () => {
    const mediaSession = {
      metadata: {
        title: "First Track",
        artist: "First Artist",
        artwork: [{ src: "https://example.com/first.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeDocument = makeDocument("");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/watch",
      search: "?v=ytm456",
      hostname: "music.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeMusicModule);
    const firstSnapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(firstSnapshot).toBeTruthy();
    expect(firstSnapshot.title).toBe("First Track");
    expect(firstSnapshot.artist).toBe("First Artist");

    mediaSession.metadata = {
      title: "",
      artist: "",
      artwork: [],
    };
    mediaSession.playbackState = "playing";

    const secondSnapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(secondSnapshot).toBeTruthy();
    expect(secondSnapshot.title).toBe("First Track");
    expect(secondSnapshot.artist).toBe("First Artist");
    expect(secondSnapshot.coverUrl).toBe("https://example.com/first.jpg");
    expect(secondSnapshot.trackUrl).toBe("https://music.youtube.com/watch?v=ytm456");
  });

  it("keeps previous metadata for a short idle gap", () => {
    const mediaSession = {
      metadata: {
        title: "Idle Gap Track",
        artist: "Idle Gap Artist",
        artwork: [{ src: "https://example.com/idle-gap.jpg" }],
      },
      playbackState: "playing",
    };
    const fakeWindow = makeWindow(mediaSession);
    const fakeDocument = makeDocument("");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = {
      pathname: "/watch",
      search: "?v=ytm789",
      hostname: "music.youtube.com",
    };

    const adapter = createDomMediaAdapter(youtubeMusicModule);
    const firstSnapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(firstSnapshot).toBeTruthy();
    expect(firstSnapshot.title).toBe("Idle Gap Track");

    mediaSession.metadata = {
      title: "",
      artist: "",
      artwork: [],
    };
    mediaSession.playbackState = "";

    const secondSnapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(secondSnapshot).toBeTruthy();
    expect(secondSnapshot.playbackState).toBe("idle");
    expect(secondSnapshot.title).toBe("Idle Gap Track");
    expect(secondSnapshot.artist).toBe("Idle Gap Artist");
  });
});
