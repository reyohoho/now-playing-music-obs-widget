import en from "@/shared/i18n/locales/en.json";
import ru from "@/shared/i18n/locales/ru.json";

const DICTS = {
  en,
  ru,
};

const DEFAULT_LOCALE = "en";

function normalizeLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase();
  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("ru")) return "ru";
  return DEFAULT_LOCALE;
}

function detectLocale(preferredLocale) {
  if (preferredLocale) return normalizeLocale(preferredLocale);

  if (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage) {
    return normalizeLocale(chrome.i18n.getUILanguage());
  }

  if (typeof navigator !== "undefined") {
    return normalizeLocale(navigator.language);
  }

  return DEFAULT_LOCALE;
}

function dictFor(locale) {
  const normalized = detectLocale(locale);
  return DICTS[normalized] || DICTS[DEFAULT_LOCALE];
}

function getByPath(obj, path, fallback = "") {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return fallback;
    current = current[part];
  }
  if (current === undefined || current === null) return fallback;
  return String(current);
}

function interpolate(template, params) {
  if (!params || typeof params !== "object") return String(template || "");
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (!(key in params)) return `{${key}}`;
    const value = params[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

export function resolveLocale(preferredLocale) {
  return detectLocale(preferredLocale);
}

export function t(path, locale, params, fallback = "") {
  const dict = dictFor(locale);
  const base = getByPath(dict, path, fallback || path);
  return interpolate(base, params);
}

export function createTranslator(locale) {
  const fixedLocale = resolveLocale(locale);
  return (path, params, fallback = "") => t(path, fixedLocale, params, fallback);
}
