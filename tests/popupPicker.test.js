import { describe, expect, test } from "vitest";
import {
  makePopupWrapperDraftKey,
  normalizePopupTabUrl,
  POPUP_WRAPPER_DRAFT_CREATE_RULE_ID,
  resolvePickerStartTransition,
} from "../src/shared/popupPicker";

describe("popupPicker helpers", () => {
  test("normalizePopupTabUrl strips hash", () => {
    const value = normalizePopupTabUrl("https://example.com/path?a=1#fragment");
    expect(value).toBe("https://example.com/path?a=1");
  });

  test("makePopupWrapperDraftKey uses create rule id fallback", () => {
    const key = makePopupWrapperDraftKey(10, "https://example.com/path", "");
    expect(key).toBe(`10|https://example.com/path|${POPUP_WRAPPER_DRAFT_CREATE_RULE_ID}`);
  });

  test("resolvePickerStartTransition switches on different action", () => {
    const result = resolvePickerStartTransition(
      { tabId: 11, ruleId: "rule-1", action: "play" },
      { tabId: 11, ruleId: "rule-1", action: "pause" }
    );
    expect(result).toEqual({
      mode: "switch",
      cancelCurrent: true,
    });
  });

  test("resolvePickerStartTransition toggles off same action + rule", () => {
    const result = resolvePickerStartTransition(
      { tabId: 11, ruleId: "rule-1", action: "play" },
      { tabId: 11, ruleId: "rule-1", action: "play" }
    );
    expect(result).toEqual({
      mode: "toggle-off",
      cancelCurrent: true,
    });
  });
});
