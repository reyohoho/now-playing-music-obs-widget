import { describe, expect, it } from "vitest";
import { formatServiceStatus, localizeConnectionState, localizePlaybackState, resolveLocale, t } from "../src/shared/i18n";

describe("service status i18n", () => {
  it("uses localized state labels", () => {
    expect(localizeConnectionState("connected", "ru-RU")).toBe("подключено");
    expect(localizeConnectionState("connected", "en-US")).toBe("connected");
  });

  it("falls back to English for unsupported locales", () => {
    expect(resolveLocale("de-DE")).toBe("en");
    expect(t("popup.settings", "de-DE")).toBe("Settings");
  });

  it("avoids duplicate disabled status text", () => {
    expect(
      formatServiceStatus("obs", {
        state: "disabled",
        message: "Интеграция OBS выключена.",
      }, "ru-RU")
    ).toBe("OBS: Интеграция OBS выключена.");
  });

  it("uses message when present and state when message is missing", () => {
    expect(
      formatServiceStatus("twitch", {
        state: "connecting",
        message: "Подключение к Twitch IRC...",
      }, "ru-RU")
    ).toBe("Twitch: Подключение к Twitch IRC...");

    expect(
      formatServiceStatus("twitch", {
        state: "connecting",
        message: "",
      }, "ru-RU")
    ).toBe("Twitch: подключение");
  });

  it("resolves popup labels via generic translator", () => {
    expect(t("popup.settings", "ru-RU")).toBe("Настройки");
    expect(t("popup.settings", "en-US")).toBe("Settings");
  });

  it("localizes playback state labels", () => {
    expect(localizePlaybackState("playing", "ru-RU")).toBe("играет");
    expect(localizePlaybackState("paused", "en-US")).toBe("paused");
  });
});
