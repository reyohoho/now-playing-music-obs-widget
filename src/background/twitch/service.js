import { renderTrackTemplate } from "@/core/template";
import { parseChatCommandV2 } from "@/background/twitch/commandParser";
import { TwitchIrcClient } from "@/background/twitch/ircClient";
import {
  checkRateLimit,
  createRateLimitState,
  resolveAccess,
  resolveSourceAccess,
} from "@/background/twitch/controlPolicy";
import { normalizeTwitchControlRouter } from "@/shared/twitchControlRouter";

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function trackKey(snapshot) {
  if (!snapshot) return "";
  return [
    snapshot.sourceId || "",
    snapshot.artist || "",
    snapshot.title || "",
    Math.floor(Number(snapshot.durationSec) || 0),
  ].join("|");
}

function normalizeSettings(twitch) {
  return {
    enabled: twitch?.enabled !== false,
    controlEnabled: Boolean(twitch?.controlEnabled),
    announceEnabled: Boolean(twitch?.announceEnabled),
    channel: String(twitch?.channel || "").replace(/^#/, "").trim(),
    controlRouter: normalizeTwitchControlRouter(twitch?.controlRouter),
    announceMinIntervalMs: clampInt(twitch?.announceMinIntervalMs, 1000, 600_000, 30_000),
    announceTemplate:
      String(twitch?.announceTemplate || "Now playing: {{artist}} - {{title}}") ||
      "Now playing: {{artist}} - {{title}}",
    oauthToken: String(twitch?.oauthToken || "").trim(),
    username: String(twitch?.username || "").trim(),
    clientId: String(twitch?.clientId || "").trim(),
  };
}

function buildTwitchAuthUrl({ clientId, redirectUri, state, scope }) {
  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope || "chat:read chat:write");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("force_verify", "true");
  return authUrl.toString();
}

async function launchOAuthFlow(authUrl) {
  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: String(chrome.runtime.lastError.message || "OAuth flow failed"),
          });
          return;
        }
        resolve({
          ok: true,
          responseUrl: String(responseUrl || ""),
        });
      }
    );
  });
}

export class TwitchService {
  constructor({ onStatus, onLog, onControl, getActiveSnapshot, patchSettings }) {
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.onControl = onControl;
    this.getActiveSnapshot = getActiveSnapshot;
    this.patchSettings = patchSettings;

    this.settings = normalizeSettings({});
    this.logs = [];
    this.rateLimitState = createRateLimitState();
    this.lastAnnounceAt = 0;
    this.lastAnnouncedTrackKey = "";
    this.latestSnapshot = null;

    this.client = new TwitchIrcClient({
      onStatus: (status) => this.handleClientStatus(status),
      onPrivmsg: (message) => {
        void this.handlePrivmsg(message);
      },
    });
  }

  pushLog(level, text, meta = {}) {
    const entry = {
      at: Date.now(),
      level,
      text,
      ...meta,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 30) this.logs.length = 30;
    this.onLog(this.logs);
  }

  handleClientStatus(status) {
    this.onStatus(status);
  }

  updateSettings(twitchSettings) {
    this.settings = normalizeSettings(twitchSettings);
    this.rateLimitState = createRateLimitState();

    const enabled =
      this.settings.enabled &&
      (this.settings.controlEnabled || this.settings.announceEnabled);
    this.client.connect({
      enabled,
      channel: this.settings.channel,
      username: this.settings.username,
      oauthToken: this.settings.oauthToken,
    });
  }

  reconnect() {
    this.client.connect({
      enabled:
        this.settings.enabled &&
        (this.settings.controlEnabled || this.settings.announceEnabled),
      channel: this.settings.channel,
      username: this.settings.username,
      oauthToken: this.settings.oauthToken,
    });
  }

  buildAnnounceLine(snapshot) {
    const line = renderTrackTemplate(this.settings.announceTemplate, snapshot || {});
    return String(line || "").replace(/\s+/g, " ").trim();
  }

  canAnnounceTrack(snapshot, force = false, allowWhenDisabled = false) {
    if (!this.settings.enabled) return false;
    if (!allowWhenDisabled && !this.settings.announceEnabled) return false;
    if (!snapshot?.title && !snapshot?.artist) return false;

    const now = Date.now();
    if (!force && now - this.lastAnnounceAt < this.settings.announceMinIntervalMs) return false;

    const nextKey = trackKey(snapshot);
    if (!force && nextKey && nextKey === this.lastAnnouncedTrackKey) return false;

    return true;
  }

  announceSnapshot(snapshot, reason = "track-change", force = false, allowWhenDisabled = false) {
    if (!this.canAnnounceTrack(snapshot, force, allowWhenDisabled)) return false;

    const line = this.buildAnnounceLine(snapshot);
    if (!line) return false;

    if (!this.client.sendChat(line)) {
      // Prevent retry storms when socket/permissions are broken.
      this.lastAnnounceAt = Date.now();
      this.pushLog("error", "Не удалось отправить announce в Twitch.", { reason });
      return false;
    }

    this.lastAnnounceAt = Date.now();
    this.lastAnnouncedTrackKey = trackKey(snapshot);
    this.pushLog("info", `Announce отправлен (${reason}).`);
    return true;
  }

  async handlePrivmsg(message) {
    if (!this.settings.enabled) return;

    const rawText = String(message?.text || "").trim();
    const trigger = String(this.settings.controlRouter?.trigger || "!ww");
    const isTriggered = rawText.startsWith(trigger);
    if (isTriggered) {
      this.pushLog(
        "info",
        `Получена команда-кандидат: ${rawText} (${message.user}, roles: ${(message.roles || []).join(",") || "none"})`
      );
    }

    const parsed = parseChatCommandV2(message.text, this.settings.controlRouter);
    if (!parsed) {
      if (isTriggered) {
        this.pushLog("warn", `parse_failed: unknown_command (${rawText})`);
      }
      return;
    }

    if (parsed.type === "invalid") {
      this.pushLog("warn", `parse_failed: ${parsed.reason} (${rawText})`);
      return;
    }

    const canonicalCommand = parsed.canonicalCommand;
    const commandConfig = this.settings.controlRouter?.commands?.[canonicalCommand];
    if (!commandConfig?.enabled) {
      this.pushLog("warn", `command_disabled: ${canonicalCommand}`);
      return;
    }

    const access = resolveAccess(message.user, message.roles, commandConfig?.access);
    if (!access.ok) {
      this.pushLog("warn", `${access.reason}: ${canonicalCommand} (${message.user})`);
      return;
    }

    let activeSnapshot = null;
    if (parsed.action === "announce") {
      activeSnapshot = this.getActiveSnapshot();
    } else {
      if (!this.settings.controlEnabled) {
        this.pushLog("warn", `command_disabled: control (${canonicalCommand})`);
        return;
      }

      activeSnapshot = this.getActiveSnapshot();
      const sourceAccess = resolveSourceAccess(
        activeSnapshot?.sourceId,
        this.settings.controlRouter,
        canonicalCommand
      );
      if (!sourceAccess.ok) {
        this.pushLog(
          "warn",
          `source_denied: ${canonicalCommand} (${activeSnapshot?.sourceId || "none"})`
        );
        return;
      }
    }

    const rate = checkRateLimit(this.rateLimitState, {
      user: message.user,
      canonicalCommand,
      rateLimit: this.settings.controlRouter?.rateLimit,
    });
    if (!rate.ok) {
      this.pushLog("warn", `rate_limited: ${canonicalCommand} (${message.user})`);
      return;
    }

    if (parsed.action === "announce") {
      this.announceSnapshot(activeSnapshot, "chat-command", true, true);
      return;
    }

    const result = await this.onControl(parsed.action, parsed.value, {
      user: message.user,
      command: canonicalCommand,
      sourceId: activeSnapshot?.sourceId || "",
    });

    if (result?.ok) {
      this.pushLog(
        "info",
        `Команда ${canonicalCommand} выполнена (${message.user}, ${activeSnapshot?.sourceId || "no-source"}).`
      );
    } else if (String(result?.reason || "") === "unsupported") {
      this.pushLog(
        "warn",
        `unsupported: ${canonicalCommand} (${activeSnapshot?.sourceId || "none"}, ${result?.unsupportedReason || "unknown"})`
      );
    } else {
      this.pushLog(
        "error",
        `Ошибка выполнения ${canonicalCommand}: ${result?.message || "unknown"}`
      );
    }
  }

  onSnapshot(snapshot) {
    if (!this.settings.enabled) return;
    this.latestSnapshot = snapshot || null;
    this.announceSnapshot(this.latestSnapshot, "track-change", false);
  }

  async startAuthFlow() {
    if (!chrome.identity?.launchWebAuthFlow) {
      return { ok: false, message: "API chrome.identity недоступен." };
    }

    if (!this.settings.clientId) {
      return { ok: false, message: "Укажите Twitch Client ID в настройках." };
    }

    const state = Math.random().toString(36).slice(2);
    const scopeCandidates = [
      "chat:read chat:write",
      "chat:read chat:edit",
    ];
    const redirectUriCandidates = [
      chrome.identity.getRedirectURL("twitch"),
      chrome.identity.getRedirectURL("twitch/"),
      chrome.identity.getRedirectURL(),
    ].filter(Boolean);
    const uniqueRedirectCandidates = [...new Set(redirectUriCandidates)];

    let redirectedUrl = "";
    let lastFlowError = "";
    for (const redirectUri of uniqueRedirectCandidates) {
      for (const scope of scopeCandidates) {
        const authUrl = buildTwitchAuthUrl({
          clientId: this.settings.clientId,
          redirectUri,
          state,
          scope,
        });

        const flowResult = await launchOAuthFlow(authUrl);
        if (flowResult.ok) {
          redirectedUrl = flowResult.responseUrl;
          break;
        }

        lastFlowError = flowResult.error || "";

        // If user explicitly canceled/denied, stop immediately.
        if (/did not approve access|user denied/i.test(lastFlowError)) {
          return { ok: false, message: lastFlowError };
        }

        // On "Authorization page couldn't be loaded", try next scope/redirect combo.
        if (/authorization page.*(couldn't|could not) be loaded/i.test(lastFlowError)) {
          continue;
        }

        // Any other OAuth flow error is likely definitive for this attempt.
        break;
      }
      if (redirectedUrl) break;
    }

    if (!redirectedUrl || typeof redirectedUrl !== "string") {
      const redirectHint = uniqueRedirectCandidates.join(", ");
      return {
        ok: false,
        message:
          `${lastFlowError || "Не удалось завершить OAuth авторизацию Twitch."} ` +
          `Проверьте OAuth Redirect URL в Twitch App: ${redirectHint}`,
      };
    }

    const hash = redirectedUrl.includes("#")
      ? redirectedUrl.slice(redirectedUrl.indexOf("#") + 1)
      : "";
    const query = redirectedUrl.includes("?")
      ? redirectedUrl.slice(redirectedUrl.indexOf("?") + 1).split("#")[0]
      : "";
    const params = hash ? new URLSearchParams(hash) : new URLSearchParams(query);

    const returnedState = params.get("state");
    if (returnedState && returnedState !== state) {
      return { ok: false, message: "OAuth state mismatch." };
    }

    const accessToken = params.get("access_token");
    if (!accessToken) {
      const err = params.get("error_description") || params.get("error") || "access_token missing";
      return { ok: false, message: `OAuth error: ${err}` };
    }

    const validateResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => null);

    if (!validateResponse?.ok) {
      return { ok: false, message: "Токен получен, но validate запрос к Twitch не прошел." };
    }

    const profile = await validateResponse.json().catch(() => null);
    const login = String(profile?.login || "").trim();

    await this.patchSettings({
      twitch: {
        oauthToken: accessToken,
        username: login,
      },
    });

    this.pushLog("info", "OAuth авторизация Twitch успешно завершена.");
    return { ok: true, username: login };
  }
}
