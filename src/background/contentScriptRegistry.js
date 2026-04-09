import { normalizeHostList } from "@/shared/wrapperRules";

export const DYNAMIC_CONTENT_SCRIPT_ID = "now-playing-content";
export const CONTENT_SCRIPT_FILE = "src/content/contentScript.js";

function normalizeBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

function hostToMatchPattern(host) {
  const normalized = String(host || "").trim().toLowerCase();
  if (!normalized) return "";
  if (!/^\*?\.?[a-z0-9.-]+$/.test(normalized)) return "";
  return `*://${normalized}/*`;
}

function collectProviderHosts(providers = []) {
  const out = [];
  for (const provider of providers) {
    const hosts = Array.isArray(provider?.hosts) ? provider.hosts : [];
    for (const host of hosts) {
      const patterns = normalizeHostList([host]);
      for (const pattern of patterns) {
        const match = hostToMatchPattern(pattern);
        if (!match || out.includes(match)) continue;
        out.push(match);
      }
    }
  }
  return out;
}

function collectWrapperRuleHosts(wrapperRules = []) {
  const out = [];
  const rules = Array.isArray(wrapperRules) ? wrapperRules : [];

  for (const rule of rules) {
    if (rule?.enabled === false) continue;
    const candidates = [
      ...(Array.isArray(rule?.hostPatterns) ? rule.hostPatterns : []),
      ...(typeof rule?.host === "string" ? [rule.host] : []),
    ];
    const patterns = normalizeHostList(candidates);

    for (const pattern of patterns) {
      const match = hostToMatchPattern(pattern);
      if (!match || out.includes(match)) continue;
      out.push(match);
    }
  }

  return out;
}

export function buildContentScriptMatches({
  settings = {},
  providers = [],
} = {}) {
  const allowGenericWebInjection = normalizeBoolean(settings?.allowGenericWebInjection, true);

  if (allowGenericWebInjection) {
    return {
      matches: ["<all_urls>"],
      excludeMatches: [],
    };
  }

  const providerMatches = collectProviderHosts(providers);
  const wrapperMatches = collectWrapperRuleHosts(settings?.wrapperRules);
  const merged = [...new Set([...providerMatches, ...wrapperMatches])];
  return {
    matches: merged.sort((a, b) => a.localeCompare(b)),
    excludeMatches: [],
  };
}

export function buildDynamicContentScriptDefinition({ settings = {}, providers = [] } = {}) {
  const { matches, excludeMatches } = buildContentScriptMatches({ settings, providers });
  const manifestScriptFile = String(
    globalThis?.chrome?.runtime?.getManifest?.()?.content_scripts?.find(
      (entry) => Array.isArray(entry?.js) && entry.js.length
    )?.js?.[0] || ""
  ).trim();
  const scriptFile = manifestScriptFile || CONTENT_SCRIPT_FILE;
  return {
    id: DYNAMIC_CONTENT_SCRIPT_ID,
    js: [scriptFile],
    allFrames: true,
    runAt: "document_idle",
    persistAcrossSessions: true,
    matches,
    excludeMatches,
  };
}

export async function syncDynamicContentScriptRegistration({
  settings = {},
  providers = [],
  chromeApi = globalThis.chrome,
} = {}) {
  const scripting = chromeApi?.scripting;
  if (!scripting?.registerContentScripts || !scripting?.unregisterContentScripts) {
    return {
      ok: false,
      reason: "scripting-unavailable",
      matches: [],
    };
  }

  const script = buildDynamicContentScriptDefinition({ settings, providers });
  if (!script.matches.length) {
    try {
      await scripting.unregisterContentScripts({ ids: [DYNAMIC_CONTENT_SCRIPT_ID] });
    } catch (_) {
      // no-op
    }
    return {
      ok: true,
      reason: "empty-matches",
      matches: [],
    };
  }

  try {
    await scripting.unregisterContentScripts({ ids: [DYNAMIC_CONTENT_SCRIPT_ID] });
  } catch (_) {
    // no-op
  }

  await scripting.registerContentScripts([script]);

  return {
    ok: true,
    reason: "registered",
    matches: script.matches,
  };
}
