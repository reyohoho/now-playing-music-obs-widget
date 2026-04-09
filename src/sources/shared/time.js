export function parseClockToSec(raw) {
  const input = String(raw || "").trim();
  if (!input) return Number.NaN;

  const negative = input.startsWith("-");
  const token = negative ? input.slice(1) : input;
  const parts = token.split(":").map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return Number.NaN;

  let sec = 0;
  if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else return Number.NaN;

  return negative ? -sec : sec;
}

export function inferTimesFromText(text) {
  const matches = String(text || "").match(/-?\d{1,2}:\d{2}(?::\d{2})?/g) || [];
  if (!matches.length) return null;

  const nums = matches
    .map((token) => parseClockToSec(token))
    .filter((n) => Number.isFinite(n));

  if (!nums.length) return null;

  const neg = nums.find((n) => n < 0);
  const pos = nums.find((n) => n >= 0);
  if (Number.isFinite(neg) && Number.isFinite(pos)) {
    return {
      positionSec: pos,
      durationSec: pos + Math.abs(neg),
    };
  }

  const positives = nums.filter((n) => n >= 0).sort((a, b) => a - b);
  if (positives.length >= 2) {
    const positionSec = positives[0];
    const durationSec = positives[positives.length - 1];
    if (durationSec >= positionSec) {
      return { positionSec, durationSec };
    }
  }

  return null;
}
