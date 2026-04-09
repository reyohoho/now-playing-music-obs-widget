export function toFiniteOrNaN(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

export function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Number.NaN;
  return Math.max(0, Math.min(1, num));
}
