export function normalizeVolumeValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.max(0, Math.min(1, n));
}

export function normalizeWrapperVolumeByHost(value) {
  const raw = typeof value === "object" && value ? value : {};
  const out = {};
  for (const [hostRaw, volumeRaw] of Object.entries(raw)) {
    const host = String(hostRaw || "").trim().toLowerCase();
    if (!host) continue;
    const volume = normalizeVolumeValue(volumeRaw);
    if (!Number.isFinite(volume)) continue;
    out[host] = volume;
  }
  return out;
}

export function rememberWrapperVolumeByHost(currentMap, host, volume) {
  const normalizedHost = String(host || "").trim().toLowerCase();
  const normalizedVolume = normalizeVolumeValue(volume);
  if (!normalizedHost || !Number.isFinite(normalizedVolume)) {
    return {
      changed: false,
      map: currentMap || {},
      host: "",
      volume: Number.NaN,
    };
  }

  const prev = normalizeVolumeValue(currentMap?.[normalizedHost]);
  if (Number.isFinite(prev) && Math.abs(prev - normalizedVolume) < 0.001) {
    return {
      changed: false,
      map: currentMap || {},
      host: normalizedHost,
      volume: normalizedVolume,
    };
  }

  return {
    changed: true,
    map: {
      ...(currentMap || {}),
      [normalizedHost]: normalizedVolume,
    },
    host: normalizedHost,
    volume: normalizedVolume,
  };
}

export function resolveVolumeForControlAction(action, value, snapshot, rememberedVolume) {
  if (action === "volume") return normalizeVolumeValue(value);
  if (action === "mute") return 0;
  if (action === "unmute") {
    const fromSnapshot = normalizeVolumeValue(snapshot?.volume);
    if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) return fromSnapshot;
    const remembered = normalizeVolumeValue(rememberedVolume);
    if (Number.isFinite(remembered) && remembered > 0) return remembered;
    return 1;
  }
  if (action === "muteToggle") {
    const currentlyMuted = Boolean(snapshot?.muted);
    if (currentlyMuted) {
      const fromSnapshot = normalizeVolumeValue(snapshot?.volume);
      if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) return fromSnapshot;
      const remembered = normalizeVolumeValue(rememberedVolume);
      if (Number.isFinite(remembered) && remembered > 0) return remembered;
      return 1;
    }
    return 0;
  }
  return Number.NaN;
}
