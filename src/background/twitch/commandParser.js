import {
  TWITCH_CONTROL_COMMAND_SPECS,
  buildCommandAliasIndex,
  normalizeTwitchControlRouter,
} from "@/shared/twitchControlRouter";

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

function sanitizeToken(value) {
  return String(value || "").replace(INVISIBLE_CHARS_RE, "");
}

function parseClockToken(token) {
  if (!token) return Number.NaN;
  const normalized = sanitizeToken(token).trim();
  if (!normalized) return Number.NaN;

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const parts = normalized.split(":").map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return Number.NaN;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return Number.NaN;
}

export function parseChatCommandV2(text, config = {}) {
  const router = normalizeTwitchControlRouter(config);
  const trigger = String(router.trigger || "!ww");
  const input = sanitizeToken(text).trim();
  if (!input || !input.startsWith(trigger)) return null;

  const rawBody = sanitizeToken(input.slice(trigger.length));
  if (!rawBody || !rawBody.trim()) {
    return {
      type: "command",
      canonicalCommand: "np",
      commandAlias: "",
      action: TWITCH_CONTROL_COMMAND_SPECS.np.action,
      value: undefined,
    };
  }

  const body = sanitizeToken(rawBody).trim();
  if (!body) {
    return { type: "invalid", reason: "command_missing", errors: ["command_missing"] };
  }

  const { aliasToCommand } = buildCommandAliasIndex(router.commands);
  const tokens = body
    .split(/\s+/u)
    .map((token) => sanitizeToken(token).trim())
    .filter(Boolean);
  const rawAlias = String(tokens[0] || "").toLowerCase();
  const canonicalCommand = aliasToCommand.get(rawAlias);
  if (!canonicalCommand) {
    return { type: "invalid", reason: "unknown_command", errors: ["unknown_command"] };
  }

  const spec = TWITCH_CONTROL_COMMAND_SPECS[canonicalCommand];
  if (!spec) {
    return { type: "invalid", reason: "unknown_command", errors: ["unknown_command"] };
  }

  if (spec.argType === "none") {
    if (tokens.length > 1) {
      return {
        type: "invalid",
        canonicalCommand,
        commandAlias: rawAlias,
        reason: "unexpected_argument",
        errors: ["unexpected_argument"],
      };
    }
    return {
      type: "command",
      canonicalCommand,
      commandAlias: rawAlias,
      action: spec.action,
      value: undefined,
    };
  }

  if (spec.argType === "seek") {
    if (tokens.length !== 2) {
      return {
        type: "invalid",
        canonicalCommand,
        commandAlias: rawAlias,
        reason: "seek_value",
        errors: ["seek_value"],
      };
    }
    const value = parseClockToken(tokens[1]);
    if (!Number.isFinite(value) || value < 0) {
      return {
        type: "invalid",
        canonicalCommand,
        commandAlias: rawAlias,
        reason: "seek_value",
        errors: ["seek_value"],
      };
    }
    return {
      type: "command",
      canonicalCommand,
      commandAlias: rawAlias,
      action: spec.action,
      value,
    };
  }

  if (spec.argType === "volume") {
    if (tokens.length !== 2) {
      return {
        type: "invalid",
        canonicalCommand,
        commandAlias: rawAlias,
        reason: "volume_value",
        errors: ["volume_value"],
      };
    }
    const value = Number(tokens[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return {
        type: "invalid",
        canonicalCommand,
        commandAlias: rawAlias,
        reason: "volume_value",
        errors: ["volume_value"],
      };
    }
    return {
      type: "command",
      canonicalCommand,
      commandAlias: rawAlias,
      action: spec.action,
      value: Math.max(0, Math.min(1, value / 100)),
    };
  }

  return { type: "invalid", reason: "unknown_command", errors: ["unknown_command"] };
}

export function parseChatCommand(text, options = {}) {
  return parseChatCommandV2(text, options);
}
