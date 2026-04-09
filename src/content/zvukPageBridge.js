(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphZvukToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphZvukBridge";
  const RUNTIME_CACHE_KEY = "__nphZvukRuntime";
  const API_SCAN_INTERVAL_MS = 1200;
  const TRACK_LINK_SELECTORS = ['a[href*="/track/"]', 'a[href*="zvuk.com/track/"]'];
  const TRACK_ID_FIELDS = ["trackId", "track_id", "audioId", "audio_id", "id"];

  const runtime = window[RUNTIME_CACHE_KEY] || (window[RUNTIME_CACHE_KEY] = {});

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const finiteOrNaN = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  };

  const clamp01 = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return Number.NaN;
    return Math.max(0, Math.min(1, number));
  };

  const callPlayerMethod = async (player, method, ...args) => {
    const fn = player?.[method];
    if (typeof fn !== "function") return false;

    try {
      const result = fn.apply(player, args);
      if (result && typeof result.then === "function") {
        await result.catch(() => undefined);
      }
      return true;
    } catch (_) {
      return false;
    }
  };

  const callPlayerFirst = async (player, methods, ...args) => {
    for (const method of methods) {
      const ok = await callPlayerMethod(player, method, ...args);
      if (ok) return true;
    }
    return false;
  };

  const resolveCoverTemplateUrl = (template) => {
    const raw = String(template || "").trim();
    if (!raw) return "";
    return raw.replace("{size}", "large");
  };

  const extractArtistLine = (audioData) => {
    if (!audioData || typeof audioData !== "object") return "";
    if (!Array.isArray(audioData.artists) || !audioData.artists.length) return "";

    const names = audioData.artists.map((artist) => normalizeText(artist?.name)).filter(Boolean);
    return names.join(", ");
  };

  const parseLocationUrl = () => {
    try {
      return new URL(String(window.location?.href || ""));
    } catch (_) {
      const hostname = String(window.location?.hostname || "").trim().toLowerCase() || "zvuk.com";
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

  const normalizeTrackId = (value) => {
    if (value === null || value === undefined) return "";
    const raw = String(value).trim();
    if (!raw) return "";

    const decoded = (() => {
      try {
        return decodeURIComponent(raw);
      } catch (_) {
        return raw;
      }
    })();

    const fromPath = decoded.match(/(?:^|\/)track\/([^/?#&]+)/i);
    if (fromPath) {
      const candidateFromPath = String(fromPath[1] || "").trim();
      if (/^[a-z0-9_-]+$/i.test(candidateFromPath)) return candidateFromPath;
    }

    const candidate = String(decoded)
      .replace(/^#/, "")
      .replace(/^track[:=_-]?/i, "")
      .trim();
    if (!candidate) return "";
    if (!/^[a-z0-9_-]+$/i.test(candidate)) return "";
    return candidate;
  };

  const buildTrackUrlFromId = (trackId) => {
    const normalizedId = normalizeTrackId(trackId);
    if (!normalizedId) return "";
    return `https://zvuk.com/track/${normalizedId}`;
  };

  const normalizeTrackPath = (pathname = "") => {
    const parts = String(pathname || "")
      .split("/")
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (!parts.length) return "";

    for (let index = 0; index < parts.length; index += 1) {
      if (String(parts[index] || "").toLowerCase() !== "track") continue;
      const next = normalizeTrackId(parts[index + 1] || "");
      if (next) return `/track/${next}`;
    }

    return "";
  };

  const normalizeTrackUrl = (rawUrl) => {
    const raw = String(rawUrl || "").trim();
    if (!raw) return "";

    let parsed;
    try {
      parsed = new URL(raw, parseLocationUrl()?.toString() || "https://zvuk.com/");
    } catch (_) {
      return "";
    }

    if (!/(^|\.)zvuk\.com$/i.test(parsed.hostname)) return "";

    const fromPath = normalizeTrackPath(parsed.pathname);
    if (fromPath) return `https://zvuk.com${fromPath}`;

    const fromCandidates = [
      parsed.searchParams.get("trackId"),
      parsed.searchParams.get("track_id"),
      parsed.searchParams.get("audioId"),
      parsed.searchParams.get("audio_id"),
      parsed.searchParams.get("id"),
      parsed.searchParams.get("z"),
      parsed.searchParams.get("w"),
      parsed.searchParams.get("q"),
      String(parsed.hash || "").replace(/^#/, ""),
    ];

    for (const value of fromCandidates) {
      const built = buildTrackUrlFromId(value);
      if (built) return built;
    }

    return "";
  };

  const candidateTrackUrlsFromAudioData = (audioData) => {
    if (!audioData || typeof audioData !== "object") return [];

    const visited = new Set();
    const queue = [{ value: audioData, depth: 0 }];
    const urls = [];
    let steps = 0;
    const MAX_STEPS = 80;
    const MAX_KEYS = 60;

    while (queue.length && steps < MAX_STEPS) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      steps += 1;

      for (const field of TRACK_ID_FIELDS) {
        const fromId = buildTrackUrlFromId(value[field]);
        if (fromId) urls.push(fromId);
      }

      const directFields = [
        value.trackUrl,
        value.url,
        value.href,
        value.link,
        value.shareUrl,
        value.seoUrl,
        value.permalink,
      ];
      for (const candidate of directFields) {
        const normalized = normalizeTrackUrl(candidate);
        if (normalized) urls.push(normalized);
      }

      if (depth >= 2) continue;

      let keys = [];
      try {
        keys = Object.keys(value);
      } catch (_) {
        keys = [];
      }

      for (const key of keys.slice(0, MAX_KEYS)) {
        const next = value[key];
        if (next && typeof next === "object" && !visited.has(next)) {
          queue.push({ value: next, depth: depth + 1 });
        }
      }
    }

    return urls;
  };

  const resolveTrackUrl = (audioData) => {
    for (const candidate of candidateTrackUrlsFromAudioData(audioData)) {
      const normalized = normalizeTrackUrl(candidate);
      if (normalized) return normalized;
    }

    for (const selector of TRACK_LINK_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const normalized = normalizeTrackUrl(node?.getAttribute?.("href"));
        if (normalized) return normalized;
      }
    }

    const fromCanonical = normalizeTrackUrl(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href")
    );
    if (fromCanonical) return fromCanonical;

    const fromOg = normalizeTrackUrl(
      document.querySelector('meta[property="og:url"]')?.getAttribute("content")
    );
    if (fromOg) return fromOg;

    return normalizeTrackUrl(parseLocationUrl()?.toString() || "");
  };

  const readMediaSession = () => {
    try {
      const mediaSession = navigator?.mediaSession;
      const metadata = mediaSession?.metadata;

      const playbackState = String(mediaSession?.playbackState || "")
        .toLowerCase()
        .trim();
      const artworkList = Array.isArray(metadata?.artwork) ? metadata.artwork : [];
      const artwork = artworkList[artworkList.length - 1]?.src || artworkList[0]?.src || "";

      return {
        title: normalizeText(metadata?.title),
        artist: normalizeText(metadata?.artist),
        coverUrl: normalizeText(artwork),
        playbackState: playbackState === "playing" || playbackState === "paused" ? playbackState : "",
      };
    } catch (_) {
      return {
        title: "",
        artist: "",
        coverUrl: "",
        playbackState: "",
      };
    }
  };

  const extractAudioFromPlayer = (player) => {
    if (!player || typeof player !== "object") return null;
    const audioCore = player?._audioCore;
    if (!audioCore || typeof audioCore !== "object") return null;
    return audioCore?._audio || audioCore?._shaka?._audioElement || null;
  };

  const looksLikeZvukPlayer = (value) => {
    if (!value || typeof value !== "object") return false;
    if (typeof value.seek !== "function") return false;
    if (typeof value.setVolume !== "function") return false;
    if (typeof value.mute !== "function") return false;
    return Boolean(extractAudioFromPlayer(value));
  };

  const getReactFiberKey = (node) => {
    if (!node) return "";
    return Object.keys(node).find((key) => key.startsWith("__reactFiber$")) || "";
  };

  const findPlayerInObjectGraph = (root, maxDepth = 3) => {
    if (!root || typeof root !== "object") return null;

    const queue = [{ value: root, depth: 0 }];
    const seen = new Set();

    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== "object") continue;
      if (seen.has(value)) continue;
      seen.add(value);

      if (looksLikeZvukPlayer(value)) return value;
      if (depth >= maxDepth) continue;

      let keys = [];
      try {
        keys = Object.keys(value);
      } catch (_) {
        keys = [];
      }

      for (const key of keys.slice(0, 90)) {
        let next = null;
        try {
          next = value[key];
        } catch (_) {
          next = null;
        }
        if (next && typeof next === "object" && !seen.has(next)) {
          queue.push({ value: next, depth: depth + 1 });
        }
      }
    }

    return null;
  };

  const findZvukApi = () => {
    const seenPlayers = new Set();
    const nodes = document.querySelectorAll("*");

    for (const node of nodes) {
      const fiberKey = getReactFiberKey(node);
      if (!fiberKey) continue;

      const fiber = node[fiberKey];
      const directCandidates = [
        fiber?.memoizedProps?.parent?._player,
        fiber?.return?.memoizedProps?.parent?._player,
        fiber?.return?.return?.memoizedProps?.parent?._player,
      ];

      for (const player of directCandidates) {
        if (!player || seenPlayers.has(player) || !looksLikeZvukPlayer(player)) continue;
        seenPlayers.add(player);
        const audio = extractAudioFromPlayer(player);
        if (!audio) continue;
        return { player, audio };
      }

      const graphRoots = [
        fiber?.memoizedProps,
        fiber?.pendingProps,
        fiber?.memoizedState,
        fiber?.return?.memoizedProps,
        fiber?.return?.pendingProps,
        fiber?.return?.memoizedState,
      ];

      for (const root of graphRoots) {
        const player = findPlayerInObjectGraph(root, 3);
        if (!player || seenPlayers.has(player)) continue;
        seenPlayers.add(player);
        const audio = extractAudioFromPlayer(player);
        if (!audio) continue;
        return { player, audio };
      }
    }

    return null;
  };

  const isValidApi = (api) => {
    if (!api || typeof api !== "object") return false;
    if (!api.player || typeof api.player !== "object") return false;
    if (!api.audio || typeof api.audio !== "object") return false;
    return typeof api.player.seek === "function";
  };

  const getZvukApi = (force = false) => {
    const now = Date.now();
    if (isValidApi(runtime.api)) {
      const nextAudio = extractAudioFromPlayer(runtime.api.player);
      if (nextAudio && nextAudio !== runtime.api.audio) runtime.api.audio = nextAudio;
      return runtime.api;
    }
    if (!force && now - Number(runtime.lastScanAt || 0) < API_SCAN_INTERVAL_MS) return null;

    runtime.lastScanAt = now;
    const api = findZvukApi();
    if (!api) return null;

    runtime.api = api;
    return api;
  };

  const buildPlaybackStateFromAudio = (audio) => {
    if (!audio) return "";
    if (audio.ended) return "ended";
    if (audio.paused) return "paused";
    return "playing";
  };

  const readSnapshot = () => {
    const mediaSession = readMediaSession();
    const api = getZvukApi(false);
    const player = api?.player || null;
    const audio = api?.audio || null;
    const audioData = player?._audioQueueItem?._audioData || null;

    const title = mediaSession.title || normalizeText(audioData?.title);
    const artist = mediaSession.artist || extractArtistLine(audioData);
    const coverUrl = mediaSession.coverUrl || resolveCoverTemplateUrl(audioData?.coverSrc);
    const trackUrl = resolveTrackUrl(audioData);

    const queueDuration = finiteOrNaN(audioData?.duration);
    const audioDuration = finiteOrNaN(audio?.duration);
    const durationSec = Number.isFinite(queueDuration)
      ? Math.max(0, queueDuration)
      : Number.isFinite(audioDuration)
        ? Math.max(0, audioDuration)
        : Number.NaN;

    const positionSec = Number.isFinite(finiteOrNaN(audio?.currentTime))
      ? Math.max(0, finiteOrNaN(audio?.currentTime))
      : Number.NaN;

    const volume = Number.isFinite(clamp01(audio?.volume)) ? clamp01(audio?.volume) : Number.NaN;
    const muted = typeof audio?.muted === "boolean" ? audio.muted : null;
    const playbackState = buildPlaybackStateFromAudio(audio) || mediaSession.playbackState;
    if (!title && !artist) return { ok: false, message: "zvuk snapshot unavailable" };

    const snapshot = {
      ...(title ? { title } : {}),
      ...(artist ? { artist } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(trackUrl ? { trackUrl } : {}),
      ...(playbackState ? { playbackState } : {}),
      ...(Number.isFinite(durationSec) ? { durationSec } : {}),
      ...(Number.isFinite(positionSec) ? { positionSec } : {}),
      ...(Number.isFinite(volume) ? { volume } : {}),
      ...(typeof muted === "boolean" ? { muted } : {}),
    };

    return { ok: true, snapshot };
  };

  const executeControl = async (action, value) => {
    const api = getZvukApi(true);
    const player = api?.player;
    const audio = api?.audio;
    if (!player || !audio) return { ok: false, message: "zvuk api unavailable" };

    if (action === "play") {
      if (!audio.paused) return { ok: true };
      const ok = await callPlayerFirst(player, ["resume", "play"]);
      return { ok, ...(ok ? {} : { message: "zvuk play unavailable" }) };
    }

    if (action === "pause") {
      if (audio.paused) return { ok: true };
      const ok = await callPlayerFirst(player, ["pause"]);
      return { ok, ...(ok ? {} : { message: "zvuk pause unavailable" }) };
    }

    if (action === "toggle") {
      const ok = audio.paused
        ? await callPlayerFirst(player, ["resume", "play"])
        : await callPlayerFirst(player, ["pause"]);
      return { ok, ...(ok ? {} : { message: "zvuk toggle unavailable" }) };
    }

    if (action === "next") {
      const ok = await callPlayerFirst(player, ["next"]);
      return { ok, ...(ok ? {} : { message: "zvuk next unavailable" }) };
    }

    if (action === "previous") {
      const ok = await callPlayerFirst(player, ["prev", "previous"]);
      return { ok, ...(ok ? {} : { message: "zvuk previous unavailable" }) };
    }

    if (action === "seek") {
      const targetSec = finiteOrNaN(value);
      if (!Number.isFinite(targetSec)) return { ok: false, message: "invalid seek" };

      const duration = finiteOrNaN(audio.duration);
      const clamped = Number.isFinite(duration)
        ? Math.max(0, Math.min(duration, targetSec))
        : Math.max(0, targetSec);

      const ok = await callPlayerFirst(player, ["seek"], clamped);
      return { ok, ...(ok ? {} : { message: "zvuk seek unavailable" }) };
    }

    if (action === "volume") {
      const ratio = clamp01(value);
      if (!Number.isFinite(ratio)) return { ok: false, message: "invalid volume" };
      const ok = await callPlayerFirst(player, ["setVolume"], Math.round(ratio * 100));
      return { ok, ...(ok ? {} : { message: "zvuk volume unavailable" }) };
    }

    if (action === "mute") {
      const ok = await callPlayerFirst(player, ["mute"], true);
      return { ok, ...(ok ? {} : { message: "zvuk mute unavailable" }) };
    }

    if (action === "unmute") {
      const ok = await callPlayerFirst(player, ["mute"], false);
      return { ok, ...(ok ? {} : { message: "zvuk unmute unavailable" }) };
    }

    if (action === "muteToggle") {
      const ok = await callPlayerFirst(player, ["mute"], !Boolean(audio.muted));
      return { ok, ...(ok ? {} : { message: "zvuk mute toggle unavailable" }) };
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
      payload = { ok: false, message: String(error || "zvuk bridge error") };
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
