import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import vkModule from "../src/sources/providers/vk/module";

function makeDocument({ links = [] } = {}) {
  return {
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      const normalized = String(selector || "");
      if (normalized === "audio,video") return [];
      if (normalized.includes('a[href*="audio"]') && links.length) {
        return links.map((href) => ({
          getAttribute(name) {
            return name === "href" ? href : "";
          },
        }));
      }
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

function makeVkPlayer(overrides = {}) {
  const currentData = overrides.currentData || {};
  const currentTuple = overrides.currentTuple || [];

  return {
    getCurrentAudioData() {
      return currentData;
    },
    getCurrentAudio() {
      return currentTuple;
    },
    getCurrentDuration() {
      return Number.NaN;
    },
    getCurrentProgressTime() {
      return Number.NaN;
    },
    getCurrentProgress() {
      return Number.NaN;
    },
    getVolume() {
      return 0.4;
    },
    getMuted() {
      return false;
    },
    isPlaying() {
      return true;
    },
    isPaused() {
      return false;
    },
  };
}

function makeWindow(href, ap) {
  const url = new URL(href);
  return {
    ap,
    location: {
      href: url.toString(),
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
    },
    navigator: {
      mediaSession: null,
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

describe("VK trackUrl extraction", () => {
  it("builds canonical trackUrl from VK audio ids", () => {
    const ap = makeVkPlayer({
      currentData: {
        title: "VK Track",
        author: { raw: "VK Artist" },
        owner_id: -200,
        id: 999,
      },
      currentTuple: [999, -200, "", "VK Track", "VK Artist"],
    });
    const fakeWindow = makeWindow("https://vk.com/music", ap);
    const fakeDocument = makeDocument();

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(vkModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://vk.com/audio-200_999");
  });

  it("builds canonical trackUrl from location z parameter", () => {
    const ap = makeVkPlayer({
      currentData: {
        title: "VK Track",
        author: { raw: "VK Artist" },
      },
      currentTuple: [null, null, "", "VK Track", "VK Artist"],
    });
    const fakeWindow = makeWindow(
      "https://vk.com/audio?z=audio-77_88%2Fpl_-77_1",
      ap
    );
    const fakeDocument = makeDocument();

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(vkModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://vk.com/audio-77_88");
  });

  it("builds canonical trackUrl from DOM audio link", () => {
    const ap = makeVkPlayer({
      currentData: {
        title: "VK Track",
        author: { raw: "VK Artist" },
      },
      currentTuple: [null, null, "", "VK Track", "VK Artist"],
    });
    const fakeWindow = makeWindow("https://vk.com/music", ap);
    const fakeDocument = makeDocument({
      links: ["/audio?z=audio-123_456%2Fplaylist"],
    });

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const adapter = createDomMediaAdapter(vkModule);
    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://vk.com/audio-123_456");
  });
});
