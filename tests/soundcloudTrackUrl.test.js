import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import soundcloudModule from "../src/sources/providers/soundcloud/module";

function makeNode(attrs = {}, text = "") {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attrs[name] || "";
    },
  };
}

function makeDocument({ playerLink = "", canonicalHref = "", ogUrl = "" } = {}) {
  const playerNode = makeNode({ href: playerLink });
  const canonicalNode = makeNode({ href: canonicalHref });
  const ogNode = makeNode({ content: ogUrl });

  return {
    querySelector(selector) {
      const normalized = String(selector || "");
      if (normalized === 'link[rel="canonical"]') return canonicalHref ? canonicalNode : null;
      if (normalized === 'meta[property="og:url"]') return ogUrl ? ogNode : null;
      return null;
    },
    querySelectorAll(selector) {
      const normalized = String(selector || "");
      if (normalized === "audio,video") return [];
      if (playerLink && normalized.includes("soundcloud.com/")) return [playerNode];
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

function makeWindow(href) {
  const url = new URL(href);
  return {
    location: {
      href: url.toString(),
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
    },
    navigator: {
      mediaSession: {
        metadata: {
          title: "SC Title",
          artist: "SC Artist",
          artwork: [{ src: "https://example.com/sc.jpg" }],
        },
        playbackState: "playing",
      },
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

describe("SoundCloud trackUrl extraction", () => {
  it("builds canonical trackUrl from player link", () => {
    const fakeDocument = makeDocument({
      playerLink: "https://soundcloud.com/artist-name/track-name?utm_source=widget#comments",
    });
    const fakeWindow = makeWindow("https://soundcloud.com/stream");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(soundcloudModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://soundcloud.com/artist-name/track-name");
  });

  it("builds canonical trackUrl from location fallback", () => {
    const fakeDocument = makeDocument();
    const fakeWindow = makeWindow("https://soundcloud.com/artist-2/track-2?si=abc123#t=1:04");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(soundcloudModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://soundcloud.com/artist-2/track-2");
  });
});
