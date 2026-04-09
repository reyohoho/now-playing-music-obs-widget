const CHANNEL_KEY = "__nphZvukBridge";

function makeToken() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `nph-zv-${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
}

function snapshotKey(snapshot) {
  try {
    return JSON.stringify(snapshot || {});
  } catch (_) {
    return "";
  }
}

export function createZvukBridge(context) {
  const win = context?.window || window;
  const doc = context?.document || document;

  const token = makeToken();
  const pending = new Map();
  let seq = 0;
  let disposed = false;
  let installed = false;
  let snapshotCache = null;
  let snapshotCacheKey = "";
  let snapshotRequestPromise = null;
  let onSnapshotChanged = null;

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
    script.src = chrome.runtime.getURL("src/content/zvukPageBridge.js");
    script.dataset.nphZvukToken = token;
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
        resolve({ ok: false, message: "zvuk bridge timeout" });
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

  const updateSnapshotCache = (nextSnapshot) => {
    const key = snapshotKey(nextSnapshot);
    if (key === snapshotCacheKey) return false;

    snapshotCache = nextSnapshot;
    snapshotCacheKey = key;
    if (typeof onSnapshotChanged === "function") onSnapshotChanged(nextSnapshot);
    return true;
  };

  return {
    init(handleSnapshotChanged) {
      if (disposed) return;
      onSnapshotChanged = handleSnapshotChanged;
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
      snapshotRequestPromise = null;
      onSnapshotChanged = null;
    },
    getSnapshot() {
      return snapshotCache;
    },
    async requestSnapshot() {
      if (disposed) return { ok: false, message: "bridge disposed" };
      if (snapshotRequestPromise) return snapshotRequestPromise;

      snapshotRequestPromise = sendRequest({ kind: "snapshot" })
        .then((payload) => {
          if (payload?.ok && payload?.snapshot) {
            updateSnapshotCache(payload.snapshot);
          }
          return payload || { ok: false, message: "empty bridge snapshot response" };
        })
        .finally(() => {
          snapshotRequestPromise = null;
        });

      return snapshotRequestPromise;
    },
    async execute(action, value) {
      if (disposed) return { ok: false, message: "bridge disposed" };
      const payload = await sendRequest({
        kind: "control",
        action,
        value,
      });

      if (payload?.ok) {
        void this.requestSnapshot();
      }

      return payload || { ok: false, message: "empty bridge control response" };
    },
  };
}
