export const POPUP_WRAPPER_DRAFT_CREATE_RULE_ID = "__create__";

export function normalizePopupTabUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return "";
  }
}

function normalizeRuleId(ruleId) {
  const normalized = String(ruleId || "").trim();
  return normalized || POPUP_WRAPPER_DRAFT_CREATE_RULE_ID;
}

export function makePopupWrapperDraftKey(tabId, urlKey, ruleId) {
  const normalizedTabId = Number(tabId);
  const normalizedUrl = String(urlKey || "").trim();
  const normalizedRuleId = normalizeRuleId(ruleId);
  if (!Number.isInteger(normalizedTabId) || normalizedTabId < 0 || !normalizedUrl) return "";
  return `${normalizedTabId}|${normalizedUrl}|${normalizedRuleId}`;
}

export function resolvePickerStartTransition(currentSession, nextRequest) {
  const current = currentSession && typeof currentSession === "object" ? currentSession : null;
  const next = nextRequest && typeof nextRequest === "object" ? nextRequest : {};
  const nextAction = String(next.action || "").trim();
  const nextRuleId = String(next.ruleId || "").trim();

  if (!current) {
    return {
      mode: "start",
      cancelCurrent: false,
    };
  }

  const isSameAction = String(current.action || "") === nextAction;
  const isSameRule = String(current.ruleId || "") === nextRuleId;

  if (isSameAction && isSameRule) {
    return {
      mode: "toggle-off",
      cancelCurrent: true,
    };
  }

  return {
    mode: "switch",
    cancelCurrent: true,
  };
}
