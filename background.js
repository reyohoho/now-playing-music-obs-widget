let lastLineKey = { key: "", t: 0 };

const DEFAULTS = {
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsInputName: "NowPlaying",
};

let obs = {
  ws: null,
  identified: false,
  req: 0,
  host: DEFAULTS.obsHost,
  port: DEFAULTS.obsPort,
  password: DEFAULTS.obsPassword,
  reconnectTimer: null,
  inputName: DEFAULTS.obsInputName,
  lastLine: "",
};

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function obsAuthString(password, salt, challenge) {
  const enc = new TextEncoder();
  const secretBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(password + salt)
  );
  const secretB64 = bytesToBase64(secretBuf);
  const authBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(secretB64 + challenge)
  );
  return bytesToBase64(authBuf);
}

function obsDisconnect() {
  if (obs.reconnectTimer) {
    clearTimeout(obs.reconnectTimer);
    obs.reconnectTimer = null;
  }
  obs.identified = false;
  if (obs.ws) {
    obs.ws.onopen = obs.ws.onclose = obs.ws.onerror = obs.ws.onmessage = null;
    obs.ws.close();
    obs.ws = null;
  }
}

function obsScheduleReconnect() {
  if (obs.reconnectTimer) return;
  obs.reconnectTimer = setTimeout(() => {
    obs.reconnectTimer = null;
    obsConnect();
  }, 4000);
}

async function obsOnHello(d) {
  const rpcVersion = d?.rpcVersion ?? 1;
  const auth = d?.authentication;
  const payload = { rpcVersion, eventSubscriptions: 0 };

  if (auth?.challenge != null && auth?.salt != null && obs.password !== "") {
    try {
      payload.authentication = await obsAuthString(
        obs.password,
        auth.salt,
        auth.challenge
      );
    } catch (_) {
      obsDisconnect();
      obsScheduleReconnect();
      return;
    }
  }

  if (obs.ws?.readyState === WebSocket.OPEN) {
    obs.ws.send(JSON.stringify({ op: 1, d: payload }));
  }
}

function obsConnect() {
  if (obs.ws?.readyState === WebSocket.OPEN) return;
  const url = `ws://${obs.host}:${obs.port}`;
  try {
    obs.ws = new WebSocket(url);
  } catch (_) {
    obsScheduleReconnect();
    return;
  }

  obs.ws.onopen = () => {
    obs.identified = false;
  };

  obs.ws.onclose = () => {
    obs.identified = false;
    obs.ws = null;
    obsScheduleReconnect();
  };

  obs.ws.onerror = () => {};

  obs.ws.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (msg.op === 0) await obsOnHello(msg.d);
    else if (msg.op === 2) {
      obs.identified = true;
      if (obs.lastLine) {
        obsSendSetText(obs.inputName || DEFAULTS.obsInputName, obs.lastLine);
      }
    }
  };
}

function obsSendSetText(inputName, line) {
  if (!obs.ws || obs.ws.readyState !== WebSocket.OPEN || !obs.identified) {
    obsConnect();
    return;
  }
  const requestId = `${++obs.req}`;
  obs.ws.send(
    JSON.stringify({
      op: 6,
      d: {
        requestType: "SetInputSettings",
        requestId,
        requestData: {
          inputName,
          inputSettings: { text: line },
          overlay: true,
        },
      },
    })
  );
}

function pushLineToObs(line) {
  if (line === obs.lastLine) return;
  const now = Date.now();
  if (line === lastLineKey.key && now - lastLineKey.t < 800) return;
  lastLineKey = { key: line, t: now };

  obs.lastLine = line;
  obsSendSetText(obs.inputName || DEFAULTS.obsInputName, line);
}

function loadObsConfig() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    obs.host = cfg.obsHost || DEFAULTS.obsHost;
    obs.port = Number(cfg.obsPort) || DEFAULTS.obsPort;
    obs.password = cfg.obsPassword ?? "";
    obs.inputName = (cfg.obsInputName || DEFAULTS.obsInputName).trim();
    obsDisconnect();
    obsConnect();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (
    changes.obsHost ||
    changes.obsPort ||
    changes.obsPassword ||
    changes.obsInputName
  ) {
    loadObsConfig();
  }
});

chrome.runtime.onInstalled.addListener(loadObsConfig);
chrome.runtime.onStartup.addListener(loadObsConfig);
loadObsConfig();

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.song == null) return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (!tab?.audible) return;

    const line = String(message.song).trim();
    if (!line) return;

    pushLineToObs(line);
  });
});
