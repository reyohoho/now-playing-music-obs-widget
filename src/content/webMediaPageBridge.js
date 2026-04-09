(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphWebMediaToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphWebMediaBridge";
  const POLL_INTERVAL_MS = 1200;
  const snapshotState = {
    key: "",
    primaryMediaRef: null,
  };

  function asText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function asPlaybackState(value) {
    const state = asText(value).toLowerCase();
    if (state === "playing" || state === "paused" || state === "ended") return state;
    return "";
  }

  const PRIMARY_IMAGE_EXTENSIONS = new Set(["webp", "jpeg", "jpg", "png"]);
  const SECONDARY_IMAGE_EXTENSIONS = new Set(["avif", "gif", "bmp", "svg", "ico", "apng", "jfif", "tif", "tiff"]);

  function imageExtensionScore(rawUrl) {
    const url = asText(rawUrl).toLowerCase();
    if (!url) return 0;
    if (/^data:image\//.test(url)) return 220;
    const match = url.match(/\.([a-z0-9]{2,8})(?:$|[?#])/i);
    const ext = asText(match?.[1]).toLowerCase();
    if (!ext) return 0;
    if (PRIMARY_IMAGE_EXTENSIONS.has(ext)) return 120;
    if (SECONDARY_IMAGE_EXTENSIONS.has(ext)) return 90;
    return 0;
  }

  function artworkAreaScore(rawSizes) {
    const sizes = asText(rawSizes).toLowerCase();
    if (!sizes) return 0;
    const tokens = sizes.split(/\s+/g).filter(Boolean);
    let best = 0;
    for (const token of tokens) {
      const match = token.match(/^(\d{2,5})x(\d{2,5})$/);
      if (!match) continue;
      const w = Number(match[1]);
      const h = Number(match[2]);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
      best = Math.max(best, w * h);
    }
    if (best <= 0) return 0;
    return Math.min(80, Math.round(Math.log10(best + 1) * 20));
  }

  function pickArtworkCoverUrl(rawArtwork) {
    const artworkList = Array.isArray(rawArtwork) ? rawArtwork : [];
    let bestSrc = "";
    let bestScore = -1;
    for (let index = 0; index < artworkList.length; index += 1) {
      const artwork = artworkList[index] || {};
      const src = asText(artwork.src);
      if (!src) continue;
      const score = imageExtensionScore(src) + artworkAreaScore(artwork.sizes) + Math.min(12, index);
      if (score > bestScore) {
        bestScore = score;
        bestSrc = src;
      }
    }
    return bestSrc;
  }

  function finiteOrNaN(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }

  function mediaAreaScore(node) {
    if (!node) return 0;

    const rect = node.getBoundingClientRect?.();
    const rectArea = finiteOrNaN(rect?.width) * finiteOrNaN(rect?.height);
    if (Number.isFinite(rectArea) && rectArea > 0) return rectArea;

    const clientArea = finiteOrNaN(node?.clientWidth) * finiteOrNaN(node?.clientHeight);
    if (Number.isFinite(clientArea) && clientArea > 0) return clientArea;

    const intrinsicArea = finiteOrNaN(node?.videoWidth || node?.width) * finiteOrNaN(node?.videoHeight || node?.height);
    if (Number.isFinite(intrinsicArea) && intrinsicArea > 0) return intrinsicArea;

    return 0;
  }

  function primaryMedia(doc = document) {
    const mediaList = [...(doc.querySelectorAll?.("audio,video") || [])];
    if (!mediaList.length) {
      snapshotState.primaryMediaRef = null;
      return null;
    }

    const preferred = snapshotState.primaryMediaRef;
    if (preferred && mediaList.includes(preferred) && preferred.isConnected !== false) {
      const hasAlternativeNonEnded = mediaList.some((node) => node !== preferred && node?.ended !== true);
      if (!(preferred.ended && hasAlternativeNonEnded)) {
        return preferred;
      }
    }

    const videos = mediaList
      .map((node, index) => ({
        node,
        index,
        tag: asText(node?.tagName).toLowerCase(),
        area: mediaAreaScore(node),
      }))
      .filter((item) => item.tag === "video");

    if (videos.length) {
      videos.sort((a, b) => b.area - a.area || a.index - b.index);
      const chosen =
        (videos[0].area > 0
          ? videos[0].node
          : videos.find((item) => item.node && item.node.paused === false && item.node.ended !== true)?.node ||
            videos[0].node) || null;
      snapshotState.primaryMediaRef = chosen;
      return chosen;
    }

    const chosen = mediaList.find((node) => node && node.paused === false && node.ended !== true) || mediaList[0];
    snapshotState.primaryMediaRef = chosen || null;
    return chosen;
  }

  function readMediaSnapshot(doc = document) {
    const media = primaryMedia(doc);
    if (!media) return {};

    const durationSec = finiteOrNaN(media.duration);
    const positionSec = finiteOrNaN(media.currentTime);
    const volume = finiteOrNaN(media.volume);
    const muted = Boolean(media.muted);

    let playbackState = "paused";
    if (media.ended) playbackState = "ended";
    else if (!media.paused) playbackState = "playing";

    return {
      ...(Number.isFinite(durationSec) ? { durationSec: Math.max(0, durationSec) } : {}),
      ...(Number.isFinite(positionSec) ? { positionSec: Math.max(0, positionSec) } : {}),
      ...(Number.isFinite(volume) ? { volume: Math.max(0, Math.min(1, volume)) } : {}),
      muted,
      playbackState,
    };
  }

  function readMediaSessionSnapshot(win = window) {
    try {
      const mediaSession = win?.navigator?.mediaSession;
      const metadata = mediaSession?.metadata;
      const artworkList = Array.isArray(metadata?.artwork) ? metadata.artwork : [];
      const coverUrl = pickArtworkCoverUrl(artworkList);

      return {
        title: asText(metadata?.title),
        artist: asText(metadata?.artist),
        coverUrl,
        playbackState: asPlaybackState(mediaSession?.playbackState),
      };
    } catch (_) {
      return {
        title: "",
        artist: "",
        coverUrl: "",
        playbackState: "",
      };
    }
  }

  function readTrackUrl(doc = document, win = window) {
    const direct = [
      doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      win.location?.href,
    ];

    for (const candidate of direct) {
      const value = asText(candidate);
      if (!value) continue;
      try {
        return new URL(value, win.location?.href || "https://example.invalid/").toString();
      } catch (_) {
        // no-op
      }
    }

    return "";
  }

  function buildSnapshot() {
    const fromMedia = readMediaSnapshot(document);
    const fromSession = readMediaSessionSnapshot(window);

    const playbackState =
      asPlaybackState(fromSession.playbackState) || asPlaybackState(fromMedia.playbackState) || "";

    const snapshot = {
      ...(fromSession.title ? { title: fromSession.title } : {}),
      ...(fromSession.artist ? { artist: fromSession.artist } : {}),
      ...(fromSession.coverUrl ? { coverUrl: fromSession.coverUrl } : {}),
      ...(playbackState ? { playbackState } : {}),
      ...(Number.isFinite(fromMedia.durationSec) ? { durationSec: fromMedia.durationSec } : {}),
      ...(Number.isFinite(fromMedia.positionSec) ? { positionSec: fromMedia.positionSec } : {}),
      ...(Number.isFinite(fromMedia.volume) ? { volume: fromMedia.volume } : {}),
      ...(typeof fromMedia.muted === "boolean" ? { muted: fromMedia.muted } : {}),
    };

    const trackUrl = readTrackUrl(document, window);
    if (trackUrl) snapshot.trackUrl = trackUrl;
    return snapshot;
  }

  function postResponse(id, payload) {
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
  }

  function emitSnapshotIfChanged(force = false) {
    const snapshot = buildSnapshot();
    let nextKey = "";
    try {
      nextKey = JSON.stringify(snapshot);
    } catch (_) {
      nextKey = "";
    }

    if (!force && nextKey === snapshotState.key) return;
    snapshotState.key = nextKey;

    window.postMessage(
      {
        [CHANNEL_KEY]: true,
        kind: "event",
        event: "snapshot",
        token,
        snapshot,
      },
      "*"
    );
  }

  const onMessage = (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data[CHANNEL_KEY] !== true || data.kind !== "request" || data.token !== token) return;

    const id = data.id;
    const request = data.request || {};

    if (request.kind === "snapshot") {
      postResponse(id, { ok: true, snapshot: buildSnapshot() });
      return;
    }

    postResponse(id, { ok: false, message: "unknown request kind" });
  };

  window.addEventListener("message", onMessage);

  const mediaEvents = [
    "play",
    "pause",
    "timeupdate",
    "durationchange",
    "loadedmetadata",
    "seeked",
    "volumechange",
    "ended",
  ];
  for (const eventName of mediaEvents) {
    document.addEventListener(eventName, () => emitSnapshotIfChanged(), true);
  }

  const observer = new MutationObserver(() => emitSnapshotIfChanged());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["content", "href", "title", "src"],
  });

  setInterval(() => emitSnapshotIfChanged(), POLL_INTERVAL_MS);
  emitSnapshotIfChanged(true);
})();
