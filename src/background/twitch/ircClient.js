function decodeTagValue(value) {
  return String(value || "")
    .replace(/\\s/g, " ")
    .replace(/\\:/g, ";")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\");
}

function parseTags(rawTags) {
  const result = {};
  if (!rawTags) return result;

  for (const pair of rawTags.split(";")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) {
      result[pair] = "";
      continue;
    }
    const key = pair.slice(0, idx);
    const value = decodeTagValue(pair.slice(idx + 1));
    result[key] = value;
  }

  return result;
}

function parseIrcLine(line) {
  let rest = String(line || "");
  if (!rest) return null;

  let tags = {};
  if (rest.startsWith("@")) {
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) return null;
    tags = parseTags(rest.slice(1, spaceIdx));
    rest = rest.slice(spaceIdx + 1);
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) return null;
    prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
  }

  let trailing = "";
  const trailingIdx = rest.indexOf(" :");
  if (trailingIdx >= 0) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const command = parts[0];
  const params = parts.slice(1);
  return { tags, prefix, command, params, trailing };
}

function parseUserFromPrefix(prefix) {
  const raw = String(prefix || "");
  const excl = raw.indexOf("!");
  if (excl === -1) return raw.toLowerCase();
  return raw.slice(0, excl).toLowerCase();
}

function parseRolesFromTags(tags) {
  const roles = new Set();
  const badges = String(tags.badges || "")
    .split(",")
    .map((badge) => badge.split("/")[0].trim())
    .filter(Boolean);

  for (const badge of badges) {
    roles.add(badge);
  }

  if (tags.mod === "1") roles.add("moderator");
  if (tags.subscriber === "1") roles.add("subscriber");
  if (tags.vip === "1") roles.add("vip");
  if (!roles.size) roles.add("viewer");

  return [...roles];
}

export class TwitchIrcClient {
  constructor({ onStatus, onPrivmsg }) {
    this.onStatus = onStatus;
    this.onPrivmsg = onPrivmsg;
    this.ws = null;
    this.settings = null;
    this.reconnectTimer = null;
    this.closedByUser = false;
  }

  status(state, message, lastError = "") {
    this.onStatus({
      state,
      message,
      lastError,
      updatedAt: Date.now(),
    });
  }

  sendRaw(line) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(`${line}\r\n`);
      return true;
    } catch (_) {
      return false;
    }
  }

  sendChat(text) {
    const channel = this.settings?.channel?.toLowerCase();
    if (!channel) return false;
    const payload = String(text || "").replace(/\s+/g, " ").trim();
    if (!payload) return false;
    return this.sendRaw(`PRIVMSG #${channel} :${payload}`);
  }

  clearReconnect() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  scheduleReconnect() {
    if (this.closedByUser) return;
    if (!this.settings?.enabled) return;
    if (this.reconnectTimer) return;

    this.status("connecting", "Повторное подключение к Twitch IRC через 4 сек.");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.settings);
    }, 4000);
  }

  disconnect() {
    this.closedByUser = true;
    this.clearReconnect();

    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.close();
    this.ws = null;
  }

  connect(settings) {
    this.settings = {
      enabled: Boolean(settings?.enabled),
      channel: String(settings?.channel || "").replace(/^#/, "").trim(),
      username: String(settings?.username || "").trim(),
      oauthToken: String(settings?.oauthToken || "").replace(/^oauth:/i, "").trim(),
    };

    this.closedByUser = false;
    this.clearReconnect();

    if (!this.settings.enabled) {
      this.disconnect();
      this.status("disabled", "Twitch интеграция выключена.");
      return;
    }

    if (!this.settings.channel || !this.settings.username || !this.settings.oauthToken) {
      this.disconnect();
      this.status(
        "error",
        "Заполните Twitch channel, username и OAuth token.",
        "Missing twitch credentials"
      );
      return;
    }

    this.disconnect();
    this.closedByUser = false;

    this.status("connecting", "Подключение к Twitch IRC...");

    try {
      this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    } catch (error) {
      this.status("error", "Не удалось открыть Twitch IRC сокет.", String(error));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.status("connecting", "Twitch IRC сокет открыт, выполняю авторизацию...");
      this.sendRaw("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
      this.sendRaw(`PASS oauth:${this.settings.oauthToken}`);
      this.sendRaw(`NICK ${this.settings.username}`);
      this.sendRaw(`JOIN #${this.settings.channel}`);
    };

    this.ws.onerror = () => {
      this.status("error", "Ошибка Twitch IRC сокета.", "Socket error");
    };

    this.ws.onclose = (event) => {
      this.ws = null;
      const reason = event?.reason ? `: ${event.reason}` : "";
      const msg = `Twitch IRC отключен (код ${event?.code ?? "?"}${reason}).`;
      this.status("disconnected", msg, msg);
      this.scheduleReconnect();
    };

    this.ws.onmessage = (event) => {
      const raw = String(event.data || "");
      for (const line of raw.split("\r\n")) {
        if (!line) continue;
        const parsed = parseIrcLine(line);
        if (!parsed) continue;

        if (parsed.command === "PING") {
          this.sendRaw(`PONG :${parsed.trailing || "tmi.twitch.tv"}`);
          continue;
        }

        if (parsed.command === "NOTICE") {
          const text = parsed.trailing || "";
          this.status("error", `Twitch NOTICE: ${text}`, text);
          continue;
        }

        if (parsed.command === "001") {
          this.status("connected", `Подключено к Twitch каналу #${this.settings.channel}.`);
          continue;
        }

        if (parsed.command !== "PRIVMSG") continue;

        this.onPrivmsg({
          user: parseUserFromPrefix(parsed.prefix),
          channel: String(parsed.params?.[0] || "").replace(/^#/, ""),
          text: parsed.trailing || "",
          roles: parseRolesFromTags(parsed.tags),
          tags: parsed.tags,
          raw: line,
        });
      }
    };
  }
}
