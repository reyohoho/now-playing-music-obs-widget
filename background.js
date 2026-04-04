let lastLineKey = { key: "", t: 0 };

const DEFAULTS = {
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
  obsEnabled: true,
};

const OBS_RECONNECT_MS = 4000;

const CLOSE_CODE = {
  AUTH_FAILED: 4009,
  UNSUPPORTED_RPC: 4010,
  ABNORMAL: 1006,
};

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
  pendingRequests: new Map(),
  enabled: true,
};

let obsStatus = {
  state: "idle",
  message: "Ожидание конфигурации OBS.",
  lastError: "",
  configuredHost: DEFAULTS.obsHost,
  configuredPort: DEFAULTS.obsPort,
  inputName: DEFAULTS.obsInputName,
  passwordConfigured: false,
  enabled: true,
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
  if (!obs.enabled) return;
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
  obs.ws.close();
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
  if (!obs.enabled) return;
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

  if (msg.op === 0) {
    await handleHello(msg.d);
    return;
  }

  if (msg.op === 2) {
    handleIdentified();
    return;
  }

  if (msg.op === 7) {
    handleRequestResponse(msg.d);
  }
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
  if (!obs.enabled) return;
  scheduleReconnect();
}

function handleSocketError() {
  setConnectionError(
    `Ошибка сокета ws://${obs.host}:${obs.port}.`,
    "Ошибка WebSocket во время соединения с OBS."
  );
}

function connectObs() {
  if (!obs.enabled) {
    setConnectionState("disabled", "Расширение отключено. Нажмите «Включить».", {
      lastError: "",
    });
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
  if (!obs.enabled) {
    setConnectionState("disabled", "Расширение отключено. Нажмите «Включить».", {
      lastError: "",
    });
    return;
  }
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
        d: {
          requestType,
          requestId,
          requestData,
        },
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
    {
      inputName,
      inputSettings: { text: line },
      overlay: true,
    },
    { inputName, line }
  );
}

function pushLineToObs(line) {

  const now = Date.now();
  if (line === lastLineKey.key && now - lastLineKey.t < 800) return;
  lastLineKey = { key: line, t: now };

  obs.lastLine = line;
  sendSetText(obs.inputName || DEFAULTS.obsInputName, line);
}

function loadObsConfig() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    obs.host = cfg.obsHost || DEFAULTS.obsHost;
    obs.port = Number(cfg.obsPort) || DEFAULTS.obsPort;
    obs.passwordRaw = String(cfg.obsPassword ?? "");
    obs.passwordTrimmed = obs.passwordRaw.trim();
    obs.password = obs.passwordRaw;
    obs.triedTrimmedFallback = false;
    obs.inputName = (cfg.obsInputName || DEFAULTS.obsInputName).trim();
    obs.enabled = cfg.obsEnabled !== false;

    updateObsStatus({
      configuredHost: obs.host,
      configuredPort: obs.port,
      inputName: obs.inputName,
      passwordConfigured: obs.passwordRaw !== "",
      enabled: obs.enabled,
      lastError: "",
    });

    disconnectObsSocket();
    if (!obs.enabled) {
      setConnectionState("disabled", "Расширение отключено. Нажмите «Включить».", {
        lastError: "",
      });
      return;
    }
    connectObs();
  });
}

function handleSongMessage(message, sender) {
  if (!obs.enabled) return;
  if (message?.song == null) return;

  const tabId = sender.tab?.id;
  if (tabId == null) {
    updateObsStatus({ message: "Не удалось определить вкладку-источник трека." });
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      updateObsStatus({ message: "Не удалось получить состояние вкладки браузера." });
      return;
    }

    if (!tab?.audible) {
      updateObsStatus({ message: "Вкладка не воспроизводит звук. Обновление пропущено." });
      return;
    }

    const line = String(message.song).trim();
    if (!line) {
      updateObsStatus({ message: "Сайт вернул пустую строку трека." });
      return;
    }

    pushLineToObs(line);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (
    changes.obsHost ||
    changes.obsPort ||
    changes.obsPassword ||
    changes.obsInputName ||
    changes.obsEnabled
  ) {
    loadObsConfig();
  }
});

chrome.runtime.onInstalled.addListener(loadObsConfig);
chrome.runtime.onStartup.addListener(loadObsConfig);
persistObsStatus();
loadObsConfig();

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

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
      loadObsConfig();
      sendResponse({ ok: true });
    });
    return true;
  }

  handleSongMessage(message, sender);
});
