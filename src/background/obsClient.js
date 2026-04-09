import { buildObsBrowserEventPayload, buildObsTextPayload } from "@/background/obsPayload";

const CLOSE_CODE = {
  AUTH_FAILED: 4009,
  UNSUPPORTED_RPC: 4010,
  ABNORMAL: 1006,
};

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function buildObsAuthString(password, salt, challenge) {
  const enc = new TextEncoder();
  const secretBuf = await crypto.subtle.digest("SHA-256", enc.encode(password + salt));
  const secretB64 = bytesToBase64(secretBuf);
  const authBuf = await crypto.subtle.digest("SHA-256", enc.encode(secretB64 + challenge));
  return bytesToBase64(authBuf);
}

function closeHint(code) {
  if (code === CLOSE_CODE.AUTH_FAILED) return "Ошибка авторизации OBS (проверь пароль).";
  if (code === CLOSE_CODE.UNSUPPORTED_RPC) return "Неподдерживаемая версия RPC протокола OBS.";
  if (code === CLOSE_CODE.ABNORMAL) return "Сокет оборван (OBS/порт/firewall).";
  return "";
}

function isAuthClose(event) {
  if (!event) return false;
  if (event.code === CLOSE_CODE.AUTH_FAILED) return true;
  return /auth|identif/i.test(String(event.reason || ""));
}

export class ObsClient {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.settings = null;
    this.ws = null;
    this.identified = false;
    this.req = 0;
    this.reconnectTimer = null;
    this.lastText = "";
    this.lastEventFingerprint = "";
    this.pending = new Map();
    this.passwordRaw = "";
    this.password = "";
    this.passwordTrimmed = "";
    this.triedTrimmedFallback = false;
  }

  status(state, message, lastError = "") {
    this.onStatus({
      state,
      message,
      lastError,
      updatedAt: Date.now(),
    });
  }

  updateSettings(settings) {
    this.passwordRaw = String(settings?.password || "");
    this.passwordTrimmed = this.passwordRaw.trim();
    this.password = this.passwordRaw;
    this.triedTrimmedFallback = false;

    this.settings = {
      enabled: Boolean(settings?.enabled),
      host: settings?.host || "127.0.0.1",
      port: Number(settings?.port) || 4455,
      textSourceName: settings?.textSourceName || "NowPlaying",
      browserEventEnabled: settings?.browserEventEnabled !== false,
      browserEventName: settings?.browserEventName || "nowplaying:update",
    };

    this.disconnect();
    if (this.settings.enabled) this.connect();
    else this.status("disabled", "OBS интеграция выключена.");
  }

  reconnect() {
    this.disconnect();
    if (this.settings?.enabled) this.connect();
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.pending.clear();
    this.identified = false;
    if (!this.ws) return;

    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.close();
    this.ws = null;
  }

  scheduleReconnect() {
    if (!this.settings?.enabled || this.reconnectTimer) return;
    this.status(
      "connecting",
      `Повторное подключение к ws://${this.settings.host}:${this.settings.port} через 4 сек.`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 4000);
  }

  async onHello(payload) {
    const auth = payload?.authentication;
    const identify = {
      rpcVersion: Number(payload?.rpcVersion) || 1,
      eventSubscriptions: 0,
    };

    if (auth?.challenge && auth?.salt) {
      if (!this.password) {
        this.status("error", "OBS требует пароль, но он пустой.", "Authentication failed");
        this.disconnect();
        this.scheduleReconnect();
        return;
      }

      try {
        identify.authentication = await buildObsAuthString(
          this.password,
          auth.salt,
          auth.challenge
        );
      } catch (_) {
        this.status("error", "Не удалось вычислить токен OBS.", "Auth token error");
        this.disconnect();
        this.scheduleReconnect();
        return;
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 1, d: identify }));
    }
  }

  tryTrimmedPasswordFallback(event) {
    if (!isAuthClose(event)) return false;
    if (this.triedTrimmedFallback) return false;
    if (!this.passwordTrimmed || this.passwordTrimmed === this.passwordRaw) return false;

    this.triedTrimmedFallback = true;
    this.password = this.passwordTrimmed;
    this.status("connecting", "Повторяю авторизацию с паролем без пробелов по краям.");
    this.connect();
    return true;
  }

  connect() {
    if (!this.settings?.enabled) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = `ws://${this.settings.host}:${this.settings.port}`;
    this.status("connecting", `Подключение к ${url}...`);

    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      this.status("error", `Не удалось открыть сокет ${url}.`, String(error));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.identified = false;
      this.status("connecting", "WebSocket открыт, ожидаю идентификацию OBS...");
    };

    this.ws.onclose = (event) => {
      this.identified = false;
      this.ws = null;
      this.pending.clear();

      const reason = event?.reason ? `: ${event.reason}` : "";
      const hint = closeHint(event?.code);
      const msg = `Соединение закрыто (код ${event?.code ?? "?"}${reason}).${
        hint ? ` ${hint}` : ""
      }`;

      this.status(isAuthClose(event) ? "error" : "disconnected", msg, msg);
      if (this.tryTrimmedPasswordFallback(event)) return;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.status("error", "Ошибка WebSocket при работе с OBS.", "Socket error");
    };

    this.ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (msg.op === 0) {
        await this.onHello(msg.d);
        return;
      }

      if (msg.op === 2) {
        this.identified = true;
        this.status("connected", "Подключено к OBS.");
        return;
      }

      if (msg.op !== 7) return;

      const data = msg.d || {};
      if (data.requestId != null) this.pending.delete(data.requestId);

      if (data.requestStatus?.result === false) {
        const details = data.requestStatus?.comment || `code=${data.requestStatus?.code ?? "?"}`;
        this.status("error", `OBS отклонил команду: ${details}`, details);
      }
    };
  }

  sendRequest(requestType, requestData, metaKey = "") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.identified) {
      this.connect();
      return false;
    }

    const requestId = String(++this.req);
    this.pending.set(requestId, { requestType, metaKey });

    try {
      this.ws.send(
        JSON.stringify({
          op: 6,
          d: {
            requestType,
            requestId,
            requestData,
          },
        })
      );
      return true;
    } catch (error) {
      this.pending.delete(requestId);
      this.status("error", `Ошибка отправки ${requestType}.`, String(error));
      this.scheduleReconnect();
      return false;
    }
  }

  pushText(renderedLine) {
    const line = String(renderedLine || "").trim();
    if (!line) return;
    if (line === this.lastText) return;
    this.lastText = line;

    this.sendRequest(
      "SetInputSettings",
      buildObsTextPayload(this.settings.textSourceName, line),
      `text:${line}`
    );
  }

  pushBrowserEvent(snapshot, extra) {
    if (!this.settings.browserEventEnabled) return;

    const requestData = buildObsBrowserEventPayload(
      this.settings.browserEventName,
      snapshot,
      extra
    );
    const fingerprint = JSON.stringify(requestData.requestData.event_data);
    if (fingerprint === this.lastEventFingerprint) return;
    this.lastEventFingerprint = fingerprint;

    this.sendRequest("CallVendorRequest", requestData, `event:${requestData.requestData.event_name}`);
  }

  pushTrack(snapshot, renderedLine, extra) {
    if (!this.settings?.enabled) return;
    this.pushText(renderedLine);
    this.pushBrowserEvent(snapshot, extra);
  }
}
