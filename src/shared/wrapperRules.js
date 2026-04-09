export const WRAPPER_SOURCE_PREFIX = "wrapper:";
export const BUILTIN_WRAPPER_RULE_ID_PREFIX = "__builtin__-";
export const WRAPPER_CONTROL_ACTIONS = Object.freeze([
  "play",
  "pause",
  "toggle",
  "next",
  "previous",
  "volume",
  "mute",
  "unmute",
  "muteToggle",
]);
export const WRAPPER_CONTROL_EDITOR_ACTIONS = Object.freeze([
  "play",
  "pause",
  "previous",
  "next",
  "mute",
  "unmute",
  "volume",
]);
export const WRAPPER_VOLUME_CONTROL_MODE_DEFAULT = "auto";
export const WRAPPER_VOLUME_CONTROL_MODES = Object.freeze([
  WRAPPER_VOLUME_CONTROL_MODE_DEFAULT,
  "click",
  "press",
  "drag",
  "range",
  "noui",
]);

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (
      normalized === "false" ||
      normalized === "0" ||
      normalized === "no" ||
      normalized === "off" ||
      normalized === ""
    ) {
      return false;
    }
  }
  return fallback;
}

function normalizeRuleId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

export function normalizeBuiltInSourceId(value) {
  return normalizeRuleId(value);
}

export function makeBuiltInWrapperRuleId(sourceId) {
  const normalizedSourceId = normalizeBuiltInSourceId(sourceId);
  if (!normalizedSourceId) return "";
  return `${BUILTIN_WRAPPER_RULE_ID_PREFIX}${normalizedSourceId}`;
}

export function isBuiltInWrapperRule(rule) {
  return Boolean(normalizeBuiltInSourceId(rule?.builtinSourceId));
}

export function normalizeHost(rawHost) {
  let value = String(rawHost || "").trim().toLowerCase();
  if (!value) return "";

  const hasWildcardPrefix = value.startsWith("*.");
  if (hasWildcardPrefix) {
    value = value.slice(2).trim();
  }

  if (value.includes("://")) {
    try {
      value = String(new URL(value).hostname || "")
        .toLowerCase()
        .trim();
    } catch (_) {
      return "";
    }
  }

  value = value.replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^\.+|\.+$/g, "").trim();
  if (!value || value.includes("*")) return "";
  if (!hasWildcardPrefix) return value;
  return `*.${value}`;
}

export function normalizeHostList(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[,\n;]+/g);
  const out = [];
  for (const chunk of input) {
    const normalized = normalizeHost(chunk);
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

export function normalizeChildSourceIds(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(",");
  const out = [];
  for (const chunk of input) {
    const normalized = String(chunk || "").trim().toLowerCase();
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function normalizeSelector(raw) {
  return String(raw || "").trim();
}

export function normalizeWrapperVolumeControlMode(
  value,
  fallback = WRAPPER_VOLUME_CONTROL_MODE_DEFAULT
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (WRAPPER_VOLUME_CONTROL_MODES.includes(normalized)) return normalized;
  return WRAPPER_VOLUME_CONTROL_MODES.includes(fallback)
    ? fallback
    : WRAPPER_VOLUME_CONTROL_MODE_DEFAULT;
}

export function normalizeWrapperControlModes(value) {
  const source = value && typeof value === "object" ? value : {};
  const volumeMode = normalizeWrapperVolumeControlMode(source.volume);
  if (volumeMode === WRAPPER_VOLUME_CONTROL_MODE_DEFAULT) return {};
  return { volume: volumeMode };
}

export function normalizeWrapperControlSelectors(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = {};

  for (const action of WRAPPER_CONTROL_ACTIONS) {
    const selector = normalizeSelector(source[action]);
    if (!selector) continue;
    next[action] = selector;
  }

  return next;
}

export function makeWrapperSourceId(ruleId) {
  const id = normalizeRuleId(ruleId);
  if (!id) return "";
  return `${WRAPPER_SOURCE_PREFIX}${id}`;
}

export function wrapperRuleIdFromSourceId(sourceId) {
  const raw = String(sourceId || "").trim();
  if (!raw.startsWith(WRAPPER_SOURCE_PREFIX)) return "";
  return raw.slice(WRAPPER_SOURCE_PREFIX.length).trim();
}

export function isWrapperSourceId(sourceId) {
  return String(sourceId || "").startsWith(WRAPPER_SOURCE_PREFIX);
}

export function getWrapperControlSelector(rule, action) {
  const normalizedAction = String(action || "").trim();
  if (!WRAPPER_CONTROL_ACTIONS.includes(normalizedAction)) return "";
  const selectors = normalizeWrapperControlSelectors(rule?.controlSelectors);
  const directSelector = selectors[normalizedAction] || "";
  if (directSelector) return directSelector;

  if (normalizedAction === "play" || normalizedAction === "pause") {
    return selectors.toggle || "";
  }

  if (normalizedAction === "mute" || normalizedAction === "unmute") {
    return selectors.muteToggle || "";
  }

  if (normalizedAction === "toggle") {
    if (selectors.play && selectors.pause && selectors.play === selectors.pause) {
      return selectors.play;
    }
    return selectors.play || selectors.pause || "";
  }

  if (normalizedAction === "muteToggle") {
    if (selectors.mute && selectors.unmute && selectors.mute === selectors.unmute) {
      return selectors.mute;
    }
    return selectors.mute || selectors.unmute || "";
  }

  return "";
}

export function getWrapperControlMode(rule, action) {
  const normalizedAction = String(action || "").trim();
  if (normalizedAction !== "volume") return "";
  const modes = normalizeWrapperControlModes(rule?.controlModes);
  return modes.volume || WRAPPER_VOLUME_CONTROL_MODE_DEFAULT;
}

export function compilePathRegex(pathRegex) {
  const raw = String(pathRegex || "").trim();
  if (!raw) return { regex: null, error: "" };
  try {
    return { regex: new RegExp(raw), error: "" };
  } catch (error) {
    return { regex: null, error: String(error || "Invalid regex") };
  }
}

function escapeRegexText(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makePathRegexTemplate(url) {
  try {
    const parsed = new URL(String(url || ""));
    const pathname = String(parsed.pathname || "/");
    if (!pathname || pathname === "/") return "";
    return `^${escapeRegexText(pathname)}(?:\\?.*)?$`;
  } catch (_) {
    return "";
  }
}

export function normalizeWrapperRules(input) {
  const list = Array.isArray(input) ? input : [];
  const normalized = [];
  const knownIds = new Set();
  const builtInRuleIndexBySourceId = new Map();

  for (let idx = 0; idx < list.length; idx += 1) {
    const raw = list[idx];
    if (!raw || typeof raw !== "object") continue;

    const hostPatterns = normalizeHostList(raw.host);
    const host = hostPatterns.join(", ");
    const childSourceIds = normalizeChildSourceIds(raw.childSourceIds);
    const pathRegex = String(raw.pathRegex || "").trim();
    const labelRaw = String(raw.label || "").trim();
    const builtinSourceId = normalizeBuiltInSourceId(raw.builtinSourceId);

    let idBase = builtinSourceId ? makeBuiltInWrapperRuleId(builtinSourceId) : normalizeRuleId(raw.id);
    if (!idBase) idBase = `rule-${idx + 1}`;

    if (builtinSourceId && builtInRuleIndexBySourceId.has(builtinSourceId)) {
      const previousIndex = builtInRuleIndexBySourceId.get(builtinSourceId);
      const previous = normalized[previousIndex];
      if (previous?.id) knownIds.delete(previous.id);
      normalized.splice(previousIndex, 1);
      builtInRuleIndexBySourceId.clear();
      normalized.forEach((entry, entryIndex) => {
        if (entry?.builtinSourceId) {
          builtInRuleIndexBySourceId.set(entry.builtinSourceId, entryIndex);
        }
      });
    }

    let id = idBase;
    let counter = 2;
    while (knownIds.has(id)) {
      id = `${idBase}-${counter}`;
      counter += 1;
    }
    knownIds.add(id);

    normalized.push({
      id,
      enabled: parseBoolean(raw.enabled, true),
      host,
      hostPatterns,
      pathRegex,
      label: labelRaw || hostPatterns[0] || `Wrapper ${idx + 1}`,
      childSourceIds,
      controlSelectors: normalizeWrapperControlSelectors(raw.controlSelectors),
      controlModes: normalizeWrapperControlModes(raw.controlModes),
      builtinSourceId,
    });

    if (builtinSourceId) {
      builtInRuleIndexBySourceId.set(builtinSourceId, normalized.length - 1);
    }
  }

  return normalized;
}

function parseUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return {
      host: String(parsed.hostname || "").toLowerCase().trim(),
      target: `${parsed.pathname || "/"}${parsed.search || ""}`,
    };
  } catch (_) {
    return { host: "", target: "" };
  }
}

function isHostMatch(pattern, host) {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (!normalizedPattern || !normalizedHost) return false;
  if (!normalizedPattern.startsWith("*.")) {
    return normalizedPattern === normalizedHost;
  }

  const suffix = normalizedPattern.slice(1);
  if (!normalizedHost.endsWith(suffix)) return false;
  return normalizedHost.length > suffix.length;
}

export function createWrapperRuleMatchers(wrapperRules) {
  return normalizeWrapperRules(wrapperRules).map((rule) => {
    const { regex, error } = compilePathRegex(rule.pathRegex);
    const hostPatterns = normalizeHostList(rule.hostPatterns || rule.host);
    return {
      rule,
      regex,
      regexError: error,
      hostPatterns,
    };
  });
}

export function findMatchingWrapperRule({ sourceId, url, wrapperRules }) {
  const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
  if (!normalizedSourceId) return null;

  const { host, target } = parseUrl(url);
  if (!host) return null;

  const matchers = createWrapperRuleMatchers(wrapperRules);
  for (const matcher of matchers) {
    const { rule, regex, regexError, hostPatterns } = matcher;
    if (!rule.enabled) continue;
    if (!(hostPatterns || []).length) continue;
    if (!hostPatterns.some((pattern) => isHostMatch(pattern, host))) continue;
    const builtinSourceId = normalizeBuiltInSourceId(rule?.builtinSourceId);
    if (builtinSourceId) {
      if (builtinSourceId !== normalizedSourceId) continue;
    } else if (!rule.childSourceIds.includes(normalizedSourceId)) {
      continue;
    }
    if (regexError) continue;
    if (regex && !regex.test(target)) continue;

    return {
      rule,
      host,
      target,
    };
  }

  return null;
}
