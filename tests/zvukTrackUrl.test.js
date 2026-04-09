import { afterEach, describe, expect, it } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import zvukModule from "../src/sources/providers/zvuk/module";

function makeNode(attrs = {}, text = "") {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attrs[name] || "";
    },
  };
}

function makeDocument({ links = [], canonicalHref = "", ogUrl = "" } = {}) {
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
      if (normalized.includes("/track/") && links.length) {
        return links.map((href) => makeNode({ href }));
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

function makeBridge(snapshot) {
  return {
    requestSnapshot() {},
    getSnapshot() {
      return snapshot;
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

describe("Zvuk trackUrl extraction", () => {
  it("builds canonical trackUrl from bridge snapshot url", () => {
    const fakeWindow = makeWindow("https://zvuk.com/");
    const fakeDocument = makeDocument();
    const adapter = createDomMediaAdapter(zvukModule);
    const bridge = makeBridge({
      title: "Zvuk Track",
      artist: "Zvuk Artist",
      trackUrl: "/track/777?utm_source=test#seo",
    });

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      zvukBridge: bridge,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://zvuk.com/track/777");
  });

  it("builds canonical trackUrl from bridge snapshot track id", () => {
    const fakeWindow = makeWindow("https://zvuk.com/");
    const fakeDocument = makeDocument();
    const adapter = createDomMediaAdapter(zvukModule);
    const bridge = makeBridge({
      title: "Zvuk Track",
      artist: "Zvuk Artist",
      track: {
        id: 9988,
      },
    });

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      zvukBridge: bridge,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://zvuk.com/track/9988");
  });

  it("builds canonical trackUrl from location fallback", () => {
    const fakeWindow = makeWindow("https://zvuk.com/release/42?trackId=31415#seo-junk");
    const fakeDocument = makeDocument();
    const adapter = createDomMediaAdapter(zvukModule);
    const bridge = makeBridge({
      title: "Zvuk Track",
      artist: "Zvuk Artist",
    });

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.location = fakeWindow.location;

    const snapshot = adapter.readSnapshot({
      window: fakeWindow,
      document: fakeDocument,
      zvukBridge: bridge,
      emitDiagnostic: () => {},
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.trackUrl).toBe("https://zvuk.com/track/31415");
  });
});
