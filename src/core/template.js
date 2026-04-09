import { toClock } from "@/core/time";

export function renderTrackTemplate(template, snapshot) {
  const safeTemplate = String(template || "{{artist}} - {{title}}");
  const s = snapshot || {};

  const map = {
    title: s.title || "",
    artist: s.artist || "",
    link: s.trackUrl || "",
    trackUrl: s.trackUrl || "",
    source: s.sourceLabel || s.sourceId || "",
    duration: toClock(s.durationSec || 0),
    position: toClock(s.positionSec || 0),
    progress: `${Math.round(Number(s.progress) || 0)}%`,
    isPlaying: s.isPlaying ? "playing" : "paused",
  };

  return safeTemplate.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => map[key] ?? "");
}
