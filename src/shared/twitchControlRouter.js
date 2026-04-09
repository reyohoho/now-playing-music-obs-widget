export const TWITCH_CONTROL_COMMAND_SPECS = {
  play: { action: "play", argType: "none", defaultAliases: ["play"] },
  pause: { action: "pause", argType: "none", defaultAliases: ["pause"] },
  next: { action: "next", argType: "none", defaultAliases: ["next", "skip"] },
  previous: {
    action: "previous",
    argType: "none",
    defaultAliases: ["previous", "prev", "back"],
  },
  seek: { action: "seek", argType: "seek", defaultAliases: ["seek"] },
  volume: { action: "volume", argType: "volume", defaultAliases: ["volume", "vol"] },
  np: { action: "announce", argType: "none", defaultAliases: ["np", "nowplaying"] },
};

export const TWITCH_CONTROL_COMMAND_ORDER = Object.keys(TWITCH_CONTROL_COMMAND_SPECS);
const ALLOWED_ACCESS_MODES = new Set(["roles", "users", "everyone"]);

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeString(value) {
  return String(value || "").trim();
}

export function normalizeStringList(input, options = {}) {
  const { lowercase = true } = options;
  const tokens = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[\n,]+/g)
        .map((chunk) => chunk.trim());

  const out = [];
  const seen = new Set();
  for (const raw of tokens) {
    const normalized = lowercase ? normalizeString(raw).toLowerCase() : normalizeString(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function createDefaultTwitchControlRouter() {
  const commands = {};
  for (const id of TWITCH_CONTROL_COMMAND_ORDER) {
    const spec = TWITCH_CONTROL_COMMAND_SPECS[id];
    commands[id] = {
      enabled: true,
      aliases: [...spec.defaultAliases],
      argType: spec.argType,
      allowedSourcesOverride: [],
      access: {
        mode: "roles",
        allowedRoles: ["broadcaster", "moderator"],
        allowedUsers: [],
        deniedUsers: [],
      },
    };
  }

  return {
    trigger: "!ww",
    rateLimit: {
      globalMs: 1200,
      perUserMs: 1200,
      perCommandMs: 800,
    },
    sources: {
      globalAllowed: [],
    },
    commands,
  };
}

function normalizeCommandConfig(commandId, raw, fallback) {
  const spec = TWITCH_CONTROL_COMMAND_SPECS[commandId];
  const aliases = normalizeStringList(raw?.aliases, { lowercase: true });
  const normalizedAliases = aliases.length ? aliases : [...spec.defaultAliases];
  if (!normalizedAliases.includes(commandId)) normalizedAliases.unshift(commandId);
  const access = raw?.access && typeof raw.access === "object" ? raw.access : {};
  const modeRaw = normalizeString(access.mode).toLowerCase();
  const mode = ALLOWED_ACCESS_MODES.has(modeRaw) ? modeRaw : fallback.access.mode;
  const hasExplicitAllowedRoles = Object.prototype.hasOwnProperty.call(access, "allowedRoles");
  const allowedRoles = normalizeStringList(access.allowedRoles, { lowercase: true });
  const normalizedAllowedRoles =
    hasExplicitAllowedRoles
      ? allowedRoles
      : [...fallback.access.allowedRoles];

  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : fallback.enabled,
    aliases: normalizedAliases,
    argType: spec.argType,
    allowedSourcesOverride: normalizeStringList(raw?.allowedSourcesOverride, {
      lowercase: true,
    }),
    access: {
      mode,
      allowedRoles: normalizedAllowedRoles,
      allowedUsers: normalizeStringList(access.allowedUsers, { lowercase: true }),
      deniedUsers: normalizeStringList(access.deniedUsers, { lowercase: true }),
    },
  };
}

export function normalizeTwitchControlRouter(input) {
  const defaults = createDefaultTwitchControlRouter();
  const source = input && typeof input === "object" ? input : {};
  const rateLimit =
    source.rateLimit && typeof source.rateLimit === "object" ? source.rateLimit : {};
  const sources = source.sources && typeof source.sources === "object" ? source.sources : {};
  const rawCommands = source.commands && typeof source.commands === "object" ? source.commands : {};

  const triggerCandidate = normalizeString(source.trigger);
  const trigger =
    triggerCandidate && !/\s/.test(triggerCandidate) ? triggerCandidate : defaults.trigger;

  const commands = {};
  for (const id of TWITCH_CONTROL_COMMAND_ORDER) {
    commands[id] = normalizeCommandConfig(id, rawCommands[id], defaults.commands[id]);
  }

  return {
    trigger,
    rateLimit: {
      globalMs: clampInt(rateLimit.globalMs, 0, 300000, defaults.rateLimit.globalMs),
      perUserMs: clampInt(rateLimit.perUserMs, 0, 300000, defaults.rateLimit.perUserMs),
      perCommandMs: clampInt(rateLimit.perCommandMs, 0, 300000, defaults.rateLimit.perCommandMs),
    },
    sources: {
      globalAllowed: normalizeStringList(sources.globalAllowed, { lowercase: true }),
    },
    commands,
  };
}

export function buildCommandAliasIndex(commands) {
  const aliasToCommand = new Map();
  const duplicates = [];

  for (const commandId of TWITCH_CONTROL_COMMAND_ORDER) {
    const command = commands?.[commandId];
    if (!command) continue;
    for (const alias of command.aliases || []) {
      const normalized = String(alias || "").trim().toLowerCase();
      if (!normalized) continue;

      const existing = aliasToCommand.get(normalized);
      if (existing && existing !== commandId) {
        duplicates.push({
          alias: normalized,
          commands: [existing, commandId],
        });
        continue;
      }
      aliasToCommand.set(normalized, commandId);
    }
  }

  return {
    aliasToCommand,
    duplicates,
  };
}
