(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphVkToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphVkBridge";

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const asFiniteInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
  };

  const call = (player, method, ...args) => {
    const fn = player?.[method];
    if (typeof fn !== "function") return undefined;
    try {
      return fn.apply(player, args);
    } catch (_) {
      return undefined;
    }
  };

  const callBool = (player, method) => {
    const value = call(player, method);
    return typeof value === "boolean" ? value : null;
  };

  const callFirst = async (player, methods, ...args) => {
    for (const method of methods) {
      const fn = player?.[method];
      if (typeof fn !== "function") continue;

      let result;
      try {
        result = fn.apply(player, args);
      } catch (_) {
        continue;
      }

      if (result && typeof result.then === "function") {
        try {
          await result;
        } catch (_) {
          // VK internals may reject on transient race conditions.
        }
      }
      return true;
    }
    return false;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isPlayingNow = (player) => callBool(player, "isPlaying") === true;
  const isPausedNow = (player) => callBool(player, "isPaused") === true;

  const ensurePlaybackState = async (player, targetState) => {
    if (targetState === "playing") {
      if (isPlayingNow(player)) return true;
      const preferResume = isPausedNow(player);
      const methods = preferResume
        ? ["resume", "playByButton", "play"]
        : ["playByButton", "play", "resume"];

      for (const method of methods) {
        const called = await callFirst(player, [method]);
        if (!called) continue;
        await sleep(140);
        if (isPlayingNow(player)) return true;
      }
      return isPlayingNow(player);
    }

    if (targetState === "paused") {
      if (isPausedNow(player)) return true;
      for (const method of ["pauseByButton", "pause"]) {
        const called = await callFirst(player, [method]);
        if (!called) continue;
        await sleep(120);
        if (isPausedNow(player) || !isPlayingNow(player)) return true;
      }
      return isPausedNow(player) || !isPlayingNow(player);
    }

    return false;
  };

  const getPlayer = () => {
    const ap = window.ap;
    if (!ap || typeof ap !== "object") return null;
    return ap;
  };

  const buildTrackUrlFromIds = (ownerId, audioId) => {
    const owner = asFiniteInt(ownerId);
    const track = asFiniteInt(audioId);
    if (!Number.isFinite(owner) || !Number.isFinite(track) || track <= 0) return "";
    return `https://vk.com/audio${owner}_${track}`;
  };

  const parseIdsFromText = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return null;
    const decoded = (() => {
      try {
        return decodeURIComponent(text);
      } catch (_) {
        return text;
      }
    })();
    const match = decoded.match(/audio(-?\d+)_([0-9]+)/i);
    if (!match) return null;
    const ownerId = asFiniteInt(match[1]);
    const audioId = asFiniteInt(match[2]);
    if (!Number.isFinite(ownerId) || !Number.isFinite(audioId) || audioId <= 0) return null;
    return { ownerId, audioId };
  };

  const parseLocationUrl = () => {
    try {
      return new URL(String(window.location?.href || ""));
    } catch (_) {
      const hostname = String(window.location?.hostname || "").trim().toLowerCase() || "vk.com";
      const pathname = String(window.location?.pathname || "/").trim() || "/";
      const rawSearch = String(window.location?.search || "").trim();
      const search = rawSearch
        ? rawSearch.startsWith("?")
          ? rawSearch
          : `?${rawSearch}`
        : "";
      try {
        return new URL(`https://${hostname}${pathname}${search}`);
      } catch (_) {
        return null;
      }
    }
  };

  const normalizeTrackUrl = (rawUrl) => {
    const raw = String(rawUrl || "").trim();
    if (!raw) return "";

    let parsed;
    try {
      parsed = new URL(raw, parseLocationUrl()?.toString() || "https://vk.com/");
    } catch (_) {
      return "";
    }

    if (!/(^|\.)vk\.com$/i.test(parsed.hostname)) return "";

    const values = [
      parsed.pathname,
      parsed.searchParams.get("z"),
      parsed.searchParams.get("w"),
      parsed.searchParams.get("q"),
      String(parsed.hash || "").replace(/^#/, ""),
    ];

    for (const value of values) {
      const ids = parseIdsFromText(value);
      if (!ids) continue;
      return buildTrackUrlFromIds(ids.ownerId, ids.audioId);
    }

    return "";
  };

  const resolveTrackUrl = (currentData, currentTuple) => {
    const objectCandidates = [
      currentData,
      {
        owner_id: currentData?.ownerId,
        id: currentData?.audioId,
      },
    ];

    for (const source of objectCandidates) {
      if (!source || typeof source !== "object") continue;
      const ownerId = asFiniteInt(source.owner_id ?? source.ownerId ?? source.oid ?? source.owner);
      const audioId = asFiniteInt(source.id ?? source.audio_id ?? source.audioId);
      const built = buildTrackUrlFromIds(ownerId, audioId);
      if (built) return built;
    }

    if (Array.isArray(currentTuple)) {
      const built = buildTrackUrlFromIds(currentTuple[1], currentTuple[0]);
      if (built) return built;
    }

    const roots = [
      document.querySelector('[data-testid="TopAudioPlayer"]'),
      document.querySelector('[class*="TopAudioPlayer"]'),
      document.querySelector('[class*="vkitAudioRow__wrapperActivated"]'),
      document,
    ].filter(Boolean);

    for (const root of roots) {
      const nodes = Array.from(root.querySelectorAll?.('a[href*="audio"][href]') || []);
      for (const node of nodes) {
        const normalized = normalizeTrackUrl(String(node?.getAttribute?.("href") || ""));
        if (normalized) return normalized;
      }
    }

    const locationUrl = parseLocationUrl();
    return normalizeTrackUrl(locationUrl?.toString() || "");
  };

  const firstCoverFromTuple = (tuple) => {
    if (!Array.isArray(tuple)) return "";
    const raw = String(tuple[14] || "").trim();
    if (!raw) return "";
    const urls = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return urls[0] || "";
  };

  const firstCoverFromArtwork = (artwork) => {
    if (!Array.isArray(artwork)) return "";
    for (let index = artwork.length - 1; index >= 0; index -= 1) {
      const item = artwork[index];
      const src = String(
        (typeof item === "string" ? item : item?.src || item?.url || item?.image || "") || ""
      ).trim();
      if (src) return src;
    }
    return "";
  };

  const readSnapshot = () => {
    const ap = getPlayer();
    if (!ap) return { ok: false, message: "vk ap unavailable" };

    const currentData = call(ap, "getCurrentAudioData");
    const currentTuple = call(ap, "getCurrentAudio");

    const title = String(currentData?.title || (Array.isArray(currentTuple) ? currentTuple[3] : "") || "").trim();
    const artist = String(
      currentData?.author?.raw || (Array.isArray(currentTuple) ? currentTuple[4] : "") || ""
    ).trim();
    const coverUrl =
      firstCoverFromArtwork(currentData?.artwork) || firstCoverFromTuple(currentTuple);
    const trackUrl = resolveTrackUrl(currentData, currentTuple);

    const durationRaw = Number(call(ap, "getCurrentDuration"));
    const progressTimeRaw = Number(call(ap, "getCurrentProgressTime"));
    const progressRaw = Number(call(ap, "getCurrentProgress"));
    const volumeRaw = Number(call(ap, "getVolume"));
    const mutedRaw = call(ap, "getMuted");
    const isPlaying = callBool(ap, "isPlaying");
    const isPaused = callBool(ap, "isPaused");

    let durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;
    let positionSec =
      Number.isFinite(progressTimeRaw) && progressTimeRaw >= 0 ? progressTimeRaw / 1000 : Number.NaN;

    if (!Number.isFinite(positionSec) && Number.isFinite(progressRaw) && durationSec > 0) {
      positionSec = durationSec * progressRaw;
    }

    if (!Number.isFinite(positionSec)) positionSec = 0;
    if (durationSec > 0) positionSec = Math.max(0, Math.min(durationSec, positionSec));
    else durationSec = 0;

    let playbackState = "";
    if (isPlaying === true) playbackState = "playing";
    else if (isPaused === true) playbackState = "paused";

    const hasTrackData = Boolean(title || artist || coverUrl || durationSec > 0 || positionSec > 0);
    if (!hasTrackData) return { ok: false, message: "vk snapshot unavailable" };

    const snapshot = {
      ...(title ? { title } : {}),
      ...(artist ? { artist } : {}),
      ...(trackUrl ? { trackUrl } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(durationSec > 0 ? { durationSec } : {}),
      ...(positionSec >= 0 ? { positionSec } : {}),
      ...(Number.isFinite(volumeRaw) ? { volume: clamp01(volumeRaw) } : {}),
      ...(typeof mutedRaw === "boolean" ? { muted: mutedRaw } : {}),
      ...(playbackState ? { playbackState } : {}),
    };

    return { ok: true, snapshot };
  };

  const executeControl = async (action, value) => {
    const ap = getPlayer();
    if (!ap) return { ok: false, message: "vk ap unavailable" };

    if (action === "play") {
      const ok = await ensurePlaybackState(ap, "playing");
      return { ok, ...(ok ? {} : { message: "vk play unavailable" }) };
    }

    if (action === "pause") {
      const ok = await ensurePlaybackState(ap, "paused");
      return { ok, ...(ok ? {} : { message: "vk pause unavailable" }) };
    }

    if (action === "toggle") {
      const isPlaying = callBool(ap, "isPlaying");
      const isPaused = callBool(ap, "isPaused");
      if (isPlaying === true) {
        const ok = await ensurePlaybackState(ap, "paused");
        return { ok, ...(ok ? {} : { message: "vk toggle unavailable" }) };
      }
      if (isPaused === true) {
        const ok = await ensurePlaybackState(ap, "playing");
        return { ok, ...(ok ? {} : { message: "vk toggle unavailable" }) };
      }
      const ok = await ensurePlaybackState(ap, "playing");
      return { ok, ...(ok ? {} : { message: "vk toggle unavailable" }) };
    }

    if (action === "next") {
      const ok = await callFirst(ap, ["playNextByButton", "playNext"]);
      return { ok, ...(ok ? {} : { message: "vk next unavailable" }) };
    }

    if (action === "previous") {
      const ok = await callFirst(ap, ["playPrevByButton", "playPrev"]);
      return { ok, ...(ok ? {} : { message: "vk previous unavailable" }) };
    }

    if (action === "seek") {
      const target = Number(value);
      if (!Number.isFinite(target)) return { ok: false, message: "invalid seek" };

      const duration = Number(call(ap, "getCurrentDuration"));
      if (Number.isFinite(duration) && duration > 0) {
        const ratio = Math.max(0, Math.min(1, target / duration));
        const bySlider = await callFirst(ap, ["seekBySlider", "seek"], ratio);
        if (bySlider) return { ok: true };
      }

      const direct = await callFirst(
        ap,
        ["seekToTime"],
        Math.max(0, target),
        "now_playing_extension"
      );
      if (direct) return { ok: true };

      return { ok: false, message: "vk seek unavailable" };
    }

    if (action === "volume") {
      const target = Number(value);
      if (!Number.isFinite(target)) return { ok: false, message: "invalid volume" };
      const ok = await callFirst(ap, ["setVolume"], clamp01(target));
      return { ok, ...(ok ? {} : { message: "vk volume unavailable" }) };
    }

    if (action === "mute") {
      const ok = await callFirst(ap, ["toggleMuted"], true);
      return { ok, ...(ok ? {} : { message: "vk mute unavailable" }) };
    }

    if (action === "unmute") {
      const ok = await callFirst(ap, ["toggleMuted"], false);
      return { ok, ...(ok ? {} : { message: "vk unmute unavailable" }) };
    }

    if (action === "muteToggle") {
      const currentMuted = call(ap, "getMuted");
      if (typeof currentMuted === "boolean") {
        const ok = await callFirst(ap, ["toggleMuted"], !currentMuted);
        return { ok, ...(ok ? {} : { message: "vk mute toggle unavailable" }) };
      }
      const ok = await callFirst(ap, ["toggleMuted"]);
      return { ok, ...(ok ? {} : { message: "vk mute toggle unavailable" }) };
    }

    return { ok: false, message: `unsupported action ${action}` };
  };

  const onMessage = async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[CHANNEL_KEY] !== true || data.kind !== "request" || data.token !== token) return;

    const id = data.id;
    const request = data.request || {};

    let payload;
    try {
      if (request.kind === "snapshot") {
        payload = readSnapshot();
      } else if (request.kind === "control") {
        payload = await executeControl(request.action, request.value);
      } else {
        payload = { ok: false, message: "unknown request kind" };
      }
    } catch (error) {
      payload = { ok: false, message: String(error || "bridge error") };
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
