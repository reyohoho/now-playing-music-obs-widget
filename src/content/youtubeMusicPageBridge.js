(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphYoutubeMusicToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphYouTubeMusicBridge";

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Number.NaN;
    return Math.max(0, Math.min(1, n));
  }

  function isPlayerApiCandidate(node) {
    if (!node) return false;
    return (
      typeof node.getVolume === "function" &&
      typeof node.setVolume === "function" &&
      typeof node.isMuted === "function" &&
      (typeof node.mute === "function" || typeof node.unMute === "function")
    );
  }

  function getPlayerBar(doc = document) {
    return doc.querySelector("ytmusic-player-bar");
  }

  function getVolumeSlider(doc = document) {
    return doc.querySelector("ytmusic-player-bar #volume-slider");
  }

  function getMedia(doc = document) {
    return doc.querySelector("video.html5-main-video, video, audio");
  }

  function getPlayer(win = window, doc = document) {
    const candidates = [
      win.movie_player,
      win.player,
      win.ytPlayer,
      doc.querySelector("#movie_player"),
      doc.querySelector(".html5-video-player"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (isPlayerApiCandidate(candidate)) return candidate;
    }

    return null;
  }

  function getMuteButton(doc = document) {
    const root = getPlayerBar(doc);
    if (!root) return null;
    const nodes = Array.from(root.querySelectorAll("button, tp-yt-paper-icon-button")).filter(Boolean);
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect?.();
      if (!rect) return false;
      if (rect.width <= 2 || rect.height <= 2) return false;
      const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
      if (!style) return true;
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
      return true;
    };
    const candidates = nodes.filter((node) => {
      const label = normalizeActionLabel(node);
      return (
        label.includes("mute") ||
        label.includes("unmute") ||
        label.includes("выключить звук") ||
        label.includes("включить звук")
      );
    });
    const visibleCandidates = candidates.filter(isVisible);
    const list = visibleCandidates.length ? visibleCandidates : candidates;
    return (
      list.sort((a, b) => {
        const ra = a.getBoundingClientRect?.();
        const rb = b.getBoundingClientRect?.();
        const aa = (ra?.width || 0) * (ra?.height || 0);
        const ab = (rb?.width || 0) * (rb?.height || 0);
        return ab - aa;
      })[0] ||
      nodes.find((node) => {
        const label = normalizeActionLabel(node);
        return (
          label.includes("mute") ||
          label.includes("unmute") ||
          label.includes("выключить звук") ||
          label.includes("включить звук")
        );
      }) ||
      null
    );
  }

  function inferMuted(doc = document, player = null) {
    const muteButton = getMuteButton(doc);
    const muteLabel = normalizeActionLabel(muteButton);
    if (muteLabel) {
      if (muteLabel.includes("unmute") || muteLabel.includes("включить звук")) return true;
      if (muteLabel.includes("mute") || muteLabel.includes("выключить звук")) return false;
    }

    const media = getMedia(doc);
    if (typeof media?.muted === "boolean") return media.muted;

    const mutedRaw =
      typeof player?.isMuted === "function" ? player.isMuted() : null;
    if (typeof mutedRaw === "boolean") return mutedRaw;

    return null;
  }

  function callMethod(player, methodName, args = [], persistHint = false) {
    const fn = player?.[methodName];
    if (typeof fn !== "function") return false;

    const attempts = [];
    if (persistHint) attempts.push([...args, true], [...args, "user"]);
    attempts.push(args);

    for (const callArgs of attempts) {
      try {
        fn.apply(player, callArgs);
        return true;
      } catch (_) {
        // next attempt
      }
    }
    return false;
  }

  function normalizeActionLabel(node) {
    return String(node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || "")
      .toLowerCase()
      .trim();
  }

  function hasAnyLabel(label, parts) {
    return parts.some((part) => label.includes(part));
  }

  function getTransportButtons(doc = document) {
    const root = doc.querySelector("ytmusic-player-bar");
    if (!root) {
      return {
        playPause: null,
        next: null,
        previous: null,
      };
    }

    const nodes = Array.from(root.querySelectorAll("button, tp-yt-paper-icon-button")).filter(Boolean);
    const pick = (matcher) =>
      nodes.find((node) => matcher(normalizeActionLabel(node), node)) || null;

    const previous = pick((label) =>
      hasAnyLabel(label, ["previous", "предыдущ", "назад"])
    );
    const next = pick((label) =>
      hasAnyLabel(label, ["next", "следующ", "вперед", "вперёд"])
    );
    const playPause = pick((label) => {
      if (!label || label.includes("more player controls")) return false;
      return hasAnyLabel(label, [
        "pause",
        "play",
        "resume",
        "пауза",
        "воспроиз",
        "продолж",
      ]);
    });

    return { playPause, next, previous };
  }

  function inferPlaybackState(player, playPauseButton) {
    const state = Number(player?.getPlayerState?.());
    if (state === 1 || state === 3) return "playing";
    if (state === 2) return "paused";

    const label = normalizeActionLabel(playPauseButton);
    if (!label) return "unknown";
    if (label.includes("pause") || label.includes("пауза")) return "playing";
    if (
      label.includes("play") ||
      label.includes("resume") ||
      label.includes("воспроиз") ||
      label.includes("продолж")
    ) {
      return "paused";
    }
    return "unknown";
  }

  function clickButton(button) {
    if (!button) return false;
    button.click();
    return true;
  }

  function executeTransportControl(action, value, player, doc = document) {
    const buttons = getTransportButtons(doc);
    const playbackState = inferPlaybackState(player, buttons.playPause);

    if (action === "next") {
      if (callMethod(player, "nextVideo")) return { ok: true, path: "ytmusic-player-api-next" };
      if (clickButton(buttons.next)) return { ok: true, path: "ytmusic-button-next" };
      return { ok: false, message: "youtube music next unavailable" };
    }

    if (action === "previous") {
      if (callMethod(player, "previousVideo")) return { ok: true, path: "ytmusic-player-api-previous" };
      if (clickButton(buttons.previous)) return { ok: true, path: "ytmusic-button-previous" };
      return { ok: false, message: "youtube music previous unavailable" };
    }

    if (action === "play") {
      if (playbackState === "playing") return { ok: true, path: "ytmusic-already-playing" };
      if (callMethod(player, "playVideo")) return { ok: true, path: "ytmusic-player-api-play" };
      const label = normalizeActionLabel(buttons.playPause);
      const looksLikePlay =
        label.includes("play") ||
        label.includes("resume") ||
        label.includes("воспроиз") ||
        label.includes("продолж");
      if ((playbackState === "paused" || looksLikePlay) && clickButton(buttons.playPause)) {
        return { ok: true, path: "ytmusic-button-play" };
      }
      return { ok: false, message: "youtube music play unavailable" };
    }

    if (action === "pause") {
      if (playbackState === "paused") return { ok: true, path: "ytmusic-already-paused" };
      if (callMethod(player, "pauseVideo")) return { ok: true, path: "ytmusic-player-api-pause" };
      const label = normalizeActionLabel(buttons.playPause);
      const looksLikePause = label.includes("pause") || label.includes("пауза");
      if ((playbackState === "playing" || looksLikePause) && clickButton(buttons.playPause)) {
        return { ok: true, path: "ytmusic-button-pause" };
      }
      return { ok: false, message: "youtube music pause unavailable" };
    }

    if (action === "toggle") {
      if (playbackState === "playing") {
        if (callMethod(player, "pauseVideo")) return { ok: true, path: "ytmusic-player-api-toggle-pause" };
      } else if (playbackState === "paused") {
        if (callMethod(player, "playVideo")) return { ok: true, path: "ytmusic-player-api-toggle-play" };
      }
      if (clickButton(buttons.playPause)) return { ok: true, path: "ytmusic-button-toggle" };
      return { ok: false, message: "youtube music toggle unavailable" };
    }

    if (action === "seek") {
      const targetSec = Number(value);
      if (!Number.isFinite(targetSec)) return { ok: false, message: "invalid seek" };
      if (callMethod(player, "seekTo", [Math.max(0, targetSec), true])) {
        return { ok: true, path: "ytmusic-player-api-seek" };
      }
      const media = doc.querySelector("video, audio");
      if (media && Number.isFinite(media.duration || 0)) {
        media.currentTime = Math.max(0, targetSec);
        return { ok: true, path: "ytmusic-media-seek" };
      }
      return { ok: false, message: "youtube music seek unavailable" };
    }

    return { ok: false, message: `unsupported action ${action}` };
  }

  function readSnapshot(doc = document, win = window) {
    const player = getPlayer(win, doc);
    const host = getPlayerBar(doc);
    const slider = getVolumeSlider(doc);
    const media = getMedia(doc);
    if (!player && !slider) return { ok: false, message: "ytmusic player not found" };

    const sliderNow = Number(slider?.getAttribute?.("aria-valuenow") ?? slider?.value);
    const hostVolume = Number(host?.volume);
    const volumeRaw = Number(player?.getVolume?.());
    const currentTimeRaw = Number(player?.getCurrentTime?.());
    const durationRaw = Number(player?.getDuration?.());
    const stateRaw = Number(player?.getPlayerState?.());
    const mutedRaw = inferMuted(doc, player);

    return {
      ok: true,
      sliderRaw: Number.isFinite(sliderNow) ? sliderNow : null,
      hostVolume: Number.isFinite(hostVolume) ? hostVolume : null,
      volumeRaw: Number.isFinite(volumeRaw) ? volumeRaw : null,
      volume: Number.isFinite(sliderNow)
        ? clamp01(sliderNow / 100)
        : Number.isFinite(volumeRaw)
          ? clamp01(volumeRaw / 100)
          : null,
      muted: typeof mutedRaw === "boolean" ? mutedRaw : null,
      currentTime: Number.isFinite(currentTimeRaw) ? currentTimeRaw : null,
      duration: Number.isFinite(durationRaw) ? durationRaw : null,
      state: Number.isFinite(stateRaw) ? stateRaw : null,
    };
  }

  function setVolumeViaSlider(doc, percent) {
    const slider = getVolumeSlider(doc);
    if (!slider) return { ok: false, message: "ytmusic volume slider not found" };

    const beforeNow = Number(slider.getAttribute("aria-valuenow") ?? slider.value);
    try {
      slider.value = percent;
    } catch (_) {
      // no-op
    }
    try {
      if ("immediateValue" in slider) slider.immediateValue = percent;
    } catch (_) {
      // no-op
    }

    slider.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    const afterNow = Number(slider.getAttribute("aria-valuenow") ?? slider.value);
    const closeEnough = Number.isFinite(afterNow) ? Math.abs(afterNow - percent) <= 1 : false;

    return {
      ok: closeEnough,
      beforeNow: Number.isFinite(beforeNow) ? beforeNow : null,
      afterNow: Number.isFinite(afterNow) ? afterNow : null,
      target: percent,
    };
  }

  function executeControl(action, value) {
    const player = getPlayer(window, document);
    const hasSlider = Boolean(getVolumeSlider(document));
    const transportOnly =
      action === "play" ||
      action === "pause" ||
      action === "toggle" ||
      action === "next" ||
      action === "previous" ||
      action === "seek";
    if ((!player && !hasSlider) || (transportOnly && !player)) {
      return { ok: false, message: "ytmusic player not found" };
    }

    if (transportOnly) {
      return executeTransportControl(action, value, player, document);
    }

    if (action === "volume") {
      const ratio = clamp01(value);
      if (!Number.isFinite(ratio)) return { ok: false, message: "invalid volume" };
      const target = Math.round(ratio * 100);
      const before = readSnapshot(document, window);

      const sliderResult = setVolumeViaSlider(document, target);

      if (!sliderResult.ok && player) {
        callMethod(player, "setVolume", [target], true);
      }

      const after = readSnapshot(document, window);
      const closeEnough =
        Number.isFinite(Number(after?.sliderRaw))
          ? Math.abs(Number(after.sliderRaw) - target) <= 1
          : Number.isFinite(Number(after?.volumeRaw))
            ? Math.abs(Number(after.volumeRaw) - target) <= 1
            : false;

      return {
        ok: Boolean(sliderResult.ok || closeEnough),
        before: before.ok ? before : null,
        after: after.ok ? after : null,
        target,
        sliderResult,
      };
    }

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
      } else if (request.kind === "snapshot") {
        payload = readSnapshot(document, window);
      } else {
        payload = { ok: false, message: "unknown request kind" };
      }
    } catch (error) {
      payload = { ok: false, message: String(error || "ytmusic bridge error") };
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
