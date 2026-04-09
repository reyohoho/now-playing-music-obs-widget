const CHANNEL_KEY = "__nphSoundCloudBridge";

function makeToken() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `nph-sc-${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
}

export function createSoundCloudBridge(context) {
  const win = context?.window || window;
  const doc = context?.document || document;

  const token = makeToken();
  const pending = new Map();
  let seq = 0;
  let disposed = false;
  let installed = false;

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
    if (installed || disposed) return;
    const root = doc.head || doc.documentElement;
    if (!root) return;

    const script = doc.createElement("script");
    script.src = chrome.runtime.getURL("src/content/soundcloudPageBridge.js");
    script.dataset.nphSoundCloudToken = token;
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => script.remove();
    root.appendChild(script);

    win.addEventListener("message", onWindowMessage);
    installed = true;
  };

  const sendRequest = (request) => {
    if (disposed) return Promise.resolve({ ok: false, message: "bridge disposed" });
    injectBridgeScript();

    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve({ ok: false, message: "soundcloud bridge timeout" });
      }, 1200);

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
      injectBridgeScript();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      pending.clear();
      if (installed) {
        win.removeEventListener("message", onWindowMessage);
      }
      installed = false;
    },
    execute(action, value) {
      return sendRequest({
        kind: "control",
        action,
        value,
      });
    },
  };
}

