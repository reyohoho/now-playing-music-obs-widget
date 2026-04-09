import { describe, expect, test } from "vitest";
import {
  DEFAULT_TWITCH_ANNOUNCE_TEMPLATE,
  buildPatch,
  modelFromSettings,
  normalizeAccentColor,
  normalizeAppearance,
  normalizeUiLocale,
  readInitialThemeFromStorage,
  resolveAppearance,
} from "../src/options/optionsModel";

describe("optionsModel normalization", () => {
  test("normalizes appearance, accent and locale values", () => {
    expect(normalizeAppearance(" DARK ")).toBe("dark");
    expect(normalizeAppearance("weird")).toBe("system");

    expect(normalizeAccentColor(" TEAL ")).toBe("teal");
    expect(normalizeAccentColor("unknown")).toBe("teal");

    expect(normalizeUiLocale("ru-RU")).toBe("ru");
    expect(normalizeUiLocale("EN_us")).toBe("en");
    expect(normalizeUiLocale("de")).toBe("en");
  });

  test("resolves system appearance from media preference", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
  });

  test("reads initial theme from storage safely", () => {
    const storage = {
      getItem(key) {
        if (key === "nph.themeAppearance") return "dark";
        if (key === "nph.themeAccentColor") return "blue";
        return "";
      },
    };
    expect(readInitialThemeFromStorage(storage)).toEqual({
      appearance: "dark",
      accentColor: "blue",
    });

    const brokenStorage = {
      getItem() {
        throw new Error("boom");
      },
    };
    expect(readInitialThemeFromStorage(brokenStorage)).toEqual({
      appearance: "system",
      accentColor: "teal",
    });
  });
});

describe("optionsModel conversion", () => {
  test("builds form model with defaults and normalized values", () => {
    const model = modelFromSettings(
      {
        trackingEnabled: false,
        allowGenericWebInjection: false,
        sourceBulkMuteIgnoreMap: {
          "web-media": true,
          youtube: "1",
        },
        sourceMinDurationSecMap: {
          "web-media": 55,
          youtube: 12,
        },
        liveVideoCoversInPopup: true,
        showNowPlayingBlockInPopup: false,
        debugMode: 1,
        uiLocale: "EN-us",
        themeAppearance: "dark",
        themeAccentColor: "blue",
        primarySourceAutoPickMap: { spotify: false },
        obs: {
          enabled: 1,
          host: "obs.local",
          port: "5566",
          password: "secret",
          textSourceName: "NpText",
          textTemplate: "{{title}}",
          browserEventEnabled: false,
          browserEventName: "np:event",
        },
        twitch: {
          enabled: true,
          controlEnabled: true,
          announceEnabled: false,
          channel: "my_channel",
          announceMinIntervalMs: "1500",
          announceTemplate: "",
        },
        wrapperRules: [
          {
            id: "Rule A",
            host: "music.youtube.com",
            childSourceIds: ["youtube"],
            controlSelectors: { toggle: ".toggle" },
          },
        ],
      },
      "ru-RU"
    );

    expect(model.trackingEnabled).toBe(false);
    expect(model.allowGenericWebInjection).toBe(false);
    expect(model.sourceBulkMuteIgnoreMap["web-media"]).toBe(true);
    expect(model.sourceBulkMuteIgnoreMap.youtube).toBe(true);
    expect(model.sourceBulkMuteIgnoreMap["wrapper:rule-a"]).toBe(false);
    expect(model.sourceMinDurationSecMap["web-media"]).toBe(55);
    expect(model.sourceMinDurationSecMap.youtube).toBe(12);
    expect(model.liveVideoCoversInPopup).toBe(true);
    expect(model.showNowPlayingBlockInPopup).toBe(false);
    expect(model.debugMode).toBe(true);
    expect(model.uiLocale).toBe("en");
    expect(model.themeAppearance).toBe("dark");
    expect(model.themeAccentColor).toBe("blue");
    expect(model.obs.port).toBe(5566);
    expect(model.twitch.announceMinIntervalMs).toBe(1500);
    expect(model.twitch.announceTemplate).toBe(DEFAULT_TWITCH_ANNOUNCE_TEMPLATE);
    expect(model.primarySourceAutoPickMap).toEqual({ spotify: false });
    expect(model.wrapperRules).toHaveLength(1);
    expect(model.wrapperRules[0].id).toBe("rule-a");
  });

  test("builds patch from form model and sanitizes fields", () => {
    const patch = buildPatch({
      trackingEnabled: true,
      allowGenericWebInjection: false,
      sourceBulkMuteIgnoreMap: {
        "web-media": "false",
        youtube: 1,
      },
      sourceMinDurationSecMap: {
        "web-media": 0,
        youtube: "17",
      },
      liveVideoCoversInPopup: true,
      showNowPlayingBlockInPopup: false,
      debugMode: false,
      uiLocale: "RU",
      themeAppearance: "invalid",
      themeAccentColor: "not-real",
      customCss: "  .x{}  ",
      primarySourceAutoPickMap: { youtube: false },
      obs: {
        enabled: true,
        host: "   ",
        port: "0",
        password: " pwd ",
        textSourceName: "   ",
        textTemplate: "  ",
        browserEventEnabled: true,
        browserEventName: "   ",
      },
      twitch: {
        enabled: true,
        controlEnabled: true,
        announceEnabled: true,
        channel: "  abc  ",
        username: "  user  ",
        clientId: "  id  ",
        oauthToken: "  token  ",
        announceMinIntervalMs: "0",
        announceTemplate: "   ",
      },
      wrapperRules: [],
    });

    expect(patch.uiLocale).toBe("ru");
    expect(patch.allowGenericWebInjection).toBe(false);
    expect(patch.sourceBulkMuteIgnoreMap["web-media"]).toBe(false);
    expect(patch.sourceBulkMuteIgnoreMap.youtube).toBe(true);
    expect(patch.sourceMinDurationSecMap["web-media"]).toBe(0);
    expect(patch.sourceMinDurationSecMap.youtube).toBe(17);
    expect(patch.liveVideoCoversInPopup).toBe(true);
    expect(patch.themeAppearance).toBe("system");
    expect(patch.themeAccentColor).toBe("teal");
    expect(patch.obs.host).toBe("127.0.0.1");
    expect(patch.obs.port).toBe(4455);
    expect(patch.obs.textSourceName).toBe("NowPlaying");
    expect(patch.obs.textTemplate).toBe("{{artist}} - {{title}}");
    expect(patch.obs.browserEventName).toBe("nowplaying:update");
    expect(patch.twitch.channel).toBe("abc");
    expect(patch.twitch.username).toBe("user");
    expect(patch.twitch.clientId).toBe("id");
    expect(patch.twitch.oauthToken).toBe("token");
    expect(patch.twitch.announceMinIntervalMs).toBe(30000);
    expect(patch.twitch.announceTemplate).toBe(DEFAULT_TWITCH_ANNOUNCE_TEMPLATE);
    expect(patch.primarySourceAutoPickMap).toEqual({ youtube: false });
  });
});
