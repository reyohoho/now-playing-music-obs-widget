import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale, t } from "../src/shared/i18n";

describe("i18n core", () => {
  it("creates locale-bound translator", () => {
    const ruT = createTranslator("ru-RU");
    const enT = createTranslator("en-US");
    expect(ruT("popup.settings")).toBe("Настройки");
    expect(enT("popup.settings")).toBe("Settings");
  });

  it("supports interpolation placeholders", () => {
    expect(
      t("options.toasts.twitchOAuthDone", "en-US", { username: "alice" })
    ).toBe("OAuth completed: alice.");
  });

  it("uses fallback for unknown keys", () => {
    expect(t("missing.path", "en-US", null, "fallback-value")).toBe("fallback-value");
  });

  it("falls back to English locale for unsupported language", () => {
    const deT = createTranslator("de-DE");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(deT("popup.settings")).toBe("Settings");
  });
});
