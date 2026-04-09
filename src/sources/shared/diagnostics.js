export function emitDiagnostic(context, event, payload, options) {
  if (typeof context?.emitDiagnostic !== "function") return false;
  return context.emitDiagnostic(event, payload, options);
}

export async function dispatchWithControlDiagnostic({
  context,
  event,
  key,
  action,
  value,
  collectBefore,
  collectAfter,
  run,
  beforeField = "before",
  afterField = "after",
}) {
  const before = typeof collectBefore === "function" ? collectBefore() : undefined;
  const result = await run();
  if (result === null) return null;

  const payload = { action, value, result };
  if (before !== undefined) payload[beforeField] = before;
  if (typeof collectAfter === "function") payload[afterField] = collectAfter();

  emitDiagnostic(context, event, payload, key ? { key } : undefined);
  return result;
}
