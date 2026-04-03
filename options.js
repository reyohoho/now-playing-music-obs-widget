/* global chrome */

const D = {
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
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

chrome.storage.sync.get(null, (c) => {
  const v = c || {};
  $("obsHost").value = orDef(D.obsHost, v.obsHost);
  $("obsPort").value = orPort(D.obsPort, v.obsPort);
  $("obsPassword").value = v.obsPassword != null ? String(v.obsPassword) : "";
  $("obsInputName").value = orDef(D.obsInputName, v.obsInputName);
});

$("save").addEventListener("click", () => {
  chrome.storage.sync.set(
    {
      obsHost: $("obsHost").value.trim() || D.obsHost,
      obsPort: parseInt($("obsPort").value, 10) || D.obsPort,
      obsPassword: $("obsPassword").value,
      obsInputName: $("obsInputName").value.trim() || D.obsInputName,
    },
    () => {
      $("status").textContent = "Сохранено.";
      setTimeout(() => {
        $("status").textContent = "";
      }, 3000);
    }
  );
});
