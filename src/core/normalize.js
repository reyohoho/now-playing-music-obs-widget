function asTrimmedString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function asFiniteNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizePlaybackState(raw) {
  const value = String(raw?.playbackState || "").trim().toLowerCase();
  if (value === "playing" || value === "paused" || value === "ended" || value === "idle") {
    return value;
  }
  if (raw?.isPlaying) return "playing";
  if (raw?.ended) return "ended";
  return "paused";
}

const CONTROL_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "seek",
  "volume",
  "mute",
  "unmute",
  "muteToggle",
  "next",
  "previous",
];

function normalizeControlCapabilities(raw) {
  const source = raw?.controlCapabilities && typeof raw.controlCapabilities === "object"
    ? raw.controlCapabilities
    : {};
  const capabilities = {};
  for (const action of CONTROL_ACTIONS) {
    capabilities[action] = source[action] === true;
  }
  return capabilities;
}

export function normalizeSnapshot(raw) {
  const durationSec = asFiniteNonNegative(raw?.durationSec);
  const positionRaw = asFiniteNonNegative(raw?.positionSec);
  const positionSec = durationSec > 0 ? Math.min(positionRaw, durationSec) : positionRaw;
  const progress = durationSec > 0 ? Math.max(0, Math.min(100, (positionSec / durationSec) * 100)) : 0;

  const title = asTrimmedString(raw?.title);
  const artist = asTrimmedString(raw?.artist);
  const sourceId = asTrimmedString(raw?.sourceId);
  const sourceLabel = asTrimmedString(raw?.sourceLabel || sourceId);
  const playbackState = normalizePlaybackState(raw);

  return {
    sourceId,
    sourceLabel,
    title,
    artist,
    trackUrl: asTrimmedString(raw?.trackUrl),
    durationSec,
    positionSec,
    progress,
    coverUrl: asTrimmedString(raw?.coverUrl),
    playbackState,
    isPlaying: playbackState === "playing",
    isLive: Boolean(raw?.isLive),
    volume: Math.max(0, Math.min(1, Number(raw?.volume ?? 1) || 0)),
    muted: Boolean(raw?.muted) || Math.max(0, Math.min(1, Number(raw?.volume ?? 1) || 0)) <= 0.001,
    controlCapabilities: normalizeControlCapabilities(raw),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
  };
}

export function snapshotFingerprint(snapshot) {
  return [
    snapshot.sourceId,
    snapshot.title,
    snapshot.artist,
    Math.floor(snapshot.durationSec),
    Math.floor(snapshot.positionSec),
    Math.floor(snapshot.progress),
    Math.round(Math.max(0, Math.min(1, Number(snapshot.volume) || 0)) * 100),
    snapshot.muted ? "muted" : "unmuted",
    snapshot.trackUrl,
    snapshot.coverUrl,
    snapshot.playbackState,
    snapshot.isLive ? "live" : "vod",
  ].join("|");
}
