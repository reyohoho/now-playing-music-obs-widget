import { clamp01, toFiniteOrNaN } from "@/sources/shared/number";

export function hasAudioState(state) {
  return Number.isFinite(Number(state?.volume)) || typeof state?.muted === "boolean";
}

export function buildAudioState({ volume, muted }) {
  const normalizedVolume = clamp01(volume);
  return {
    ...(Number.isFinite(normalizedVolume) ? { volume: normalizedVolume } : {}),
    ...(typeof muted === "boolean" ? { muted } : {}),
  };
}

export function buildAudioStateFromRaw(volumeRaw, volumeScale, muted) {
  const raw = toFiniteOrNaN(volumeRaw);
  const scale = toFiniteOrNaN(volumeScale);
  const volume =
    Number.isFinite(raw) && Number.isFinite(scale) && scale > 0
      ? clamp01(raw / scale)
      : Number.NaN;

  return buildAudioState({ volume, muted });
}

export function buildAudioDiagnosticsEntry({
  present,
  volumeRaw,
  volumeScale = 1,
  muted,
  extra,
}) {
  const raw = toFiniteOrNaN(volumeRaw);
  const scale = toFiniteOrNaN(volumeScale);
  const volume =
    Number.isFinite(raw) && Number.isFinite(scale) && scale > 0
      ? clamp01(raw / scale)
      : Number.NaN;

  return {
    present: Boolean(present),
    volumeRaw: Number.isFinite(raw) ? raw : null,
    volume: Number.isFinite(volume) ? volume : null,
    muted: typeof muted === "boolean" ? muted : null,
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}
