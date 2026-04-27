/* global chrome, OBS_PROVIDERS */

const D = {
  obsMode: "direct",
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
  twitchChannel: "",
  voteSkipKeyword: "skip",
  voteSaveKeyword: "ClippyJAM",
  voteSkipThreshold: 3,
  voteSkipByPercent: false,
  voteSkipPercent: 10,
  providersDisabled: [],
  serverRoomId: "",
  serverRoomKey: "",

  overlayShowBackground:   true,
  overlayBackgroundColor:  "#101218",
  overlayBackgroundAlpha:  0.66,
  overlayTextColor:        "#ffffff",
  overlayFontFamily:       "system",
  overlayFontSize:         22,
  overlayShowProviderIcon:   true,
  overlayProviderIconSource: "emoji",
  overlayShowDot:            true,
  overlayBorderRadius:       999,

  moobotEnabled: true,
};

const OVERLAY_KEYS = [
  "overlayShowBackground",
  "overlayBackgroundColor",
  "overlayBackgroundAlpha",
  "overlayTextColor",
  "overlayFontFamily",
  "overlayFontSize",
  "overlayShowProviderIcon",
  "overlayProviderIconSource",
  "overlayShowDot",
  "overlayBorderRadius",
];

const FONT_STACKS = {
  system:  '"Inter","Segoe UI",system-ui,-apple-system,sans-serif',
  rounded: '"SF Pro Rounded","Segoe UI Variable","Segoe UI",system-ui,sans-serif',
  serif:   'Georgia,"Times New Roman",serif',
  mono:    'ui-monospace,SFMono-Regular,Menlo,Consolas,"JetBrains Mono",monospace',
  display: '"Bebas Neue","Impact","Oswald","Arial Narrow",sans-serif',
};

const STATE_LABELS = {
  idle: "Ожидание",
  connecting: "Подключение",
  connected: "Подключено",
  disconnected: "Отключено",
  disabled: "Выключено",
  error: "Ошибка",
};

const MODE_LABELS = {
  direct: "Прямой WS",
  server: "Через сервер",
};

const $ = (id) => document.getElementById(id);

function orDef(def, x) {
  const s = x == null ? "" : String(x).trim();
  return s || def;
}

function orPort(def, x) {
  const n = parseInt(x, 10);
  return n >= 1 && n <= 65535 ? n : def;
}

let saveTimer = null;
let currentEnabled = true;
let currentMode = "direct";
let currentDisabledProviders = new Set();
let currentActiveProviderId = "";
let providersRendered = false;
let currentSecrets = { backendUrl: "", roomId: "", roomKey: "" };

// --------------------------------------------------------------------------
// small utils
// --------------------------------------------------------------------------

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeHex(v, fallback) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#([0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
  if (/^#([0-9a-f]{3})$/i.test(s)) {
    const c = s.substring(1);
    return "#" + c.split("").map((ch) => ch + ch).join("").toLowerCase();
  }
  return fallback;
}

function hexToRgba(hex, alpha) {
  const h = normalizeHex(hex, "#101218").substring(1);
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha, 0.66)})`;
}

// --------------------------------------------------------------------------
// status panel
// --------------------------------------------------------------------------

function updateSkipPercentVisibility() {
  $("skipPercentRow").style.display = $("voteSkipByPercent").checked ? "" : "none";
}

function formatViewersInfo(count, updatedAt) {
  if (!updatedAt) return "";
  const ago = Math.round((Date.now() - updatedAt) / 1000);
  const agoStr = ago < 60 ? `${ago}с назад` : `${Math.round(ago / 60)}м назад`;
  const percent = Math.max(1, Math.min(100, Number($("voteSkipPercent").value) || D.voteSkipPercent));
  const effective = Math.max(1, Math.ceil(count * percent / 100));
  return count > 0
    ? `Зрителей: ${count} (обновлено ${agoStr}) — порог при ${percent}%: ${effective} голосов`
    : `Стрим оффлайн или зрители не определены (обновлено ${agoStr})`;
}

function refreshViewersInfo() {
  const info = $("viewersCountInfo");
  if (!info) return;
  chrome.storage.local.get({ twitchViewersCount: 0, twitchViewersUpdatedAt: 0 }, (v) => {
    info.textContent = formatViewersInfo(
      Number(v.twitchViewersCount) || 0,
      Number(v.twitchViewersUpdatedAt) || 0
    );
  });
}

function showSaveStatus(text, isError = false) {
  const el = $("saveStatus");
  el.textContent = text || "";
  el.style.color = isError ? "#f87171" : "#4ade80";
  if (saveTimer) clearTimeout(saveTimer);
  if (text) saveTimer = setTimeout(() => { el.textContent = ""; }, 3500);
}

function applyModeToBody(mode) {
  document.body.classList.toggle("mode-direct", mode !== "server");
  document.body.classList.toggle("mode-server", mode === "server");
  const d = $("modeOptDirect"), s = $("modeOptServer");
  if (d && s) {
    d.classList.toggle("active", mode !== "server");
    s.classList.toggle("active", mode === "server");
  }
  for (const r of document.querySelectorAll('input[name="obsMode"]')) {
    r.checked = r.value === mode;
  }
}

function renderEnabledControls(enabled) {
  currentEnabled = enabled !== false;
  $("toggleEnabled").textContent = currentEnabled ? "Отключить" : "Включить";
  $("reconnect").disabled = !currentEnabled;
}

function renderObsStatus(s) {
  const st = s || {};
  const enabled = st.enabled !== false;
  const mode = st.mode === "server" ? "server" : "direct";
  const state = String(st.state || (enabled ? "idle" : "disabled"));

  if (mode !== currentMode) {
    currentMode = mode;
    applyModeToBody(mode);
  }

  const stateEl = $("connState");
  stateEl.textContent = STATE_LABELS[state] || state;
  stateEl.className = `state ${state}`;
  $("modeChip").textContent = MODE_LABELS[mode] || mode;
  $("modeChip").className = `chip ${mode === "server" ? "accent" : ""}`;

  $("connMessage").textContent = st.message ? String(st.message) : "";
  $("connError").textContent = st.lastError ? `Ошибка: ${st.lastError}` : "";

  $("connTarget").textContent = `${st.configuredHost || D.obsHost}:${st.configuredPort || D.obsPort}`;
  $("connInput").textContent = st.inputName ? String(st.inputName) : D.obsInputName;
  $("pwdConfigured").textContent = st.passwordConfigured ? "задан" : "пустой";
  $("serverBase").textContent = st.serverBaseUrl || "—";
  $("serverSubs").textContent = String(st.serverSubscribers || 0);

  renderEnabledControls(enabled);

  const nextActive = String(st.activeProviderId || "");
  if (nextActive !== currentActiveProviderId) {
    currentActiveProviderId = nextActive;
    updateProviderRowStates();
  }

  if (mode === "server") refreshSecrets();
}

// --------------------------------------------------------------------------
// provider list
// --------------------------------------------------------------------------

function ensureProvidersRendered() {
  if (providersRendered) return;
  const container = $("providers");
  if (!container) return;
  const providers = Array.isArray(self.OBS_PROVIDERS) ? self.OBS_PROVIDERS : [];
  const frag = document.createDocumentFragment();
  for (const p of providers) {
    const row = document.createElement("label");
    row.className = "provider-row";
    row.dataset.providerId = p.id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.id = p.id;

    const icon = document.createElement("span");
    icon.className = "provider-icon";
    icon.textContent = p.icon || "\u2022";

    const name = document.createElement("span");
    name.className = "provider-name";
    name.textContent = p.name;

    const hosts = document.createElement("span");
    hosts.className = "provider-hosts";
    hosts.textContent = p.hosts[0] || "";

    const dot = document.createElement("span");
    dot.className = "provider-dot";
    dot.title = "Сейчас отсюда идёт трек";

    row.appendChild(cb);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(hosts);
    row.appendChild(dot);
    frag.appendChild(row);
  }
  container.innerHTML = "";
  container.appendChild(frag);
  container.addEventListener("change", onProviderToggle);
  providersRendered = true;
}

function updateProviderRowStates() {
  ensureProvidersRendered();
  const container = $("providers");
  if (!container) return;
  for (const row of container.querySelectorAll(".provider-row")) {
    const id = row.dataset.providerId;
    const cb = row.querySelector('input[type="checkbox"]');
    const isDisabled = currentDisabledProviders.has(id);
    if (cb) cb.checked = !isDisabled;
    row.classList.toggle("disabled", isDisabled);
    row.classList.toggle("active", !isDisabled && currentActiveProviderId === id);
  }
}

function onProviderToggle(e) {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== "checkbox") return;
  const id = target.dataset.id;
  if (!id) return;
  const checked = target.checked;

  const next = new Set(currentDisabledProviders);
  if (checked) next.delete(id); else next.add(id);
  currentDisabledProviders = next;
  updateProviderRowStates();

  chrome.storage.sync.set({ providersDisabled: Array.from(next) }, () => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось сохранить список провайдеров.", true);
      return;
    }
    showSaveStatus(checked ? `Провайдер «${id}» включён.` : `Провайдер «${id}» выключен.`);
  });
}

// --------------------------------------------------------------------------
// server-mode secrets / overlay URL
// --------------------------------------------------------------------------

function requestObsStatus() {
  chrome.runtime.sendMessage({ type: "obs:getStatus" }, (resp) => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось запросить статус service worker.", true);
      return;
    }
    if (resp?.status) renderObsStatus(resp.status);
  });
}

function refreshSecrets() {
  chrome.runtime.sendMessage({ type: "obs:getServerSecrets" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) return;
    currentSecrets = {
      backendUrl: String(resp.backendUrl || ""),
      roomId: String(resp.roomId || ""),
      roomKey: String(resp.roomKey || ""),
    };
    const urlEl = $("overlayUrl");
    if (!currentSecrets.roomId || !currentSecrets.backendUrl) {
      if (urlEl) urlEl.value = "";
      return;
    }
    const base = currentSecrets.backendUrl.replace(/\/+$/, "");
    const id = encodeURIComponent(currentSecrets.roomId);
    if (urlEl) urlEl.value = `${base}/overlay/${id}`;
  });
}

async function copyToClipboard(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

// --------------------------------------------------------------------------
// overlay appearance: live preview + storage sync
// --------------------------------------------------------------------------

function readOverlayForm() {
  const hexBg = normalizeHex($("overlayBackgroundColor").value, D.overlayBackgroundColor);
  const hexTx = normalizeHex($("overlayTextColor").value, D.overlayTextColor);
  return {
    overlayShowBackground:   $("overlayShowBackground").checked,
    overlayBackgroundColor:  hexBg,
    overlayBackgroundAlpha:  Number($("overlayBackgroundAlpha").value) / 100,
    overlayTextColor:        hexTx,
    overlayFontFamily:       $("overlayFontFamily").value,
    overlayFontSize:         clampInt($("overlayFontSize").value, 10, 64, D.overlayFontSize),
    overlayShowProviderIcon:   $("overlayShowProviderIcon").checked,
    overlayProviderIconSource: $("overlayProviderIconSource").value === "favicon" ? "favicon" : "emoji",
    overlayShowDot:            $("overlayShowDot").checked,
    overlayBorderRadius:       clampInt($("overlayBorderRadius").value, 0, 999, D.overlayBorderRadius),
  };
}

function applyOverlayToForm(cfg) {
  $("overlayShowBackground").checked = cfg.overlayShowBackground !== false;
  const bg = normalizeHex(cfg.overlayBackgroundColor, D.overlayBackgroundColor);
  $("overlayBackgroundColor").value = bg;
  $("overlayBackgroundColorPicker").value = bg;
  const alphaPct = Math.round(clamp01(cfg.overlayBackgroundAlpha, D.overlayBackgroundAlpha) * 100);
  $("overlayBackgroundAlpha").value = String(alphaPct);
  $("overlayBackgroundAlphaVal").textContent = alphaPct + "%";
  const tx = normalizeHex(cfg.overlayTextColor, D.overlayTextColor);
  $("overlayTextColor").value = tx;
  $("overlayTextColorPicker").value = tx;
  $("overlayFontFamily").value = FONT_STACKS[cfg.overlayFontFamily] ? cfg.overlayFontFamily : "system";
  const size = clampInt(cfg.overlayFontSize, 10, 64, D.overlayFontSize);
  $("overlayFontSize").value = String(size);
  $("overlayFontSizeVal").textContent = size + "px";
  $("overlayShowProviderIcon").checked = cfg.overlayShowProviderIcon !== false;
  $("overlayProviderIconSource").value = cfg.overlayProviderIconSource === "favicon" ? "favicon" : "emoji";
  $("overlayShowDot").checked = cfg.overlayShowDot !== false;
  const radius = clampInt(cfg.overlayBorderRadius, 0, 999, D.overlayBorderRadius);
  $("overlayBorderRadius").value = String(radius);
  $("overlayBorderRadiusVal").textContent = radius + "px";
}

// Sample provider used for the preview favicon/emoji — user's currently
// active provider if we know it, otherwise Yandex Music.
const PREVIEW_PROVIDER = { id: "ym", emoji: "🎵", host: "music.yandex.ru" };

function renderPreview() {
  const cfg = readOverlayForm();
  const stage = $("previewStage");
  stage.style.color = cfg.overlayTextColor;
  stage.style.background = hexToRgba(cfg.overlayBackgroundColor, cfg.overlayBackgroundAlpha);
  stage.style.fontSize = cfg.overlayFontSize + "px";
  stage.style.fontFamily = FONT_STACKS[cfg.overlayFontFamily] || FONT_STACKS.system;
  stage.style.borderRadius = cfg.overlayBorderRadius + "px";
  stage.classList.toggle("no-bg", cfg.overlayShowBackground === false);
  stage.classList.toggle("no-icon", cfg.overlayShowProviderIcon === false);
  stage.classList.toggle("no-dot", cfg.overlayShowDot === false);
  renderPreviewIcon(cfg.overlayProviderIconSource);
}

function renderPreviewIcon(source) {
  const iconEl = $("previewIcon");
  iconEl.innerHTML = "";
  if (source === "favicon" && PREVIEW_PROVIDER.host) {
    const img = document.createElement("img");
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(PREVIEW_PROVIDER.host)}&sz=64`;
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.style.width = "1em";
    img.style.height = "1em";
    img.style.verticalAlign = "-0.15em";
    img.style.borderRadius = "3px";
    img.onerror = () => { iconEl.textContent = PREVIEW_PROVIDER.emoji; };
    iconEl.appendChild(img);
    return;
  }
  iconEl.textContent = PREVIEW_PROVIDER.emoji;
}

let overlaySaveTimer = null;
function scheduleOverlayPersist() {
  if (overlaySaveTimer) clearTimeout(overlaySaveTimer);
  overlaySaveTimer = setTimeout(() => {
    overlaySaveTimer = null;
    const cfg = readOverlayForm();
    chrome.storage.sync.set(cfg, () => {
      if (chrome.runtime.lastError) {
        showSaveStatus("Не удалось сохранить внешний вид.", true);
      }
    });
  }, 350);
}

function wireOverlayControls() {
  const fields = [
    "overlayShowBackground",
    "overlayBackgroundColor",
    "overlayBackgroundColorPicker",
    "overlayBackgroundAlpha",
    "overlayTextColor",
    "overlayTextColorPicker",
    "overlayFontFamily",
    "overlayFontSize",
    "overlayShowProviderIcon",
    "overlayProviderIconSource",
    "overlayShowDot",
    "overlayBorderRadius",
  ];
  for (const id of fields) {
    const el = $(id);
    if (!el) continue;
    const evt = el.type === "range" || el.type === "color" || el.tagName === "SELECT" || el.type === "text"
      ? "input" : "change";
    el.addEventListener(evt, () => {
      syncColorPair();
      syncRangeLabels();
      renderPreview();
      scheduleOverlayPersist();
    });
  }
}

function syncColorPair() {
  // Keep the <input type="color"> and its companion text field in sync.
  const pickBg = $("overlayBackgroundColorPicker");
  const textBg = $("overlayBackgroundColor");
  const pickTx = $("overlayTextColorPicker");
  const textTx = $("overlayTextColor");
  if (document.activeElement === pickBg) textBg.value = pickBg.value;
  if (document.activeElement === textBg) {
    const norm = normalizeHex(textBg.value, null);
    if (norm) pickBg.value = norm;
  }
  if (document.activeElement === pickTx) textTx.value = pickTx.value;
  if (document.activeElement === textTx) {
    const norm = normalizeHex(textTx.value, null);
    if (norm) pickTx.value = norm;
  }
}

function syncRangeLabels() {
  $("overlayBackgroundAlphaVal").textContent = `${$("overlayBackgroundAlpha").value}%`;
  $("overlayFontSizeVal").textContent = `${$("overlayFontSize").value}px`;
  $("overlayBorderRadiusVal").textContent = `${$("overlayBorderRadius").value}px`;
}

// --------------------------------------------------------------------------
// moobot panel visibility
// --------------------------------------------------------------------------

function applyMoobotVisibility(enabled) {
  document.body.classList.toggle("moobot-hidden", !enabled);
  $("moobotEnabled").checked = !!enabled;
}

// --------------------------------------------------------------------------
// bootstrap
// --------------------------------------------------------------------------

ensureProvidersRendered();
applyModeToBody(currentMode);
wireOverlayControls();

chrome.storage.sync.get(null, (c) => {
  const v = c || {};
  currentMode = v.obsMode === "server" ? "server" : "direct";
  applyModeToBody(currentMode);

  $("obsHost").value = orDef(D.obsHost, v.obsHost);
  $("obsPort").value = orPort(D.obsPort, v.obsPort);
  $("obsPassword").value = v.obsPassword != null ? String(v.obsPassword) : "";
  $("obsInputName").value = orDef(D.obsInputName, v.obsInputName);
  $("twitchChannel").value = v.twitchChannel != null ? String(v.twitchChannel) : "";
  $("voteSkipKeyword").value = v.voteSkipKeyword != null ? String(v.voteSkipKeyword) : D.voteSkipKeyword;
  $("voteSaveKeyword").value = v.voteSaveKeyword != null ? String(v.voteSaveKeyword) : D.voteSaveKeyword;
  $("voteSkipThreshold").value = Number(v.voteSkipThreshold) > 0 ? Number(v.voteSkipThreshold) : D.voteSkipThreshold;
  $("voteSkipByPercent").checked = v.voteSkipByPercent === true;
  $("voteSkipPercent").value = Number(v.voteSkipPercent) > 0 ? Number(v.voteSkipPercent) : D.voteSkipPercent;
  updateSkipPercentVisibility();
  refreshViewersInfo();

  currentDisabledProviders = new Set(
    Array.isArray(v.providersDisabled) ? v.providersDisabled : []
  );
  updateProviderRowStates();
  refreshSecrets();

  const overlayCfg = {};
  for (const k of OVERLAY_KEYS) overlayCfg[k] = v[k] !== undefined ? v[k] : D[k];
  applyOverlayToForm(overlayCfg);
  renderPreview();

  applyMoobotVisibility(v.moobotEnabled !== false);
});

chrome.storage.local.get({ obsStatus: null }, (v) => { renderObsStatus(v.obsStatus); });
requestObsStatus();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.obsStatus) renderObsStatus(changes.obsStatus.newValue);
    if (changes.twitchViewersCount || changes.twitchViewersUpdatedAt) refreshViewersInfo();
  }
  if (area === "sync") {
    if (changes.providersDisabled) {
      const list = changes.providersDisabled.newValue;
      currentDisabledProviders = new Set(Array.isArray(list) ? list : []);
      updateProviderRowStates();
    }
    if (changes.obsMode) {
      const mode = changes.obsMode.newValue === "server" ? "server" : "direct";
      currentMode = mode;
      applyModeToBody(mode);
    }
    if (changes.serverRoomId || changes.serverRoomKey) {
      refreshSecrets();
    }
    if (changes.moobotEnabled) {
      applyMoobotVisibility(changes.moobotEnabled.newValue !== false);
    }
    let overlayTouched = false;
    for (const k of OVERLAY_KEYS) if (changes[k]) { overlayTouched = true; break; }
    if (overlayTouched) {
      // Only reapply if the change originated elsewhere (e.g. another device via
      // sync). Our own writes will land here too but are idempotent.
      const cfg = {};
      for (const k of OVERLAY_KEYS) cfg[k] = changes[k] ? changes[k].newValue : readOverlayForm()[k];
      applyOverlayToForm(cfg);
      renderPreview();
    }
  }
});

$("voteSkipByPercent").addEventListener("change", () => {
  updateSkipPercentVisibility();
  refreshViewersInfo();
});

$("voteSkipPercent").addEventListener("input", refreshViewersInfo);

document.querySelectorAll('input[name="obsMode"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (!el.checked) return;
    const mode = el.value === "server" ? "server" : "direct";
    chrome.runtime.sendMessage({ type: "obs:setMode", mode }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        showSaveStatus("Не удалось сменить режим.", true);
        return;
      }
      currentMode = mode;
      applyModeToBody(mode);
      showSaveStatus(mode === "server" ? "Режим: через сервер." : "Режим: прямой WebSocket.");
      requestObsStatus();
    });
  });
});

$("revealOverlay").addEventListener("click", () => {
  const el = $("overlayUrl");
  const show = el.type === "password";
  el.type = show ? "text" : "password";
  $("revealOverlay").textContent = show ? "Скрыть" : "Показать";
});

document.querySelectorAll("button[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const el = $(btn.dataset.copy);
    if (!el) return;
    const ok = await copyToClipboard(el.value || "");
    showSaveStatus(ok ? "Ссылка скопирована в буфер." : "Не удалось скопировать. Выделите вручную.", !ok);
  });
});

$("overlayReset").addEventListener("click", () => {
  if (!confirm("Сбросить внешний вид оверлея к значениям по умолчанию?")) return;
  const cfg = {};
  for (const k of OVERLAY_KEYS) cfg[k] = D[k];
  applyOverlayToForm(cfg);
  renderPreview();
  chrome.storage.sync.set(cfg, () => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось сбросить внешний вид.", true);
      return;
    }
    showSaveStatus("Внешний вид сброшен к умолчаниям.");
  });
});

$("rotateCreds").addEventListener("click", () => {
  if (!confirm("Сгенерировать новую пару ID + ключ? Предыдущая ссылка перестанет работать, OBS-источник нужно будет обновить.")) return;
  chrome.runtime.sendMessage({ type: "obs:rotateServerCredentials" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      showSaveStatus("Не удалось сбросить ID и ключ.", true);
      return;
    }
    showSaveStatus("Создан новый ID. Скопируйте новую ссылку и обновите источник в OBS.");
    refreshSecrets();
    requestObsStatus();
  });
});

$("moobotEnabled").addEventListener("change", () => {
  const enabled = $("moobotEnabled").checked;
  applyMoobotVisibility(enabled);
  chrome.storage.sync.set({ moobotEnabled: enabled });
});

$("save").addEventListener("click", () => {
  const toSave = {
    obsHost: $("obsHost").value.trim() || D.obsHost,
    obsPort: parseInt($("obsPort").value, 10) || D.obsPort,
    obsPassword: $("obsPassword").value,
    obsInputName: $("obsInputName").value.trim() || D.obsInputName,
    twitchChannel: $("twitchChannel").value.trim().toLowerCase(),
    voteSkipKeyword: $("voteSkipKeyword").value.trim() || D.voteSkipKeyword,
    voteSaveKeyword: $("voteSaveKeyword").value.trim() || D.voteSaveKeyword,
    voteSkipThreshold: Math.max(1, parseInt($("voteSkipThreshold").value, 10) || D.voteSkipThreshold),
    voteSkipByPercent: $("voteSkipByPercent").checked,
    voteSkipPercent: Math.max(1, Math.min(100, parseInt($("voteSkipPercent").value, 10) || D.voteSkipPercent)),
    moobotEnabled: $("moobotEnabled").checked,
    ...readOverlayForm(),
  };
  chrome.storage.sync.set(toSave, () => {
    showSaveStatus("Сохранено. Переподключаюсь…");
    chrome.runtime.sendMessage({ type: "obs:reconnect" }, () => void chrome.runtime.lastError);
    requestObsStatus();
  });
});

$("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "obs:reconnect" }, (resp) => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось отправить команду переподключения.", true);
      return;
    }
    showSaveStatus("Запрошено переподключение.");
    if (resp?.status) renderObsStatus(resp.status);
    requestObsStatus();
  });
});

$("toggleEnabled").addEventListener("click", () => {
  const nextEnabled = !currentEnabled;
  chrome.runtime.sendMessage({ type: "obs:setEnabled", enabled: nextEnabled }, (resp) => {
    if (chrome.runtime.lastError || resp?.ok === false) {
      showSaveStatus("Не удалось изменить режим работы расширения.", true);
      return;
    }
    showSaveStatus(nextEnabled ? "Расширение включено." : "Расширение отключено.");
    requestObsStatus();
  });
});
