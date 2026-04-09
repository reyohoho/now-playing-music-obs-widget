import { beforeEach, describe, expect, it, vi } from "vitest";
import { createControlExecution } from "../src/background/serviceWorker/controlExecution";

function makeTarget() {
  return {
    key: "sess-1",
    tabId: 11,
    frameId: 0,
    url: "https://example.com/",
    snapshot: {
      sourceId: "web-media",
      sourceLabel: "Web Media Session",
      controlCapabilities: {
        volume: true,
        play: true,
      },
    },
  };
}

function makeExecution({ sendMessageImpl, selectorByAction, executeScriptImpl }) {
  const runtime = {
    settings: {
      debugMode: false,
    },
  };

  const target = makeTarget();
  const sourceRegistry = {
    get(id) {
      if (id === "sess-1") return target;
      return null;
    },
  };

  globalThis.chrome = {
    tabs: {
      sendMessage: vi.fn(sendMessageImpl),
    },
    scripting: {
      executeScript: vi.fn(executeScriptImpl || (async () => {})),
    },
    runtime: {
      getManifest: vi.fn(() => ({
        content_scripts: [{ js: ["src/content/contentScript.js"] }],
      })),
    },
  };

  const execution = createControlExecution({
    runtime,
    sourceRegistry,
    findWrapperMatchForInstance: () => ({ rule: { controlSelectors: {} }, host: "example.com" }),
    getWrapperControlSelector: (_rule, action) => selectorByAction[action] || "",
    getEffectiveSettings: () => runtime.settings,
    MSG: {
      CONTROL_SELECTOR_EXEC: "control:selectorExec",
      CONTROL_EXEC: "control:exec",
    },
    buildActiveView: () => ({ primarySessionId: "sess-1" }),
    getSessionFrameOptions: () => ({ frameId: 0 }),
    rememberWrapperVolumeFromControl: vi.fn(async () => {}),
    pushDiagnostic: vi.fn(),
    sanitizeDiagnosticPayload: (payload) => payload,
    debugLog: vi.fn(),
    publishState: vi.fn(async () => {}),
  });

  return { execution, chromeMock: globalThis.chrome, target };
}

describe("controlExecution wrapper selector priority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fallback to native volume path when wrapper volume selector exists and fails", async () => {
    const { execution, chromeMock } = makeExecution({
      selectorByAction: { volume: ".custom-volume" },
      sendMessageImpl: async (_tabId, payload) => {
        if (payload.type === "control:selectorExec") {
          return { ok: false, message: "selector volume control unavailable" };
        }
        return { ok: true };
      },
    });

    const result = await execution.handleControlActive("volume", 0.42);

    expect(result.ok).toBe(false);
    expect(String(result.path || "")).toContain("wrapper-selector:volume");
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      type: "control:selectorExec",
      action: "volume",
      selector: ".custom-volume",
      value: 0.42,
    });
  });

  it("keeps fallback for non-volume actions", async () => {
    const { execution, chromeMock } = makeExecution({
      selectorByAction: { play: ".custom-play" },
      sendMessageImpl: async (_tabId, payload) => {
        if (payload.type === "control:selectorExec") {
          return { ok: false, message: "selector failed" };
        }
        if (payload.type === "control:exec") {
          return { ok: true, path: "native-play" };
        }
        return { ok: false };
      },
    });

    const result = await execution.handleControlActive("play");

    expect(result).toMatchObject({ ok: true, path: "native-play" });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.sendMessage.mock.calls[1][1]).toMatchObject({
      type: "control:exec",
      action: "play",
      sourceId: "web-media",
    });
  });

  it("injects content script and retries selector control when receiver is missing", async () => {
    const { execution, chromeMock } = makeExecution({
      selectorByAction: { volume: "#playerVolume [role='slider']" },
      sendMessageImpl: vi
        .fn()
        .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
        .mockResolvedValueOnce({ ok: true, path: "wrapper-selector-volume" }),
    });

    const result = await execution.handleControlActive("volume", 0.66);

    expect(result).toMatchObject({ ok: true, path: "wrapper-selector-volume" });
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chromeMock.scripting.executeScript.mock.calls[0][0]).toMatchObject({
      target: { tabId: 11, frameIds: [0] },
      files: ["src/content/contentScript.js"],
    });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
});
