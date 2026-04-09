import { clamp01 } from "@/sources/shared/number";

function resolveStorage(context) {
  return (context?.window || window)?.localStorage || null;
}

export function writePercentToLocalStorage(context, key, ratio) {
  const normalized = clamp01(ratio);
  if (!Number.isFinite(normalized)) return false;

  const storage = resolveStorage(context);
  if (!storage) return false;

  try {
    storage.setItem(key, String(Math.round(normalized * 100)));
    return true;
  } catch (_) {
    return false;
  }
}

export function readPercentFromLocalStorage(context, key) {
  const storage = resolveStorage(context);
  if (!storage) return Number.NaN;

  try {
    const raw = Number(storage.getItem(key));
    return Number.isFinite(raw) ? clamp01(raw / 100) : Number.NaN;
  } catch (_) {
    return Number.NaN;
  }
}
