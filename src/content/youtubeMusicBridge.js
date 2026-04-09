const CHANNEL_KEY = "__nphYouTubeMusicBridge";

function makeToken() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `nph-ytm-${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
}

export function createYouTubeMusicBridge(context) {
  const win = context?.window || window;
  const doc = context?.document || document;
  const debugLog = typeof context?.debugLog === "function" ? context.debugLog : () => {};
  const warnLog = typeof context?.warnLog === "function" ? context.warnLog : () => {};

  const token = makeToken();
  const pending = new Map();
  let seq = 0;
  let disposed = false;
  let installed = false;
  let ready = false;
  let readyPromise = null;

  const onWindowMessage = (event) => {
    if (disposed) return;
    if (event.source !== win) return;

    const data = event.data;
    if (!data || data[CHANNEL_KEY] !== true || data.kind !== "response" || data.token !== token) return;

    const id = Number(data.id);
    if (!Number.isFinite(id)) return;

    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    waiter.resolve(data.payload);
  };

  const injectBridgeScript = () => {
    if (disposed) return Promise.resolve({ ok: false, message: "bridge disposed" });
    if (ready) return Promise.resolve({ ok: true });
    if (readyPromise) return readyPromise;

    const root = doc.head || doc.documentElement;
    if (!root) return Promise.resolve({ ok: false, message: "bridge root unavailable" });

    readyPromise = new Promise((resolve) => {
      const script = doc.createElement("script");
      script.src = chrome.runtime.getURL("src/content/youtubeMusicPageBridge.js");
      script.dataset.nphYoutubeMusicToken = token;
      script.async = false;

      script.onload = () => {
        ready = true;
        script.remove();
        resolve({ ok: true });
      };

      script.onerror = () => {
        script.remove();
        warnLog("ytmusic bridge inject failed", { href: win.location?.href || "" });
        resolve({ ok: false, message: "ytmusic bridge script load failed" });
      };

      root.appendChild(script);
    }).finally(() => {
      readyPromise = null;
    });

    if (!installed) {
      win.addEventListener("message", onWindowMessage);
      installed = true;
    }

    return readyPromise;
  };

  const sendRequest = async (request) => {
    if (disposed) return { ok: false, message: "bridge disposed" };
    const readyResult = await injectBridgeScript();
    if (!readyResult?.ok) return readyResult;

    const id = ++seq;
    debugLog("ytmusic bridge request", { id, request });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve({ ok: false, message: "ytmusic bridge timeout" });
      }, 2500);

      pending.set(id, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
      });

      win.postMessage(
        {
          [CHANNEL_KEY]: true,
          kind: "request",
          token,
          id,
          request,
        },
        "*"
      );
    });
  };

  return {
    init() {
      if (disposed) return;
      void injectBridgeScript();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      pending.clear();
      if (installed) win.removeEventListener("message", onWindowMessage);
      installed = false;
      ready = false;
      readyPromise = null;
    },
    execute(action, value) {
      return sendRequest({
        kind: "control",
        action,
        value,
      });
    },
    snapshot() {
      return sendRequest({ kind: "snapshot" });
    },
  };
}
