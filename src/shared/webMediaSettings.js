export const WEB_MEDIA_SOURCE_ID = "web-media";
export const SOURCE_MIN_DURATION_SEC_DISABLED = 0;
export const SOURCE_MIN_DURATION_SEC_MIN = 0;
export const SOURCE_MIN_DURATION_SEC_MAX = 600;
export const WEB_MEDIA_MIN_DURATION_SEC_DEFAULT = 40;
export const WEB_MEDIA_MIN_DURATION_SEC_MIN = SOURCE_MIN_DURATION_SEC_MIN;
export const WEB_MEDIA_MIN_DURATION_SEC_MAX = SOURCE_MIN_DURATION_SEC_MAX;

export function normalizeSourceMinDurationSec(
  value,
  fallback = SOURCE_MIN_DURATION_SEC_DISABLED
) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.min(
        SOURCE_MIN_DURATION_SEC_MAX,
        Math.max(SOURCE_MIN_DURATION_SEC_MIN, Math.round(fallbackNumber))
      )
    : SOURCE_MIN_DURATION_SEC_DISABLED;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.min(
    SOURCE_MIN_DURATION_SEC_MAX,
    Math.max(SOURCE_MIN_DURATION_SEC_MIN, Math.round(parsed))
  );
}

export function normalizeWebMediaMinDurationSec(
  value,
  fallback = WEB_MEDIA_MIN_DURATION_SEC_DEFAULT
) {
  return normalizeSourceMinDurationSec(value, fallback);
}

export function defaultSourceMinDurationSecMap(sourceIds = []) {
  const ids = Array.isArray(sourceIds) ? sourceIds : [];
  const map = {};
  for (const sourceIdRaw of ids) {
    const sourceId = String(sourceIdRaw || "").trim().toLowerCase();
    if (!sourceId) continue;
    map[sourceId] = SOURCE_MIN_DURATION_SEC_DISABLED;
  }
  if (Object.prototype.hasOwnProperty.call(map, WEB_MEDIA_SOURCE_ID)) {
    map[WEB_MEDIA_SOURCE_ID] = WEB_MEDIA_MIN_DURATION_SEC_DEFAULT;
  }
  return map;
}
