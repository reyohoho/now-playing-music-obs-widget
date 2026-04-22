/* global chrome */

const D = {
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
  twitchChannel: "",
  voteSkipKeyword: "skip",
  voteSaveKeyword: "ClippyJAM",
  voteSkipThreshold: 3,
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

function showSaveStatus(text, isError = false) {
  const el = $("saveStatus");
  el.textContent = text || "";
  el.style.color = isError ? "#b02a37" : "#146c2e";
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
});

chrome.storage.local.get({ obsStatus: null }, (v) => {
  renderObsStatus(v.obsStatus);
});
requestObsStatus();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.obsStatus) {
    renderObsStatus(changes.obsStatus.newValue);
  }
});

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
