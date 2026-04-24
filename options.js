/* global chrome, OBS_PROVIDERS */

const D = {
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
};

const STATE_LABELS = {
  idle: "Ожидание",
  connecting: "Подключение",
  connected: "Подключено",
  disconnected: "Отключено",
  disabled: "Выключено",
  error: "Ошибка",
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

function updateSkipPercentVisibility() {
  const checked = $("voteSkipByPercent").checked;
  $("skipPercentRow").style.display = checked ? "" : "none";
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
let currentDisabledProviders = new Set();
let currentActiveProviderId = "";
let providersRendered = false;

function showSaveStatus(text, isError = false) {
  const el = $("saveStatus");
  el.textContent = text || "";
  el.style.color = isError ? "#f87171" : "#4ade80";
  if (saveTimer) clearTimeout(saveTimer);
  if (text) {
    saveTimer = setTimeout(() => {
      el.textContent = "";
    }, 3500);
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
  const state = String(st.state || (enabled ? "idle" : "disabled"));
  const stateEl = $("connState");
  stateEl.textContent = STATE_LABELS[state] || state;
  stateEl.className = `state ${state}`;

  $("connMessage").textContent = st.message ? String(st.message) : "";
  $("connTarget").textContent = `${st.configuredHost || D.obsHost}:${st.configuredPort || D.obsPort}`;
  $("connInput").textContent = st.inputName ? String(st.inputName) : D.obsInputName;
  $("pwdConfigured").textContent = st.passwordConfigured ? "задан" : "пустой";
  $("connError").textContent = st.lastError ? `Ошибка: ${st.lastError}` : "";
  renderEnabledControls(enabled);

  const nextActive = String(st.activeProviderId || "");
  if (nextActive !== currentActiveProviderId) {
    currentActiveProviderId = nextActive;
    updateProviderRowStates();
  }
}

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
    icon.textContent = p.icon || "•";

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
  const rows = container.querySelectorAll(".provider-row");
  for (const row of rows) {
    const id = row.dataset.providerId;
    const cb = row.querySelector('input[type="checkbox"]');
    const isDisabled = currentDisabledProviders.has(id);
    if (cb) cb.checked = !isDisabled;
    row.classList.toggle("disabled", isDisabled);
    row.classList.toggle(
      "active",
      !isDisabled && currentActiveProviderId === id
    );
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
  if (checked) next.delete(id);
  else next.add(id);
  currentDisabledProviders = next;
  updateProviderRowStates();

  chrome.storage.sync.set(
    { providersDisabled: Array.from(next) },
    () => {
      if (chrome.runtime.lastError) {
        showSaveStatus("Не удалось сохранить список провайдеров.", true);
        return;
      }
      showSaveStatus(
        checked
          ? `Провайдер «${id}» включён.`
          : `Провайдер «${id}» выключен.`
      );
    }
  );
}

function requestObsStatus() {
  chrome.runtime.sendMessage({ type: "obs:getStatus" }, (resp) => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось запросить статус service worker.", true);
      return;
    }
    if (resp?.status) renderObsStatus(resp.status);
  });
}

ensureProvidersRendered();

chrome.storage.sync.get(null, (c) => {
  const v = c || {};
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
});

chrome.storage.local.get({ obsStatus: null }, (v) => {
  renderObsStatus(v.obsStatus);
});
requestObsStatus();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.obsStatus) renderObsStatus(changes.obsStatus.newValue);
    if (changes.twitchViewersCount || changes.twitchViewersUpdatedAt) refreshViewersInfo();
  }
  if (area === "sync" && changes.providersDisabled) {
    const list = changes.providersDisabled.newValue;
    currentDisabledProviders = new Set(Array.isArray(list) ? list : []);
    updateProviderRowStates();
  }
});

$("voteSkipByPercent").addEventListener("change", () => {
  updateSkipPercentVisibility();
  refreshViewersInfo();
});

$("voteSkipPercent").addEventListener("input", refreshViewersInfo);

$("save").addEventListener("click", () => {
  chrome.storage.sync.set(
    {
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
    },
    () => {
      showSaveStatus("Сохранено. Переподключаюсь…");
      chrome.runtime.sendMessage({ type: "obs:reconnect" }, () => void chrome.runtime.lastError);
      requestObsStatus();
    }
  );
});

$("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "obs:reconnect" }, (resp) => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Не удалось отправить команду переподключения.", true);
      return;
    }
    showSaveStatus("Запрошено переподключение к OBS.");
    if (resp?.status) renderObsStatus(resp.status);
    requestObsStatus();
  });
});

$("toggleEnabled").addEventListener("click", () => {
  const nextEnabled = !currentEnabled;
  chrome.runtime.sendMessage(
    { type: "obs:setEnabled", enabled: nextEnabled },
    (resp) => {
      if (chrome.runtime.lastError || resp?.ok === false) {
        showSaveStatus("Не удалось изменить режим работы расширения.", true);
        return;
      }
      showSaveStatus(
        nextEnabled
          ? "Расширение включено."
          : "Расширение отключено."
      );
      requestObsStatus();
    }
  );
});
