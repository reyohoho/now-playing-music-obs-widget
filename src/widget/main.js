import coverFallbackDarkUrl from "@/assets/cover-fallback-dark.png";
import coverFallbackLightUrl from "@/assets/cover-fallback-light.png";

const $ = (id) => document.getElementById(id);
const ACTIVE_SNAPSHOT_STORAGE_KEY = "nowPlayingActiveSnapshot";
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const WIDGET_LAYOUT_DEFAULTS = Object.freeze({
  showCover: true,
  seekWidth: "15%",
});
const WIDGET_QUERY_PARAMS = Object.freeze({
  event: "event",
  hideCover: "hideCover",
  seekWidth: "seekWidth",
});

const ui = {
  widget: $("widget"),
  cover: $("cover"),
  title: $("title"),
  artist: $("artist"),
  time: $("time"),
  progress: $("progress"),
  customCssSlot: $("customCssSlot"),
};

const params = new URLSearchParams(location.search);
const eventName = params.get(WIDGET_QUERY_PARAMS.event) || "nowplaying:update";
let currentSnapshot = null;
let themeAppearance = "system";
let uiLocale = "en";
const widgetLayoutConfig = resolveWidgetLayoutConfig(params);

function normalizeAppearance(value) {
  const normalized = String(value || "system").trim().toLowerCase();
  if (normalized === "light" || normalized === "dark" || normalized === "system") return normalized;
  return "system";
}

function resolveCoverFallbackUrl() {
  const appearance = normalizeAppearance(themeAppearance);
  if (appearance === "light") return coverFallbackLightUrl;
  if (appearance === "dark") return coverFallbackDarkUrl;
  const isDark = window.matchMedia?.(COLOR_SCHEME_QUERY)?.matches === true;
  return isDark ? coverFallbackDarkUrl : coverFallbackLightUrl;
}

function normalizeUiLocale(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ru" || normalized.startsWith("ru")) return "ru";
  if (normalized === "en" || normalized.startsWith("en")) return "en";
  const browserLocale = String(navigator.language || "").trim().toLowerCase();
  if (browserLocale.startsWith("ru")) return "ru";
  return "en";
}

function resolveLiveLabel() {
  return normalizeUiLocale(uiLocale) === "ru" ? "Эфир" : "Live";
}

function parseBooleanParam(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeSeekWidth(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${Math.max(0, Number(raw))}px`;
  if (/^\d+(\.\d+)?(px|%)$/.test(raw)) return raw;
  return fallback;
}

function resolveWidgetLayoutConfig(searchParams) {
  const hideCover = parseBooleanParam(searchParams.get(WIDGET_QUERY_PARAMS.hideCover), false);
  return {
    showCover: hideCover ? false : WIDGET_LAYOUT_DEFAULTS.showCover,
    seekWidth: normalizeSeekWidth(searchParams.get(WIDGET_QUERY_PARAMS.seekWidth), WIDGET_LAYOUT_DEFAULTS.seekWidth),
  };
}

function applyWidgetLayoutConfig(config) {
  ui.widget.classList.toggle("widget--cover-hidden", !config.showCover);
  ui.widget.style.setProperty("--widget-progress-width", config.seekWidth);
}

function setProgressVisible(visible) {
  const progressRow = ui.progress?.parentElement;
  if (!progressRow) return;
  progressRow.style.display = visible ? "" : "none";
}

function toClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setWidgetHidden(hidden) {
  ui.widget.classList.toggle("widget--hidden", Boolean(hidden));
}

function renderCover(coverUrl) {
  const preferredUrl = String(coverUrl || "").trim();
  const fallbackUrl = resolveCoverFallbackUrl();
  const url = preferredUrl || fallbackUrl;
  if (!url) {
    ui.cover.dataset.fallbackApplied = "1";
    ui.cover.removeAttribute("src");
    ui.cover.classList.add("widget__cover--empty");
    return;
  }

  ui.cover.dataset.fallbackApplied = "0";
  ui.cover.src = url;
  ui.cover.classList.remove("widget__cover--empty");
}

ui.cover.addEventListener("error", () => {
  const fallbackUrl = resolveCoverFallbackUrl();
  if (!fallbackUrl) {
    ui.cover.removeAttribute("src");
    ui.cover.classList.add("widget__cover--empty");
    return;
  }
  if (ui.cover.dataset.fallbackApplied === "1") {
    ui.cover.removeAttribute("src");
    ui.cover.classList.add("widget__cover--empty");
    return;
  }
  ui.cover.dataset.fallbackApplied = "1";
  ui.cover.src = fallbackUrl;
  ui.cover.classList.remove("widget__cover--empty");
});

function render(snapshot) {
  currentSnapshot = snapshot || null;
  const isEmpty = !snapshot || snapshot.hasActiveSource === false;
  if (isEmpty) {
    setWidgetHidden(true);
    return;
  }

  setWidgetHidden(false);
  const track = snapshot || {};
  const durationSec = Math.max(0, Number(track.durationSec) || 0);
  const positionSec = Math.max(0, Number(track.positionSec) || 0);
  const isLiveWithoutDuration = durationSec <= 0;

  if (widgetLayoutConfig.showCover) {
    renderCover(track.coverUrl);
  } else {
    ui.cover.dataset.fallbackApplied = "1";
    ui.cover.removeAttribute("src");
    ui.cover.classList.add("widget__cover--empty");
  }
  ui.title.textContent = track.title || "Now Playing";
  ui.artist.textContent = track.artist || track.sourceLabel || "—";
  ui.time.textContent = isLiveWithoutDuration
    ? resolveLiveLabel()
    : `${toClock(positionSec)} / ${toClock(durationSec)}`;
  setProgressVisible(!isLiveWithoutDuration);
  ui.progress.style.width = isLiveWithoutDuration
    ? "0%"
    : `${Math.max(0, Math.min(100, Number(track.progress) || 0))}%`;
}

function applyCustomCss(cssText) {
  ui.customCssSlot.textContent = cssText || "";
}

function applySettings(settings) {
  const normalizedSettings = settings && typeof settings === "object" ? settings : {};
  themeAppearance = normalizeAppearance(normalizedSettings.themeAppearance);
  uiLocale = normalizeUiLocale(normalizedSettings.uiLocale);
  applyCustomCss(normalizedSettings.customCss || "");
  if (currentSnapshot) render(currentSnapshot);
}

window.addEventListener(eventName, (event) => {
  const detail = event.detail || {};
  render(detail);
  if (typeof detail.customCss === "string") {
    applyCustomCss(detail.customCss);
  }
});

applyWidgetLayoutConfig(widgetLayoutConfig);
setWidgetHidden(true);

if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.storage?.sync) {
  chrome.storage.local.get({ [ACTIVE_SNAPSHOT_STORAGE_KEY]: null }, (result) => {
    render(result[ACTIVE_SNAPSHOT_STORAGE_KEY]);
  });

  chrome.storage.sync.get(
    { settings: { customCss: "", themeAppearance: "system", uiLocale: normalizeUiLocale(navigator.language) } },
    (result) => {
      applySettings(result?.settings || {});
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ACTIVE_SNAPSHOT_STORAGE_KEY]) {
      render(changes[ACTIVE_SNAPSHOT_STORAGE_KEY].newValue);
    }
    if (area === "sync" && changes.settings) {
      applySettings(changes.settings.newValue || {});
    }
  });
}

const mediaQuery = window.matchMedia?.(COLOR_SCHEME_QUERY);
if (mediaQuery) {
  const onSchemeChange = () => {
    if (normalizeAppearance(themeAppearance) !== "system") return;
    if (currentSnapshot) render(currentSnapshot);
  };
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onSchemeChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(onSchemeChange);
  }
}
