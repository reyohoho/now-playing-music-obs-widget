export const VOLUME_EPSILON = 0.001;
export const DEFAULT_UNMUTE_VOLUME = 0.65;
export const VOLUME_SYNC_EPSILON = 0.005;
export const SEEK_SYNC_EPSILON = 2;
export const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const BULK_MUTED_SESSION_IDS_STORAGE_KEY = "np.popup.bulkMutedSessionIds";
export const BULK_MUTED_RESTORE_VOLUME_BY_SESSION_STORAGE_KEY =
  "np.popup.bulkMutedRestoreVolumeBySession";
const CONTENT_SCRIPT_FILE_FALLBACK = "src/content/contentScript.js";

const RADIX_ACCENTS = new Set([
  "amber",
  "blue",
  "bronze",
  "brown",
  "crimson",
  "cyan",
  "gold",
  "grass",
  "gray",
  "green",
  "indigo",
  "iris",
  "jade",
  "lime",
  "mint",
  "orange",
  "pink",
  "plum",
  "purple",
  "red",
  "ruby",
  "sky",
  "teal",
  "tomato",
  "violet",
  "yellow",
]);

export function normalizeAccentColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (RADIX_ACCENTS.has(normalized)) return normalized;
  return "teal";
}

export function normalizeAppearance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dark" || normalized === "light") return normalized;
  return "system";
}

export function normalizeUiLocale(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ru" || normalized.startsWith("ru")) return "ru";
  if (normalized === "en" || normalized.startsWith("en")) return "en";
  return "";
}

export function isSystemDarkMode() {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches;
}

export function runtimeMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

function isMissingReceiverMessage(message) {
  return /could not establish connection|receiving end does not exist/i.test(
    String(message || "")
  );
}

function sendTabMessage(tabId, payload, options = { frameId: 0 }) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, options, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

async function injectContentScriptOnTab(tabId) {
  if (!chrome?.scripting?.executeScript) {
    return { ok: false, message: "Scripting API unavailable" };
  }

  const manifestScriptFile = String(
    chrome?.runtime?.getManifest?.()?.content_scripts?.find((entry) => Array.isArray(entry?.js) && entry.js.length)
      ?.js?.[0] || ""
  ).trim();
  const scriptFile = manifestScriptFile || CONTENT_SCRIPT_FILE_FALLBACK;

  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: true,
      },
      files: [scriptFile],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error || "Content script injection failed") };
  }
}

export async function sendTabMessageWithRetry(tabId, payload, options = { frameId: 0 }) {
  const firstAttempt = await sendTabMessage(tabId, payload, options);
  if (firstAttempt?.ok || !isMissingReceiverMessage(firstAttempt?.message)) {
    return firstAttempt;
  }

  const injection = await injectContentScriptOnTab(tabId);
  if (!injection?.ok) {
    return { ok: false, message: injection?.message || firstAttempt?.message || "No receiver" };
  }

  return sendTabMessage(tabId, payload, options);
}

export function sendActiveTabMessage(payload) {
  return new Promise((resolve) => {
    chrome.tabs.query(
      {
        active: true,
        currentWindow: true,
      },
      (tabs) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        const tabId = tabs?.[0]?.id;
        if (!Number.isInteger(tabId)) {
          resolve({ ok: false, message: "No active tab" });
          return;
        }
        void sendTabMessageWithRetry(tabId, payload, { frameId: 0 }).then(resolve);
      }
    );
  });
}

export function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function isTabAlive(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

export async function waitTabClosed(tabId, attempts = 8, delayMs = 80) {
  for (let idx = 0; idx < attempts; idx += 1) {
    const alive = await isTabAlive(tabId);
    if (!alive) return true;
    if (idx < attempts - 1) {
      await delay(delayMs);
    }
  }
  return false;
}

export function normalizePlaybackState(value) {
  const stateValue = String(value || "idle").toLowerCase();
  if (stateValue === "playing" || stateValue === "paused" || stateValue === "ended") return stateValue;
  return "idle";
}

export function sessionKey(session) {
  if (!session) return "";
  return String(session.sessionId || `${session.tabId ?? "none"}:${session.sourceId || "unknown"}`);
}

export function normalizeSourceIdList(values) {
  const input = Array.isArray(values) ? values : [];
  const out = [];
  for (const raw of input) {
    const id = String(raw || "").trim().toLowerCase();
    if (!id) continue;
    if (out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function normalizeSessionIdList(values) {
  const input = Array.isArray(values) ? values : [];
  const out = [];
  for (const raw of input) {
    const id = String(raw || "").trim();
    if (!id) continue;
    if (out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function sourceIdFromSessionId(sessionId) {
  const raw = String(sessionId || "").trim();
  if (!raw) return "";
  const parts = raw.split(":");
  if (parts.length < 3) return "";
  return String(parts.slice(2).join(":") || "").trim().toLowerCase();
}

export function readBulkMutedSessionIds(storageApi = globalThis?.localStorage) {
  try {
    if (!storageApi || typeof storageApi.getItem !== "function") return [];
    const raw = storageApi.getItem(BULK_MUTED_SESSION_IDS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeSessionIdList(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

export function writeBulkMutedSessionIds(values, storageApi = globalThis?.localStorage) {
  const normalized = normalizeSessionIdList(values);
  try {
    if (!storageApi || typeof storageApi.setItem !== "function") return;
    storageApi.setItem(
      BULK_MUTED_SESSION_IDS_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  } catch (_) {
    // ignore
  }
}

export function normalizeBulkMutedRestoreVolumeBySession(values) {
  const source = values && typeof values === "object" ? values : {};
  const out = {};
  for (const [rawSessionId, rawVolume] of Object.entries(source)) {
    const sessionId = String(rawSessionId || "").trim();
    if (!sessionId) continue;
    const volume = Number(rawVolume);
    if (!Number.isFinite(volume)) continue;
    if (volume <= VOLUME_EPSILON || volume > 1) continue;
    out[sessionId] = Math.max(0, Math.min(1, volume));
  }
  return out;
}

export function readBulkMutedRestoreVolumeBySession(storageApi = globalThis?.localStorage) {
  try {
    if (!storageApi || typeof storageApi.getItem !== "function") return {};
    const raw = storageApi.getItem(BULK_MUTED_RESTORE_VOLUME_BY_SESSION_STORAGE_KEY);
    if (!raw) return {};
    return normalizeBulkMutedRestoreVolumeBySession(JSON.parse(raw));
  } catch (_) {
    return {};
  }
}

export function writeBulkMutedRestoreVolumeBySession(values, storageApi = globalThis?.localStorage) {
  const normalized = normalizeBulkMutedRestoreVolumeBySession(values);
  try {
    if (!storageApi || typeof storageApi.setItem !== "function") return;
    storageApi.setItem(
      BULK_MUTED_RESTORE_VOLUME_BY_SESSION_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  } catch (_) {
    // ignore
  }
}

export async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return { ok: false, message: "empty" };

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return { ok: true };
    }
  } catch (_) {
    // fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) return { ok: true };
    return { ok: false, message: "copy command rejected" };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "copy failed",
    };
  }
}

export function toSessionSeedSourceId(session, isWrapperSourceId) {
  const baseSourceId = String(session?.baseSourceId || "").trim().toLowerCase();
  if (baseSourceId) return baseSourceId;

  const sourceId = String(session?.sourceId || "").trim().toLowerCase();
  if (!sourceId || isWrapperSourceId(sourceId)) return "";
  return sourceId;
}

export function collectTabSeedSourceIds(sessions, tabId, isWrapperSourceId) {
  if (!Number.isInteger(tabId)) return [];
  return normalizeSourceIdList(
    (Array.isArray(sessions) ? sessions : [])
      .filter((session) => Number(session?.tabId) === tabId)
      .map((session) => toSessionSeedSourceId(session, isWrapperSourceId))
  );
}

function normalizeConnectionState(status) {
  const value = String(status?.state || "idle").toLowerCase();
  if (value === "connected") return "connected";
  if (value === "connecting") return "connecting";
  if (value === "error" || value === "disconnected") return "error";
  if (value === "disabled") return "disabled";
  return "idle";
}

export function connectionDotClass(status) {
  return `sources-controls__status-dot sources-controls__status-dot--${normalizeConnectionState(status)}`;
}
