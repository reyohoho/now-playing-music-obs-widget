try {
  importScripts("providers.js");
} catch (_) {}

// Change this to the URL of the deployed Go backend. It must also be present
// in manifest.json → host_permissions so the service worker may reach it.
const BACKEND_URL = "http://62.113.42.165:8787";

const DEFAULTS = {
  // "direct" — the existing OBS WebSocket flow (extension → OBS directly).
  // "server" — relay the track through the Go backend so OBS can pull it
  //             from an overlay URL (no OBS WebSocket setup needed).
  obsMode: "direct",

  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
  obsEnabled: true,

  // Backend room identity. Generated on first use; rotating regenerates both
  // so nobody can reuse a previously leaked URL/key pair.
  serverRoomId: "",
  serverRoomKey: "",

  providersDisabled: [],

  // Overlay appearance (server mode). Sent to the backend with every publish
  // so reconnecting overlays get the freshest look.
  overlayShowBackground:   true,
  overlayBackgroundColor:  "#101218",
  overlayBackgroundAlpha:  0.66,
  overlayTextColor:        "#ffffff",
  overlayFontFamily:       "system",
  overlayFontSize:         22,
  overlayShowProviderIcon:   true,
  overlayProviderIconSource: "emoji", // "emoji" | "favicon"
  overlayShowDot:            true,
  overlayBorderRadius:       999,

  // Master toggle for the moobot vote-skip section of the options page.
  moobotEnabled: true,
};

const OVERLAY_KEYS = [
  "overlayShowBackground",
  "overlayBackgroundColor",
  "overlayBackgroundAlpha",
  "overlayTextColor",
  "overlayFontFamily",
  "overlayFontSize",
  "overlayShowProviderIcon",
  "overlayProviderIconSource",
  "overlayShowDot",
  "overlayBorderRadius",
];

const OBS_RECONNECT_MS = 4000;
const OBS_LAST_LINE_STORAGE_KEY = "obsLastLine";
const OBS_LAST_PROVIDER_STORAGE_KEY = "obsLastProviderId";

// Track-inactivity watcher: clears OBS text if no supported tab has
// reported a track recently.
const NO_SONG_CHECK_INTERVAL_MS = 1000;
const TAB_SONG_TTL_MS = 4000;
const tabSongState = new Map();
let noSongCheckTimer = null;

// Server-mode polling: how often we ask the backend whether an overlay is
// currently connected. Short enough to feel live, long enough to stay cheap.
const SERVER_STATUS_POLL_MS = 5000;
const SERVER_FETCH_TIMEOUT_MS = 7000;

const CLOSE_CODE = {
  AUTH_FAILED: 4009,
  UNSUPPORTED_RPC: 4010,
  ABNORMAL: 1006,
};

let lastLineKey = { key: "", t: 0 };

// --------------------------------------------------------------------------
// direct-OBS (WebSocket) state
// --------------------------------------------------------------------------

const obs = {
  ws: null,
  identified: false,
  req: 0,
  host: DEFAULTS.obsHost,
  port: DEFAULTS.obsPort,
  password: DEFAULTS.obsPassword,
  passwordRaw: DEFAULTS.obsPassword,
  passwordTrimmed: DEFAULTS.obsPassword.trim(),
  triedTrimmedFallback: false,
  reconnectTimer: null,
  inputName: DEFAULTS.obsInputName,
  lastLine: "",
  lastProviderId: "",
  pendingRequests: new Map(),
  enabled: true,
  mode: DEFAULTS.obsMode,
  disabledProviders: new Set(),
};

// --------------------------------------------------------------------------
// server (backend relay) state
// --------------------------------------------------------------------------

const server = {
  baseUrl: BACKEND_URL,
  roomId: "",
  roomKey: "",
  subscribers: 0,
  pollTimer: null,
  lastPublishedLine: null,
  lastPublishedProviderId: null,
  publishInFlight: false,
  lastError: "",
  lastStatusOk: false,
  overlay: buildDefaultOverlayConfig(),
  lastSentOverlayHash: "",
};

function buildDefaultOverlayConfig() {
  const out = {};
  for (const k of OVERLAY_KEYS) out[k] = DEFAULTS[k];
  return out;
}

// Maps the extension's flat storage keys (prefixed with "overlay") onto the
// compact keys expected by the overlay page / backend.
function overlayConfigToPayload(cfg) {
  return {
    showBackground:   cfg.overlayShowBackground !== false,
    backgroundColor:  String(cfg.overlayBackgroundColor || DEFAULTS.overlayBackgroundColor),
    backgroundAlpha:  clamp01(cfg.overlayBackgroundAlpha, DEFAULTS.overlayBackgroundAlpha),
    textColor:        String(cfg.overlayTextColor || DEFAULTS.overlayTextColor),
    fontFamily:       String(cfg.overlayFontFamily || DEFAULTS.overlayFontFamily),
    fontSize:         clampInt(cfg.overlayFontSize, 8, 128, DEFAULTS.overlayFontSize),
    showProviderIcon:   cfg.overlayShowProviderIcon !== false,
    providerIconSource: cfg.overlayProviderIconSource === "favicon" ? "favicon" : "emoji",
    showDot:            cfg.overlayShowDot !== false,
    borderRadius:       clampInt(cfg.overlayBorderRadius, 0, 999, DEFAULTS.overlayBorderRadius),
  };
}

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function stableStringify(obj) {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map((k) => [k, obj[k]]));
}

// --------------------------------------------------------------------------
// shared status surface exposed to the options page
// --------------------------------------------------------------------------

let obsStatus = {
  state: "idle",
  message: "Ожидание конфигурации.",
  lastError: "",
  mode: DEFAULTS.obsMode,
  // Direct-OBS mode fields
  configuredHost: DEFAULTS.obsHost,
  configuredPort: DEFAULTS.obsPort,
  inputName: DEFAULTS.obsInputName,
  passwordConfigured: false,
  // Server mode fields
  serverBaseUrl: BACKEND_URL,
  serverRoomId: "",
  serverHasKey: false,
  serverSubscribers: 0,
  // Global
  enabled: true,
  activeProviderId: "",
  updatedAt: Date.now(),
};

function persistObsStatus() {
  chrome.storage.local.set({ obsStatus }, () => void chrome.runtime.lastError);
}

function updateObsStatus(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (obsStatus[key] !== value) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  obsStatus = { ...obsStatus, ...patch, updatedAt: Date.now() };
  persistObsStatus();
}

function setConnectionState(state, message, extra = {}) {
  updateObsStatus({ state, message, ...extra });
}

function setConnectionError(message, lastError = message) {
  setConnectionState("error", message, { lastError });
}

// --------------------------------------------------------------------------
// OBS WebSocket (direct mode) — unchanged protocol, just gated by mode
// --------------------------------------------------------------------------

function obsCloseHint(code) {
  if (code === CLOSE_CODE.AUTH_FAILED) {
    return "Ошибка авторизации OBS (обычно неверный пароль).";
  }
  if (code === CLOSE_CODE.UNSUPPORTED_RPC) {
    return "Неподдерживаемая версия RPC протокола OBS.";
  }
  if (code === CLOSE_CODE.ABNORMAL) {
    return "Сокет оборван (OBS недоступен / порт / firewall).";
  }
  return "";
}

function clearReconnectTimer() {
  if (!obs.reconnectTimer) return;
  clearTimeout(obs.reconnectTimer);
  obs.reconnectTimer = null;
}

function scheduleReconnect() {
  if (!isDirectActive()) return;
  if (obs.reconnectTimer) return;
  setConnectionState(
    "connecting",
    `Повторное подключение к ws://${obs.host}:${obs.port} через ${
      OBS_RECONNECT_MS / 1000
    } сек.`
  );
  obs.reconnectTimer = setTimeout(() => {
    obs.reconnectTimer = null;
    connectObs();
  }, OBS_RECONNECT_MS);
}

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function buildObsAuthString(password, salt, challenge) {
  const enc = new TextEncoder();
  const secretBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(password + salt)
  );
  const secretB64 = bytesToBase64(secretBuf);
  const authBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(secretB64 + challenge)
  );
  return bytesToBase64(authBuf);
}

function disconnectObsSocket() {
  clearReconnectTimer();
  obs.pendingRequests.clear();
  obs.identified = false;

  if (!obs.ws) return;
  obs.ws.onopen = null;
  obs.ws.onclose = null;
  obs.ws.onerror = null;
  obs.ws.onmessage = null;
  try { obs.ws.close(); } catch (_) {}
  obs.ws = null;
}

function isAuthRequired(helloData) {
  return (
    helloData?.authentication?.challenge != null &&
    helloData?.authentication?.salt != null
  );
}

function isAuthCloseEvent(ev) {
  return (
    ev?.code === CLOSE_CODE.AUTH_FAILED ||
    /auth|identif/i.test(String(ev?.reason || ""))
  );
}

async function handleHello(helloData) {
  if (!isDirectActive()) return;
  const payload = {
    rpcVersion: helloData?.rpcVersion ?? 1,
    eventSubscriptions: 0,
  };
  const authRequired = isAuthRequired(helloData);

  setConnectionState("connecting", "Сокет открыт. Идентификация в OBS...");

  if (authRequired && obs.password === "") {
    setConnectionError(
      "OBS требует пароль, но в настройках расширения он пустой.",
      "Требуется пароль OBS WebSocket."
    );
    disconnectObsSocket();
    scheduleReconnect();
    return;
  }

  if (authRequired) {
    try {
      updateObsStatus({ message: "OBS запросил авторизацию. Отправляю пароль..." });
      payload.authentication = await buildObsAuthString(
        obs.password,
        helloData.authentication.salt,
        helloData.authentication.challenge
      );
    } catch (_) {
      setConnectionError(
        "Не удалось вычислить токен авторизации OBS.",
        "Ошибка вычисления авторизации."
      );
      disconnectObsSocket();
      scheduleReconnect();
      return;
    }
  }

  if (obs.ws?.readyState === WebSocket.OPEN) {
    obs.ws.send(JSON.stringify({ op: 1, d: payload }));
  }
}

function handleIdentified() {
  obs.identified = true;
  setConnectionState(
    "connected",
    "Подключено к OBS. Ожидаю изменение трека.",
    { lastError: "" }
  );

  if (obs.lastLine) {
    sendSetText(obs.inputName || DEFAULTS.obsInputName, obs.lastLine);
  }
}

function handleRequestResponse(data) {
  const status = data?.requestStatus || {};
  const pending = obs.pendingRequests.get(data?.requestId);
  if (data?.requestId != null) obs.pendingRequests.delete(data.requestId);

  if (status.result === false) {
    const reqType = data?.requestType || pending?.requestType || "Request";
    const details = status.comment
      ? `${reqType}: ${status.comment}`
      : `${reqType}: код ${status.code ?? "?"}`;

    setConnectionError(`OBS отклонил команду: ${details}`, details);
    return;
  }

  if (pending?.requestType === "SetInputSettings") {
    setConnectionState(
      "connected",
      `Подключено к OBS. Обновляю источник "${pending.inputName}".`,
      { lastError: "" }
    );
  }
}

async function handleSocketMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch (_) {
    setConnectionError(
      "Получен некорректный ответ от OBS.",
      "OBS вернул невалидный JSON."
    );
    return;
  }

  if (msg.op === 0) { await handleHello(msg.d); return; }
  if (msg.op === 2) { handleIdentified(); return; }
  if (msg.op === 7) { handleRequestResponse(msg.d); }
}

function handleSocketOpen() {
  obs.identified = false;
  setConnectionState("connecting", "TCP/WebSocket подключен. Жду приветствие OBS...");
}

function tryTrimmedPasswordFallback(ev) {
  if (!isAuthCloseEvent(ev)) return false;
  if (obs.triedTrimmedFallback) return false;
  if (obs.passwordTrimmed === "" || obs.passwordTrimmed === obs.passwordRaw) {
    return false;
  }
  obs.triedTrimmedFallback = true;
  obs.password = obs.passwordTrimmed;
  setConnectionState(
    "connecting",
    "Повторяю авторизацию с паролем без пробелов по краям."
  );
  connectObs();
  return true;
}

function handleSocketClose(ev) {
  obs.identified = false;
  obs.ws = null;
  obs.pendingRequests.clear();

  const reason = ev?.reason ? `: ${ev.reason}` : "";
  const hint = obsCloseHint(ev?.code);
  const closeMsg = `Соединение закрыто (код ${ev?.code ?? "?"}${reason}).${
    hint ? ` ${hint}` : ""
  }`;

  const authClose = isAuthCloseEvent(ev);
  setConnectionState(authClose ? "error" : "disconnected", closeMsg, {
    lastError: authClose ? closeMsg : "",
  });

  if (tryTrimmedPasswordFallback(ev)) return;
  if (!isDirectActive()) return;
  scheduleReconnect();
}

function handleSocketError() {
  setConnectionError(
    `Ошибка сокета ws://${obs.host}:${obs.port}.`,
    "Ошибка WebSocket во время соединения с OBS."
  );
}

function connectObs() {
  if (!isDirectActive()) {
    setConnectionState("disabled", describeInactive(), { lastError: "" });
    return;
  }
  if (obs.ws?.readyState === WebSocket.OPEN) return;

  const url = `ws://${obs.host}:${obs.port}`;
  setConnectionState("connecting", `Подключение к ${url}...`);

  try {
    obs.ws = new WebSocket(url);
  } catch (e) {
    const details = e?.message ? ` (${e.message})` : "";
    setConnectionError(
      `Не удалось открыть сокет ${url}.${details}`,
      `Ошибка открытия сокета ${url}.${details}`
    );
    scheduleReconnect();
    return;
  }

  obs.ws.onopen = handleSocketOpen;
  obs.ws.onclose = handleSocketClose;
  obs.ws.onerror = handleSocketError;
  obs.ws.onmessage = handleSocketMessage;
}

function sendObsRequest(requestType, requestData, meta = {}) {
  if (!isDirectActive()) return;
  if (!obs.ws || obs.ws.readyState !== WebSocket.OPEN || !obs.identified) {
    setConnectionState(
      "connecting",
      "Соединение с OBS пока не готово. Пробую подключиться..."
    );
    connectObs();
    return;
  }

  const requestId = `${++obs.req}`;
  obs.pendingRequests.set(requestId, { requestType, ...meta });

  try {
    obs.ws.send(
      JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData },
      })
    );
  } catch (e) {
    obs.pendingRequests.delete(requestId);
    const details = e?.message ? ` (${e.message})` : "";
    setConnectionError(
      `Не удалось отправить запрос в OBS.${details}`,
      `Ошибка отправки ${requestType}.${details}`
    );
    scheduleReconnect();
  }
}

function sendSetText(inputName, line) {
  sendObsRequest(
    "SetInputSettings",
    { inputName, inputSettings: { text: line }, overlay: true },
    { inputName, line }
  );
}

// --------------------------------------------------------------------------
// Server (backend relay) mode
// --------------------------------------------------------------------------

function isDirectActive()   { return obs.enabled && obs.mode === "direct"; }
function isServerActive()   { return obs.enabled && obs.mode === "server"; }

function describeInactive() {
  if (!obs.enabled) return "Расширение отключено. Нажмите «Включить».";
  if (obs.mode === "direct") return "Режим прямого подключения к OBS.";
  if (obs.mode === "server") return "Режим ретрансляции через сервер.";
  return "Ожидание конфигурации.";
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = SERVER_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stopServerPoll() {
  if (server.pollTimer) {
    clearInterval(server.pollTimer);
    server.pollTimer = null;
  }
}

function startServerPoll() {
  stopServerPoll();
  if (!isServerActive() || !server.roomId) return;
  // One immediate check so the UI is responsive, plus a steady cadence.
  pollServerStatus();
  server.pollTimer = setInterval(pollServerStatus, SERVER_STATUS_POLL_MS);
}

async function pollServerStatus() {
  if (!isServerActive()) return;
  if (!server.baseUrl || !server.roomId) {
    setConnectionError(
      "Не задан URL сервера или ID комнаты.",
      "Серверный режим не настроен."
    );
    return;
  }

  const url = `${server.baseUrl}/api/status/${encodeURIComponent(server.roomId)}`;
  let data;
  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    if (!res.ok) {
      server.lastStatusOk = false;
      setConnectionError(
        `Статус сервера: HTTP ${res.status}.`,
        `GET ${url} → ${res.status}`
      );
      return;
    }
    data = await res.json();
  } catch (err) {
    server.lastStatusOk = false;
    const msg = err?.name === "AbortError"
      ? "Таймаут запроса к серверу."
      : `Ошибка сети: ${err?.message || err}`;
    setConnectionError(msg, msg);
    return;
  }

  const prevSubs = server.subscribers;
  server.subscribers = Math.max(0, Number(data?.subscribers) || 0);
  server.lastStatusOk = true;

  const stateInfo = server.subscribers > 0
    ? {
        state: "connected",
        message: `Оверлей подключён (${server.subscribers}). Трек будет отправлен при изменении.`,
      }
    : {
        state: "connecting",
        message: "Сервер доступен, но оверлей ещё не подключён. Добавьте URL в OBS как Browser Source.",
      };

  updateObsStatus({
    ...stateInfo,
    lastError: "",
    serverSubscribers: server.subscribers,
  });

  // When a fresh overlay appears we push the current track immediately so
  // viewers don't wait for the next track change.
  if (server.subscribers > 0 && prevSubs === 0 && obs.lastLine) {
    publishServerLine(obs.lastLine, obs.lastProviderId, { force: true });
  }
}

async function publishServerLine(line, providerId, { force = false } = {}) {
  if (!isServerActive()) return;
  if (!server.baseUrl || !server.roomId || !server.roomKey) {
    setConnectionError(
      "Серверный режим не настроен (нет URL/ID/ключа).",
      "Сбросьте и сгенерируйте новые ID и ключ в настройках."
    );
    return;
  }
  // Respect the user's requirement: only transmit when we know someone is
  // actually watching. If we've never heard from the server, let it through
  // once so the first status poll can correct us.
  if (!force && server.lastStatusOk && server.subscribers <= 0) return;
  if (!force
      && line === server.lastPublishedLine
      && (providerId || "") === (server.lastPublishedProviderId || "")) {
    return;
  }

  await sendPublishRequest({
    line,
    providerId,
    includeSettings: true,
    settingsOnly: false,
  });
}

// publishServerSettings pushes the overlay appearance to the backend without
// touching the current track. Called whenever the user tweaks colors/fonts.
async function publishServerSettings({ force = false } = {}) {
  if (!isServerActive()) return;
  if (!server.baseUrl || !server.roomId || !server.roomKey) return;
  if (!force && server.lastStatusOk && server.subscribers <= 0) {
    // Still cheap to cache on the server so reconnects get styling even if
    // nobody is currently watching.
    // Falls through: server always accepts settings so overlays opened later
    // see them on first WS frame.
  }
  await sendPublishRequest({ includeSettings: true, settingsOnly: true });
}

async function sendPublishRequest({
  line = null,
  providerId = null,
  includeSettings = true,
  settingsOnly = false,
} = {}) {
  if (server.publishInFlight) return;
  server.publishInFlight = true;

  const url = `${server.baseUrl}/api/publish/${encodeURIComponent(server.roomId)}`;
  const body = {};
  if (!settingsOnly) {
    body.text = line || "";
    body.providerId = providerId || "";
  } else {
    body.settingsOnly = true;
  }
  let settingsPayload = null;
  if (includeSettings) {
    settingsPayload = overlayConfigToPayload(server.overlay);
    const hash = stableStringify(settingsPayload);
    // Avoid resending identical settings on every track change — the server
    // keeps them cached anyway, so we only re-transmit when they changed.
    if (!settingsOnly && hash === server.lastSentOverlayHash) {
      settingsPayload = null;
    }
    if (settingsPayload) {
      body.settings = settingsPayload;
    }
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${server.roomKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      setConnectionError(
        "Сервер отклонил ключ. Сгенерируйте новую пару ID/ключ.",
        "401 Unauthorized"
      );
      return;
    }
    if (!res.ok) {
      setConnectionError(
        `Сервер вернул HTTP ${res.status} при публикации.`,
        `POST ${url} → ${res.status}`
      );
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (typeof data?.subscribers === "number") {
      server.subscribers = data.subscribers;
      updateObsStatus({ serverSubscribers: data.subscribers });
    }
    if (!settingsOnly) {
      server.lastPublishedLine = line;
      server.lastPublishedProviderId = providerId || "";
    }
    if (settingsPayload) {
      server.lastSentOverlayHash = stableStringify(settingsPayload);
    }
    if (server.lastStatusOk || typeof data?.subscribers === "number") {
      updateObsStatus({ lastError: "" });
    }
  } catch (err) {
    const msg = err?.name === "AbortError"
      ? "Таймаут публикации на сервер."
      : `Ошибка публикации: ${err?.message || err}`;
    setConnectionError(msg, msg);
  } finally {
    server.publishInFlight = false;
  }
}

// --------------------------------------------------------------------------
// Mode-agnostic dispatch
// --------------------------------------------------------------------------

function dispatchTextToActive(line, providerId) {
  if (isDirectActive()) {
    sendSetText(obs.inputName || DEFAULTS.obsInputName, line || "");
  } else if (isServerActive()) {
    publishServerLine(line || "", providerId || "");
  }
}

function persistLastLine() {
  chrome.storage.local.set(
    {
      [OBS_LAST_LINE_STORAGE_KEY]: obs.lastLine,
      [OBS_LAST_PROVIDER_STORAGE_KEY]: obs.lastProviderId || "",
    },
    () => void chrome.runtime.lastError
  );
}

function loadLastLine() {
  chrome.storage.local.get(
    {
      [OBS_LAST_LINE_STORAGE_KEY]: "",
      [OBS_LAST_PROVIDER_STORAGE_KEY]: "",
    },
    (res) => {
      if (chrome.runtime.lastError) return;
      obs.lastLine = String(res?.[OBS_LAST_LINE_STORAGE_KEY] ?? "");
      obs.lastProviderId = String(res?.[OBS_LAST_PROVIDER_STORAGE_KEY] ?? "");
      if (obs.lastProviderId) {
        updateObsStatus({ activeProviderId: obs.lastProviderId });
      }
    }
  );
}

function pushLineToObs(line, providerId) {
  providerId = providerId || "";
  if (line === obs.lastLine) {
    if (providerId && providerId !== obs.lastProviderId) {
      obs.lastProviderId = providerId;
      persistLastLine();
      updateObsStatus({ activeProviderId: providerId });
    }
    return;
  }
  const now = Date.now();
  if (line === lastLineKey.key && now - lastLineKey.t < 800) return;
  lastLineKey = { key: line, t: now };

  obs.lastLine = line;
  obs.lastProviderId = providerId;
  persistLastLine();
  updateObsStatus({ activeProviderId: providerId });
  dispatchTextToActive(line, providerId);
}

function clearObsText(reason) {
  const hadLine = Boolean(obs.lastLine);
  const hadProvider = Boolean(obs.lastProviderId);
  if (!hadLine && !hadProvider) return;

  obs.lastLine = "";
  obs.lastProviderId = "";
  lastLineKey = { key: "", t: Date.now() };
  persistLastLine();
  const patch = { activeProviderId: "" };
  if (reason) patch.message = reason;
  updateObsStatus(patch);
  if (hadLine) dispatchTextToActive("", "");
}

function startNoSongWatcher() {
  if (noSongCheckTimer) return;
  noSongCheckTimer = setInterval(() => {
    if (!obs.enabled) return;
    const now = Date.now();
    for (const [tabId, info] of tabSongState) {
      if (now - info.time > TAB_SONG_TTL_MS) {
        tabSongState.delete(tabId);
      }
    }
    if (tabSongState.size === 0 && (obs.lastLine || obs.lastProviderId)) {
      clearObsText("Нет активных треков на поддерживаемых вкладках. Очищаю текст.");
    }
  }, NO_SONG_CHECK_INTERVAL_MS);
}

function applyDisabledProviders(nextSet) {
  obs.disabledProviders = nextSet instanceof Set ? nextSet : new Set(nextSet || []);
  for (const [tabId, info] of tabSongState) {
    if (obs.disabledProviders.has(info.providerId)) {
      tabSongState.delete(tabId);
    }
  }
  if (obs.lastProviderId && obs.disabledProviders.has(obs.lastProviderId)) {
    clearObsText("Текущий провайдер выключен в настройках. Очищаю текст.");
  }
}

// --------------------------------------------------------------------------
// Room identity (server mode)
// --------------------------------------------------------------------------

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRoomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.substring(0, 8) + "-" +
    hex.substring(8, 12) + "-" +
    hex.substring(12, 16) + "-" +
    hex.substring(16, 20) + "-" +
    hex.substring(20)
  );
}

function generateRoomKey() {
  return randomHex(32);
}

async function ensureRoomCredentials(current) {
  let id = String(current?.serverRoomId || "").trim();
  let key = String(current?.serverRoomKey || "").trim();
  let changed = false;
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) {
    id = generateRoomId();
    changed = true;
  }
  if (key.length < 16) {
    key = generateRoomKey();
    changed = true;
  }
  if (changed) {
    await new Promise((resolve) =>
      chrome.storage.sync.set({ serverRoomId: id, serverRoomKey: key }, resolve)
    );
  }
  return { id, key, changed };
}

async function rotateRoomCredentials() {
  const id = generateRoomId();
  const key = generateRoomKey();
  await new Promise((resolve) =>
    chrome.storage.sync.set({ serverRoomId: id, serverRoomKey: key }, resolve)
  );
  // The storage listener will reload and restart polling automatically.
  return { id, key };
}

// --------------------------------------------------------------------------
// Config loader (reads both direct and server settings and re-wires state)
// --------------------------------------------------------------------------

async function loadObsConfig() {
  const cfg = await new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULTS, resolve)
  );

  // Sanitize mode
  const mode = cfg.obsMode === "server" ? "server" : "direct";

  obs.host = cfg.obsHost || DEFAULTS.obsHost;
  obs.port = Number(cfg.obsPort) || DEFAULTS.obsPort;
  obs.passwordRaw = String(cfg.obsPassword ?? "");
  obs.passwordTrimmed = obs.passwordRaw.trim();
  obs.password = obs.passwordRaw;
  obs.triedTrimmedFallback = false;
  obs.inputName = (cfg.obsInputName || DEFAULTS.obsInputName).trim();
  obs.enabled = cfg.obsEnabled !== false;
  obs.mode = mode;
  applyDisabledProviders(
    new Set(Array.isArray(cfg.providersDisabled) ? cfg.providersDisabled : [])
  );

  // Ensure we have an identity in storage before we expose it.
  const creds = await ensureRoomCredentials(cfg);
  server.baseUrl = BACKEND_URL;
  server.roomId = creds.id;
  server.roomKey = creds.key;
  server.subscribers = 0;
  server.lastPublishedLine = null;
  server.lastPublishedProviderId = null;
  server.lastStatusOk = false;
  server.lastSentOverlayHash = "";
  for (const k of OVERLAY_KEYS) {
    server.overlay[k] = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
  }

  updateObsStatus({
    mode,
    configuredHost: obs.host,
    configuredPort: obs.port,
    inputName: obs.inputName,
    passwordConfigured: obs.passwordRaw !== "",
    enabled: obs.enabled,
    serverBaseUrl: server.baseUrl,
    serverRoomId: server.roomId,
    serverHasKey: Boolean(server.roomKey),
    serverSubscribers: 0,
    lastError: "",
  });

  // Tear down both transports, then spin up whichever is active.
  disconnectObsSocket();
  stopServerPoll();

  if (!obs.enabled) {
    setConnectionState("disabled", "Расширение отключено. Нажмите «Включить».", {
      lastError: "",
    });
    return;
  }

  if (mode === "direct") {
    connectObs();
  } else {
    setConnectionState("connecting", "Запрос статуса оверлея у сервера...", {
      lastError: "",
    });
    startServerPoll();
  }
}

// --------------------------------------------------------------------------
// Track messages from content scripts (unchanged semantics)
// --------------------------------------------------------------------------

function handleSongMessage(message, sender) {
  if (!obs.enabled) return;
  if (message?.song == null) return;

  const tabId = sender.tab?.id;
  if (tabId == null) {
    updateObsStatus({ message: "Не удалось определить вкладку-источник трека." });
    return;
  }

  const providerId =
    (typeof obsProviderIdFromUrl === "function"
      ? obsProviderIdFromUrl(sender.tab?.url || sender.url || "")
      : "") || "";

  if (providerId && obs.disabledProviders.has(providerId)) {
    tabSongState.delete(tabId);
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      updateObsStatus({ message: "Не удалось получить состояние вкладки браузера." });
      return;
    }

    if (!tab?.audible) {
      tabSongState.delete(tabId);
      updateObsStatus({ message: "Вкладка не воспроизводит звук. Обновление пропущено." });
      return;
    }

    const line = String(message.song).trim();
    if (!line) {
      tabSongState.delete(tabId);
      updateObsStatus({ message: "Сайт вернул пустую строку трека." });
      return;
    }

    tabSongState.set(tabId, { line, time: Date.now(), providerId });
    pushLineToObs(line, providerId);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSongState.delete(tabId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (
    changes.obsHost ||
    changes.obsPort ||
    changes.obsPassword ||
    changes.obsInputName ||
    changes.obsEnabled ||
    changes.obsMode ||
    changes.serverRoomId ||
    changes.serverRoomKey
  ) {
    loadObsConfig();
    return;
  }
  if (changes.providersDisabled) {
    const list = changes.providersDisabled.newValue;
    applyDisabledProviders(new Set(Array.isArray(list) ? list : []));
  }
  if (changes.twitchChannel) {
    const next = (changes.twitchChannel.newValue || "").trim().toLowerCase();
    if (next !== viewersCurrentChannel) startViewersPoller(next);
  }
  // Live-apply overlay appearance changes without bouncing the connection.
  let overlayChanged = false;
  for (const k of OVERLAY_KEYS) {
    if (changes[k]) {
      server.overlay[k] = changes[k].newValue !== undefined
        ? changes[k].newValue
        : DEFAULTS[k];
      overlayChanged = true;
    }
  }
  if (overlayChanged && isServerActive()) {
    publishServerSettings({ force: true });
  }
});

chrome.runtime.onInstalled.addListener(loadObsConfig);
chrome.runtime.onStartup.addListener(loadObsConfig);
persistObsStatus();
loadLastLine();
loadObsConfig();
startNoSongWatcher();

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// --------------------------------------------------------------------------
// Twitch viewers poller (unchanged)
// --------------------------------------------------------------------------

const VIEWERS_POLL_MS = 5 * 1000;
let viewersPollTimer = null;
let viewersCurrentChannel = "";

async function fetchTwitchViewers(channel) {
  if (!channel) return;
  const url = "https://gql.twitch.tv/gql";
  const body = {
    operationName: "StreamMetadata",
    variables: { channelLogin: channel },
    query:
      "query StreamMetadata($channelLogin: String!) { user(login: $channelLogin) { stream { viewersCount } } }",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const count = json?.data?.user?.stream?.viewersCount ?? 0;
    console.log("[TwitchGQL] viewersCount:", count, "channel:", channel);
    chrome.storage.local.set({
      twitchViewersCount: count,
      twitchViewersUpdatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[TwitchGQL] fetch failed:", err);
  }
}

function startViewersPoller(channel) {
  if (viewersPollTimer) {
    clearInterval(viewersPollTimer);
    viewersPollTimer = null;
  }
  viewersCurrentChannel = channel || "";
  if (!viewersCurrentChannel) return;
  fetchTwitchViewers(viewersCurrentChannel);
  viewersPollTimer = setInterval(
    () => fetchTwitchViewers(viewersCurrentChannel),
    VIEWERS_POLL_MS
  );
}

chrome.storage.sync.get({ twitchChannel: "" }, (v) => {
  startViewersPoller((v.twitchChannel || "").trim().toLowerCase());
});

// --------------------------------------------------------------------------
// Runtime messages (options page)
// --------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "obs:getStatus") {
    sendResponse({ ok: true, status: obsStatus });
    return;
  }

  if (message?.type === "obs:reconnect") {
    loadObsConfig();
    sendResponse({ ok: true, status: obsStatus });
    return;
  }

  if (message?.type === "obs:setEnabled") {
    const enabled = message.enabled !== false;
    chrome.storage.sync.set({ obsEnabled: enabled }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "obs:setMode") {
    const mode = message.mode === "server" ? "server" : "direct";
    chrome.storage.sync.set({ obsMode: mode }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, mode });
    });
    return true;
  }

  if (message?.type === "obs:rotateServerCredentials") {
    rotateRoomCredentials()
      .then((creds) => sendResponse({ ok: true, roomId: creds.id }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "obs:getServerSecrets") {
    // Exposes the sensitive pair only inside the options page (the page is
    // itself privileged) — used to render the copy-to-clipboard control.
    sendResponse({
      ok: true,
      backendUrl: server.baseUrl,
      roomId: server.roomId,
      roomKey: server.roomKey,
    });
    return;
  }

  handleSongMessage(message, sender);
});
