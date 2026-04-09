import { t } from "@/shared/i18n/core";

function normalizeState(state) {
  return String(state || "idle").trim().toLowerCase();
}

export function localizeConnectionState(state, locale) {
  const key = normalizeState(state);
  return t(`status.${key}`, locale, null, t("status.unknown", locale, null, "unknown"));
}

export function localizePlaybackState(state, locale) {
  const key = normalizeState(state);
  return t(`playbackState.${key}`, locale, null, key);
}

export function formatServiceStatus(service, status, locale) {
  const serviceKey = String(service || "").trim().toLowerCase();
  const serviceLabel = t(`services.${serviceKey}`, locale, null, serviceKey || "service");

  if (!status) {
    return `${serviceLabel}: ${t("status.noData", locale, null, "no data")}`;
  }

  const state = normalizeState(status.state);
  const message = String(status.message || "").trim();

  if (state === "disabled") {
    const disabledMessage = t(`statusMessages.${serviceKey}.disabled`, locale, null, "");
    if (disabledMessage) return `${serviceLabel}: ${disabledMessage}`;
  }

  if (message) {
    return `${serviceLabel}: ${message}`;
  }

  return `${serviceLabel}: ${localizeConnectionState(state, locale)}`;
}
