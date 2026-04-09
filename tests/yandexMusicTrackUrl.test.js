import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import yandexMusicModule, {
  inferYandexMuteStateFromControlLabel,
} from "../src/sources/providers/yandex-music/module";

function makeNode(text = "", attrs = {}) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attrs[name] || "";
    },
  };
}

function makeBar({ title = "Track", artist = "Artist", linkHref = "" } = {}) {
  const titleNode = makeNode(title);
  const artistNode = makeNode(artist);
  const linkNode = makeNode("", { href: linkHref });

  return {
    innerText: `${title} ${artist}`,
    textContent: `${title} ${artist}`,
    querySelector(selector) {
      if (String(selector || "").includes("Meta_title__")) return titleNode;
      if (String(selector || "").includes("Meta_artists__")) return artistNode;
      return null;
    },
    querySelectorAll(selector) {
      const normalized = String(selector || "");
      if (normalized === 'a[href*="/track/"]' && linkHref) return [linkNode];
      return [];
    },
  };
}

function makeDocument({ bar, canonicalHref = "", ogUrl = "" } = {}) {
  const canonicalNode = makeNode("", { href: canonicalHref });
  const ogNode = makeNode("", { content: ogUrl });

  return {
    querySelector(selector) {
      const normalized = String(selector || "");
      if (normalized.includes("PlayerBarDesktop") || normalized.includes("PlayerBar_root") || normalized.includes("PlayerBar")) {
        return bar || null;
      }
      if (normalized === 'link[rel="canonical"]') return canonicalHref ? canonicalNode : null;
      if (normalized === 'meta[property="og:url"]') return ogUrl ? ogNode : null;
      return null;
    },
    querySelectorAll(selector) {
      if (String(selector || "") === "audio,video") return [];
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

function makeWindow(href, mediaSession = null) {
  return {
    location: {
      href,
      hostname: new URL(href).hostname,
      pathname: new URL(href).pathname,
      search: new URL(href).search,
    },
    navigator: {
      mediaSession,
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

describe("Yandex Music trackUrl extraction", () => {
  it("builds canonical trackUrl from player bar link", () => {
    const bar = makeBar({
      title: "Track",
      artist: "Artist",
      linkHref: "/album/123/track/456?utm_source=dashboard#seo-fragment",
    });
    const fakeDocument = makeDocument({ bar });
    const fakeWindow = makeWindow("https://music.yandex.ru/home");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(yandexMusicModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://music.yandex.ru/album/123/track/456");
  });

  it("builds canonical trackUrl from current page url", () => {
    const bar = makeBar({ title: "Track", artist: "Artist", linkHref: "" });
    const fakeDocument = makeDocument({ bar });
    const fakeWindow = makeWindow("https://music.yandex.kz/album/77/track/88?from=search#lyrics");

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(yandexMusicModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://music.yandex.kz/album/77/track/88");
  });
});

describe("Yandex Music paused-before-start handling", () => {
  it("keeps prestart paused as idle until playback starts", () => {
    const mediaSession = {
      metadata: {
        title: "Somebody To Love",
        artist: "Mark With A K, Natalia",
        artwork: [],
      },
      playbackState: "paused",
    };
    const bar = makeBar({ title: "Somebody To Love", artist: "Mark With A K, Natalia" });
    const fakeDocument = makeDocument({ bar });
    const fakeWindow = makeWindow("https://music.yandex.ru/", mediaSession);

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(yandexMusicModule);

    const beforePlay = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });
    expect(beforePlay).toBeTruthy();
    expect(beforePlay.playbackState).toBe("idle");

    mediaSession.playbackState = "playing";
    const whilePlaying = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });
    expect(whilePlaying).toBeTruthy();
    expect(whilePlaying.playbackState).toBe("playing");

    mediaSession.playbackState = "paused";
    const pausedAfterStart = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });
    expect(pausedAfterStart).toBeTruthy();
    expect(pausedAfterStart.playbackState).toBe("paused");
  });
});

describe("Yandex Music mute label parsing", () => {
  it("understands current English mute/unmute labels", () => {
    expect(inferYandexMuteStateFromControlLabel("Turn off sound")).toBe(false);
    expect(inferYandexMuteStateFromControlLabel("Turn on sound")).toBe(true);
  });

  it("keeps legacy mute/unmute labels support", () => {
    expect(inferYandexMuteStateFromControlLabel("Выключить звук")).toBe(false);
    expect(inferYandexMuteStateFromControlLabel("Включить звук")).toBe(true);
    expect(inferYandexMuteStateFromControlLabel("Unmute")).toBe(true);
    expect(inferYandexMuteStateFromControlLabel("Mute")).toBe(false);
  });
});
