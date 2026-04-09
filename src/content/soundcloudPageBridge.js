(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphSoundCloudToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphSoundCloudBridge";
  const RUNTIME_CACHE_KEY = "__nphSoundCloudRuntime";

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  function getWebpackRequire() {
    const runtime = window[RUNTIME_CACHE_KEY] || (window[RUNTIME_CACHE_KEY] = {});
    if (typeof runtime.requireFn === "function") return runtime.requireFn;

    const webpackJsonp = window.webpackJsonp;
    if (!Array.isArray(webpackJsonp) || typeof webpackJsonp.push !== "function") return null;

    try {
      let captured = null;
      const moduleId = `__nph_sc_probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      webpackJsonp.push([
        [moduleId],
        {
          [moduleId]: (_module, _exports, __webpack_require__) => {
            captured = __webpack_require__;
          },
        },
        [[moduleId]],
      ]);
      if (typeof captured === "function") {
        runtime.requireFn = captured;
        return captured;
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function isVolumeApiCandidate(candidate) {
    return (
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.getVolume === "function" &&
      (typeof candidate.setVolume === "function" || typeof candidate.setVolumeAndMuted === "function") &&
      (typeof candidate.getMuted === "function" ||
        typeof candidate.setMuted === "function" ||
        typeof candidate.toggleMuted === "function")
    );
  }

  function findSoundCloudVolumeApi() {
    const runtime = window[RUNTIME_CACHE_KEY] || (window[RUNTIME_CACHE_KEY] = {});
    if (runtime.volumeApi && isVolumeApiCandidate(runtime.volumeApi)) return runtime.volumeApi;

    const requireFn = getWebpackRequire();
    if (!requireFn?.c || typeof requireFn.c !== "object") return null;

    const modules = Object.values(requireFn.c);
    for (const mod of modules) {
      const exported = mod?.exports;
      if (!exported) continue;

      const queue = [exported];
      if (exported?.default) queue.push(exported.default);
      if (typeof exported === "object") {
        for (const value of Object.values(exported)) queue.push(value);
      }

      for (const candidate of queue) {
        if (!isVolumeApiCandidate(candidate)) continue;
        runtime.volumeApi = candidate;
        return candidate;
      }
    }

    return null;
  }

  function setVolumeViaApi(level) {
    const api = findSoundCloudVolumeApi();
    if (!api) return { ok: false, message: "soundcloud volume api unavailable", path: "api" };

    const ratio = clamp01(level);
    const beforeNow = Number(api.getVolume?.());

    if (typeof api.setVolumeAndMuted === "function") {
      api.setVolumeAndMuted({ volume: ratio, muted: ratio <= 0 });
    } else if (typeof api.setVolume === "function") {
      api.setVolume(ratio);
    }

    if (ratio > 0 && typeof api.setMuted === "function") api.setMuted(false);
    if (ratio <= 0 && typeof api.setMuted === "function") api.setMuted(true);

    const afterNow = Number(api.getVolume?.());
    const muted = typeof api.getMuted === "function" ? Boolean(api.getMuted()) : ratio <= 0;
    const changed = Number.isFinite(beforeNow) && Number.isFinite(afterNow)
      ? Math.abs(afterNow - beforeNow) > 0.0001
      : true;
    const closeToTarget = Number.isFinite(afterNow) ? Math.abs(afterNow - ratio) <= 0.02 : false;

    return {
      ok: changed || closeToTarget || (ratio <= 0 && muted),
      beforeNow,
      afterNow,
      ratio,
      muted,
      path: "api",
    };
  }

  function setMutedViaApi(forceState = null) {
    const api = findSoundCloudVolumeApi();
    if (!api) return { ok: false, message: "soundcloud mute api unavailable", path: "api" };

    const muted = typeof api.getMuted === "function" ? Boolean(api.getMuted()) : false;
    const targetMuted = forceState === null ? !muted : Boolean(forceState);
    const volumeNow = Number(api.getVolume?.());

    if (typeof api.setMuted === "function") {
      api.setMuted(targetMuted);
    } else if (typeof api.toggleMuted === "function") {
      if (targetMuted !== muted) api.toggleMuted();
    } else if (targetMuted && typeof api.setVolume === "function") {
      api.setVolume(0);
    } else if (!targetMuted && typeof api.setVolume === "function") {
      api.setVolume(Number.isFinite(volumeNow) && volumeNow > 0 ? volumeNow : 0.5);
    } else {
      return { ok: false, message: "soundcloud mute api unsupported", path: "api" };
    }

    const afterMuted = typeof api.getMuted === "function" ? Boolean(api.getMuted()) : targetMuted;
    return {
      ok: afterMuted === targetMuted,
      muted: afterMuted,
      path: "api",
    };
  }

  function executeControl(action, value) {
    if (action === "volume") return setVolumeViaApi(value);
    if (action === "mute") return setMutedViaApi(true);
    if (action === "unmute") return setMutedViaApi(false);
    if (action === "muteToggle") return setMutedViaApi(null);
    return { ok: false, message: `unsupported action ${action}` };
  }

  const onMessage = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[CHANNEL_KEY] !== true || data.kind !== "request" || data.token !== token) return;

    const id = data.id;
    const request = data.request || {};
    let payload;

    try {
      if (request.kind === "control") {
        payload = executeControl(request.action, request.value);
      } else {
        payload = { ok: false, message: "unknown request kind" };
      }
    } catch (error) {
      payload = { ok: false, message: String(error || "soundcloud bridge error") };
    }

    window.postMessage(
      {
        [CHANNEL_KEY]: true,
        kind: "response",
        token,
        id,
        payload,
      },
      "*"
    );
  };

  window.addEventListener("message", onMessage);
})();
