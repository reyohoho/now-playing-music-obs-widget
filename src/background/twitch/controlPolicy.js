function toSet(value) {
  if (Array.isArray(value)) {
    return new Set(
      value
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    );
  }
  return new Set();
}

function normalizeUser(user) {
  return String(user || "").trim().toLowerCase();
}

export function resolveAccess(messageUser, roles, accessConfig) {
  const user = normalizeUser(messageUser);
  const deniedUsers = toSet(accessConfig?.deniedUsers);
  if (user && deniedUsers.has(user)) {
    return { ok: false, reason: "access_denied" };
  }

  const mode = String(accessConfig?.mode || "roles").toLowerCase();
  if (mode === "everyone") return { ok: true, reason: "" };

  if (mode === "users") {
    const allowedUsers = toSet(accessConfig?.allowedUsers);
    if (allowedUsers.has(user)) return { ok: true, reason: "" };
    return { ok: false, reason: "access_denied" };
  }

  const allowedRoles = toSet(accessConfig?.allowedRoles);
  const userRoles = new Set(
    (Array.isArray(roles) ? roles : [])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );

  for (const role of userRoles) {
    if (allowedRoles.has(role)) return { ok: true, reason: "" };
  }
  return { ok: false, reason: "access_denied" };
}

function effectiveAllowedSources(controlRouter, canonicalCommand) {
  const globalAllowed = toSet(controlRouter?.sources?.globalAllowed);
  const overrideAllowed = toSet(
    controlRouter?.commands?.[canonicalCommand]?.allowedSourcesOverride
  );

  if (!globalAllowed.size && !overrideAllowed.size) return null;
  if (!globalAllowed.size) return overrideAllowed;
  if (!overrideAllowed.size) return globalAllowed;

  const intersection = new Set();
  for (const sourceId of overrideAllowed) {
    if (globalAllowed.has(sourceId)) intersection.add(sourceId);
  }
  return intersection;
}

export function resolveSourceAccess(sourceId, controlRouter, canonicalCommand) {
  const allowed = effectiveAllowedSources(controlRouter, canonicalCommand);
  if (!allowed) return { ok: true, reason: "" };
  if (!allowed.size) return { ok: false, reason: "source_denied" };

  const normalized = String(sourceId || "").trim().toLowerCase();
  if (!normalized) return { ok: false, reason: "source_denied" };
  return allowed.has(normalized)
    ? { ok: true, reason: "" }
    : { ok: false, reason: "source_denied" };
}

function clampMs(value, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

export function createRateLimitState() {
  return {
    lastGlobalAt: 0,
    lastByUser: new Map(),
    lastByCommand: new Map(),
  };
}

export function checkRateLimit(
  state,
  { user, canonicalCommand, rateLimit, now = Date.now() }
) {
  const globalMs = clampMs(rateLimit?.globalMs, 1200);
  const perUserMs = clampMs(rateLimit?.perUserMs, 1200);
  const perCommandMs = clampMs(rateLimit?.perCommandMs, 800);

  const normalizedUser = normalizeUser(user) || "_anonymous_";
  const commandKey = String(canonicalCommand || "").trim().toLowerCase() || "_unknown_";

  if (globalMs > 0) {
    const elapsed = now - Number(state.lastGlobalAt || 0);
    if (elapsed < globalMs) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterMs: globalMs - elapsed,
      };
    }
  }

  if (perUserMs > 0) {
    const elapsed = now - Number(state.lastByUser.get(normalizedUser) || 0);
    if (elapsed < perUserMs) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterMs: perUserMs - elapsed,
      };
    }
  }

  if (perCommandMs > 0) {
    const elapsed = now - Number(state.lastByCommand.get(commandKey) || 0);
    if (elapsed < perCommandMs) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterMs: perCommandMs - elapsed,
      };
    }
  }

  state.lastGlobalAt = now;
  state.lastByUser.set(normalizedUser, now);
  state.lastByCommand.set(commandKey, now);
  return { ok: true, reason: "", retryAfterMs: 0 };
}
