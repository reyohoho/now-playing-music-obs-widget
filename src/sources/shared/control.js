export function ok(path, extra = {}) {
  return {
    ok: true,
    ...(path ? { path } : {}),
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

export function fail(message, extra = {}) {
  return {
    ok: false,
    ...(message ? { message } : {}),
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

export function unsupported(action, extra = {}) {
  return fail(`${String(action || "action")} unsupported`, {
    reason: "unsupported",
    ...extra,
  });
}

export async function dispatchAction(action, handlers, ctx) {
  const handler = handlers?.[action];
  if (typeof handler !== "function") return null;
  return handler(ctx);
}
