function asTrimmed(value) {
  return String(value || "").trim();
}

const PREFERRED_IMAGE_EXTENSIONS = new Set(["webp", "jpeg", "jpg", "png"]);
const OTHER_IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "bmp",
  "svg",
  "ico",
  "apng",
  "jfif",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

function imageExtensionScore(rawUrl) {
  const url = asTrimmed(rawUrl).toLowerCase();
  if (!url) return 0;
  if (/^data:image\//.test(url)) return 220;

  const match = url.match(/\.([a-z0-9]{2,8})(?:$|[?#])/i);
  const ext = String(match?.[1] || "").toLowerCase();
  if (!ext) return 0;
  if (PREFERRED_IMAGE_EXTENSIONS.has(ext)) return 120;
  if (OTHER_IMAGE_EXTENSIONS.has(ext)) return 90;
  return 0;
}

function artworkAreaScore(rawSizes) {
  const sizes = asTrimmed(rawSizes).toLowerCase();
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

function pickArtworkCoverUrl(artworkList) {
  const list = Array.isArray(artworkList) ? artworkList : [];
  if (!list.length) return "";

  let bestSrc = "";
  let bestScore = -1;
  for (let index = 0; index < list.length; index += 1) {
    const artwork = list[index] || {};
    const src = asTrimmed(artwork.src);
    if (!src) continue;

    const score = imageExtensionScore(src) + artworkAreaScore(artwork.sizes) + Math.min(12, index);
    if (score > bestScore) {
      bestScore = score;
      bestSrc = src;
    }
  }

  return bestSrc;
}

function asPlaybackState(value) {
  const state = asTrimmed(value).toLowerCase();
  if (state === "playing" || state === "paused" || state === "ended" || state === "idle") {
    return state;
  }
  return "";
}

export function readMediaSessionSnapshot(win = window) {
  try {
    const mediaSession = win?.navigator?.mediaSession;
    const metadata = mediaSession?.metadata;

    const artwork = Array.isArray(metadata?.artwork) ? metadata.artwork : [];
    const coverUrl = pickArtworkCoverUrl(artwork);

    return {
      title: asTrimmed(metadata?.title),
      artist: asTrimmed(metadata?.artist),
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

function hasUsableMediaSessionMetadata(mediaSessionSnapshot) {
  return Boolean(
    asTrimmed(mediaSessionSnapshot?.title) ||
      asTrimmed(mediaSessionSnapshot?.artist) ||
      asTrimmed(mediaSessionSnapshot?.coverUrl)
  );
}

function buildLegacyMediaBase(mediaSnapshot, mediaSessionSnapshot, hasPrimaryMedia) {
  const media = mediaSnapshot || {};
  const mediaSession = mediaSessionSnapshot || {};
  const playbackState = asPlaybackState(mediaSession.playbackState);

  if (!hasPrimaryMedia) {
    return {
      ...media,
      playbackState: playbackState || media.playbackState || "idle",
      title: asTrimmed(mediaSession.title),
      artist: asTrimmed(mediaSession.artist),
      coverUrl: asTrimmed(mediaSession.coverUrl),
    };
  }

  return {
    ...media,
    title: asTrimmed(mediaSession.title),
    artist: asTrimmed(mediaSession.artist),
    coverUrl: asTrimmed(mediaSession.coverUrl) || asTrimmed(media.coverUrl),
  };
}

export function applySnapshotStrategy({
  strategy = "legacy",
  mediaSnapshot = {},
  extractedSnapshot = {},
  mediaSessionSnapshot = {},
  hasPrimaryMedia = false,
  strictMediaMetadata = false,
} = {}) {
  const extracted = extractedSnapshot || {};
  const media = mediaSnapshot || {};
  const mediaSession = mediaSessionSnapshot || {};

  if (strategy !== "media-session-first") {
    const legacyBase = buildLegacyMediaBase(media, mediaSession, hasPrimaryMedia);
    return {
      snapshot: {
        ...legacyBase,
        ...extracted,
      },
      snapshotSource: "fallback",
    };
  }

  const fallbackSnapshot = {
    ...media,
    ...extracted,
  };

  if (!hasUsableMediaSessionMetadata(mediaSession)) {
    if (strictMediaMetadata) {
      const playbackState = asPlaybackState(mediaSession.playbackState);
      return {
        snapshot: {
          ...fallbackSnapshot,
          title: "",
          artist: "",
          coverUrl: "",
          ...(playbackState ? { playbackState } : {}),
        },
        snapshotSource: "mediaSession-empty",
      };
    }

    return {
      snapshot: fallbackSnapshot,
      snapshotSource: "fallback",
    };
  }

  const override = {};
  const title = asTrimmed(mediaSession.title);
  const artist = asTrimmed(mediaSession.artist);
  const coverUrl = asTrimmed(mediaSession.coverUrl);
  const playbackState = asPlaybackState(mediaSession.playbackState);

  if (title) override.title = title;
  if (artist) override.artist = artist;
  if (coverUrl) override.coverUrl = coverUrl;
  if (playbackState) override.playbackState = playbackState;

  return {
    snapshot: {
      ...fallbackSnapshot,
      ...override,
    },
    snapshotSource: "mediaSession",
  };
}
