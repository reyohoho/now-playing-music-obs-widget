import { describe, expect, it, vi } from "vitest";
import {
  buildContentScriptMatches,
  buildDynamicContentScriptDefinition,
  syncDynamicContentScriptRegistration,
  DYNAMIC_CONTENT_SCRIPT_ID,
} from "../src/background/contentScriptRegistry";

const providers = [
  {
    id: "youtube",
    hosts: ["youtube.com", "www.youtube.com"],
  },
  {
    id: "spotify",
    hosts: ["open.spotify.com"],
  },
  {
    id: "web-media",
    hosts: [],
  },
];

describe("contentScriptRegistry", () => {
  it("uses all_urls match when generic injection is enabled", () => {
    const { matches, excludeMatches } = buildContentScriptMatches({
      settings: { allowGenericWebInjection: true },
      providers,
    });

    expect(matches).toEqual(["<all_urls>"]);
    expect(excludeMatches).toEqual([]);
  });

  it("builds host-specific matches from providers and enabled wrapper rules when generic injection is disabled", () => {
    const { matches, excludeMatches } = buildContentScriptMatches({
      settings: {
        allowGenericWebInjection: false,
        wrapperRules: [
          { enabled: true, host: "radiorecord.ru" },
          { enabled: true, hostPatterns: ["*.example.fm"] },
          { enabled: false, host: "disabled.example" },
        ],
      },
      providers,
    });

    expect(matches).toContain("*://youtube.com/*");
    expect(matches).toContain("*://www.youtube.com/*");
    expect(matches).toContain("*://open.spotify.com/*");
    expect(matches).toContain("*://radiorecord.ru/*");
    expect(matches).toContain("*://*.example.fm/*");
    expect(matches).not.toContain("*://disabled.example/*");
    expect(excludeMatches).toEqual([]);
  });

  it("creates dynamic content script definition", () => {
    const script = buildDynamicContentScriptDefinition({
      settings: { allowGenericWebInjection: true },
      providers,
    });

    expect(script.id).toBe(DYNAMIC_CONTENT_SCRIPT_ID);
    expect(script.js).toEqual(["src/content/contentScript.js"]);
    expect(script.allFrames).toBe(true);
    expect(script.runAt).toBe("document_idle");
    expect(script.matches).toEqual(["<all_urls>"]);
    expect(script.excludeMatches).toEqual([]);
  });

  it("re-registers content script with computed matches", async () => {
    const chromeApi = {
      scripting: {
        unregisterContentScripts: vi.fn(async () => undefined),
        registerContentScripts: vi.fn(async () => undefined),
      },
    };

    const result = await syncDynamicContentScriptRegistration({
      settings: { allowGenericWebInjection: false, wrapperRules: [{ host: "radiorecord.ru", enabled: true }] },
      providers,
      chromeApi,
    });

    expect(result.ok).toBe(true);
    expect(chromeApi.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [DYNAMIC_CONTENT_SCRIPT_ID],
    });
    expect(chromeApi.scripting.registerContentScripts).toHaveBeenCalledTimes(1);

    const [[registered]] = chromeApi.scripting.registerContentScripts.mock.calls;
    expect(registered[0].id).toBe(DYNAMIC_CONTENT_SCRIPT_ID);
    expect(registered[0].matches).toContain("*://radiorecord.ru/*");
    expect(registered[0].matches).toContain("*://open.spotify.com/*");
  });
});
