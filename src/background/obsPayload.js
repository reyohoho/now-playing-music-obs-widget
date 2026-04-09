function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildObsTextPayload(inputName, renderedLine) {
  return {
    inputName: String(inputName || "NowPlaying"),
    inputSettings: { text: String(renderedLine || "") },
    overlay: true,
  };
}

export function buildObsBrowserEventPayload(eventName, snapshot, extra = {}) {
  return {
    vendorName: "obs-browser",
    requestType: "emit_event",
    requestData: {
      event_name: eventName || "nowplaying:update",
      event_data: {
        hasActiveSource: Boolean(snapshot),
        title: snapshot?.title || "",
        artist: snapshot?.artist || "",
        durationSec: safeNumber(snapshot?.durationSec, 0),
        positionSec: safeNumber(snapshot?.positionSec, 0),
        progress: safeNumber(snapshot?.progress, 0),
        coverUrl: snapshot?.coverUrl || "",
        link: snapshot?.trackUrl || "",
        trackUrl: snapshot?.trackUrl || "",
        isPlaying: Boolean(snapshot?.isPlaying),
        sourceId: snapshot?.sourceId || "",
        sourceLabel: snapshot?.sourceLabel || "",
        customCss: String(extra?.customCss || ""),
      },
    },
  };
}
