(() => {
  const script = document.currentScript;
  const token = String(script?.dataset?.nphYoutubeToken || "").trim();
  if (!token) return;

  const CHANNEL_KEY = "__nphYouTubeBridge";

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Number.NaN;
    return Math.max(0, Math.min(1, n));
  }

  function parseLocationUrl(win = window) {
    try {
      return new URL(String(win?.location?.href || ""));
    } catch (_) {
      const hostname = String(win?.location?.hostname || "").trim().toLowerCase() || "www.youtube.com";
      const pathname = String(win?.location?.pathname || "/").trim() || "/";
      const rawSearch = String(win?.location?.search || "").trim();
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
  }

  function parseVideoIdFromLocation(win = window) {
    const url = parseLocationUrl(win);
    if (!url) return "";

    if (url.pathname === "/watch") return String(url.searchParams.get("v") || "").trim();
    if (url.pathname.startsWith("/embed/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.pathname.startsWith("/shorts/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.pathname.startsWith("/live/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.hostname === "youtu.be") return String(url.pathname.replace(/^\//, "").split("/")[0] || "").trim();

    const queryId = String(
      url.searchParams.get("v") ||
        url.searchParams.get("vi") ||
        url.searchParams.get("video_id") ||
        url.searchParams.get("video") ||
        ""
    ).trim();
    return queryId;
  }

  function parseVideoIdFromUrlLike(raw, base = "https://www.youtube.com") {
    const value = String(raw || "").trim();
    if (!value) return "";

    let url;
    try {
      url = new URL(value, base);
    } catch (_) {
      return "";
    }

    if (url.pathname === "/watch") return String(url.searchParams.get("v") || "").trim();
    if (url.pathname.startsWith("/embed/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.pathname.startsWith("/shorts/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.pathname.startsWith("/live/")) return String(url.pathname.split("/")[2] || "").trim();
    if (url.hostname === "youtu.be") return String(url.pathname.replace(/^\//, "").split("/")[0] || "").trim();
    return String(
      url.searchParams.get("v") ||
        url.searchParams.get("vi") ||
        url.searchParams.get("video_id") ||
        url.searchParams.get("video") ||
        ""
    ).trim();
  }

  function parseVideoIdFromDocumentLinks(doc = document) {
    const selectors = [
      "a.ytp-title-link[href]",
      "a[href*='youtube.com/watch?v=']",
      "a[href*='youtu.be/']",
      "a[href*='watch?v=']",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(doc.querySelectorAll(selector));
      for (const node of nodes) {
        const href = String(node?.getAttribute?.("href") || "").trim();
        const id = parseVideoIdFromUrlLike(href, "https://www.youtube.com");
        if (id) return id;
      }
    }

    return "";
  }

  function parseListIdFromDocumentLinks(doc = document) {
    const selectors = [
      "a.ytp-title-link[href]",
      "a[href*='youtube.com/watch?']",
      "a[href*='watch?']",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(doc.querySelectorAll(selector));
      for (const node of nodes) {
        const href = String(node?.getAttribute?.("href") || "").trim();
        if (!href) continue;
        try {
          const url = new URL(href, "https://www.youtube.com");
          const listId = String(url.searchParams.get("list") || "").trim();
          if (listId) return listId;
        } catch (_) {
          // no-op
        }
      }
    }

    return "";
  }

  function isPlayerApiCandidate(node) {
    if (!node) return false;
    return (
      typeof node.getVolume === "function" &&
      typeof node.setVolume === "function" &&
      (typeof node.mute === "function" || typeof node.unMute === "function")
    );
  }

  function isPlayerReadCandidate(node) {
    if (!node) return false;
    return (
      typeof node.getVideoData === "function" ||
      typeof node.getPlayerState === "function" ||
      typeof node.getVolume === "function"
    );
  }

  function playerStateRank(player) {
    const state = Number(player?.getPlayerState?.());
    if (state === 1) return 5;
    if (state === 2) return 4;
    if (state === 3) return 3;
    if (state === 5) return 2;
    if (state === -1) return 1;
    return 0;
  }

  function getCandidatePlayers(
    win = window,
    doc = document,
    predicate = isPlayerApiCandidate
  ) {
    const out = [];
    const seen = new Set();

    const push = (candidate) => {
      if (!predicate(candidate)) return;
      if (seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
    };

    push(doc.querySelector("#movie_player"));
    push(doc.querySelector(".html5-video-player"));
    push(win.movie_player);
    push(win.ytPlayer);
    push(win.player);

    try {
      const ytPlayers = win?.yt?.player?.getPlayers?.();
      if (ytPlayers && typeof ytPlayers === "object") {
        for (const candidate of Object.values(ytPlayers)) push(candidate);
      }
    } catch (_) {
      // ignore
    }

    return out;
  }

  function describePlayer(player) {
    if (!player) return null;
    const data = player?.getVideoData?.() || {};
    return {
      videoId: String(data.video_id || "").trim(),
      title: String(data.title || "").trim(),
      state: Number(player?.getPlayerState?.()),
      volume: Number(player?.getVolume?.()),
      muted: Boolean(player?.isMuted?.()),
    };
  }

  function pickPrimaryPlayer(win = window, doc = document, predicate = isPlayerApiCandidate) {
    const candidates = getCandidatePlayers(win, doc, predicate);
    if (!candidates.length) {
      return {
        player: null,
        debug: {
          reason: "no-candidates",
          candidateCount: 0,
          pageVideoId: parseVideoIdFromLocation(win),
        },
      };
    }

    const pageVideoId = parseVideoIdFromLocation(win);
    if (pageVideoId) {
      for (const candidate of candidates) {
        const videoId = String(candidate?.getVideoData?.()?.video_id || "").trim();
        if (videoId && videoId === pageVideoId) {
          return {
            player: candidate,
            debug: {
              reason: "matched-page-video-id",
              candidateCount: candidates.length,
              pageVideoId,
              selected: describePlayer(candidate),
            },
          };
        }
      }
    }

    candidates.sort((a, b) => playerStateRank(b) - playerStateRank(a));
    const selected = candidates[0] || null;
    return {
      player: selected,
      debug: {
        reason: "highest-player-state-rank",
        candidateCount: candidates.length,
        pageVideoId,
        selected: describePlayer(selected),
      },
    };
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
        // next
      }
    }
    return false;
  }

  function executeControl(action, value) {
    const picked = pickPrimaryPlayer(window, document);
    const player = picked?.player || null;
    if (!player) {
      return {
        ok: false,
        message: "youtube player not found",
        debug: picked?.debug || null,
      };
    }

    if (action === "volume") {
      const target = clamp01(value);
      if (!Number.isFinite(target)) return { ok: false, message: "invalid volume" };
      const percent = Math.round(target * 100);
      const before = Number(player.getVolume?.());
      const beforeMuted = Boolean(player.isMuted?.());
      const setOk = callMethod(player, "setVolume", [percent], true);
      if (target <= 0) callMethod(player, "mute", [], true);
      else callMethod(player, "unMute", [], true);
      const after = Number(player.getVolume?.());
      const afterMuted = Boolean(player.isMuted?.());
      return {
        ok: Boolean(setOk),
        before,
        after,
        target: percent,
        beforeMuted,
        afterMuted,
        debug: picked?.debug || null,
      };
    }

    if (action === "mute") {
      const ok = callMethod(player, "mute", [], true);
      return {
        ok: Boolean(ok && player.isMuted?.()),
        muted: Boolean(player.isMuted?.()),
        debug: picked?.debug || null,
      };
    }

    if (action === "unmute") {
      const ok = callMethod(player, "unMute", [], true);
      return {
        ok: Boolean(ok && !player.isMuted?.()),
        muted: Boolean(player.isMuted?.()),
        debug: picked?.debug || null,
      };
    }

    if (action === "muteToggle") {
      const isMuted = Boolean(player.isMuted?.());
      const ok = isMuted
        ? callMethod(player, "unMute", [], true)
        : callMethod(player, "mute", [], true);
      return {
        ok: Boolean(ok),
        muted: Boolean(player.isMuted?.()),
        debug: picked?.debug || null,
      };
    }

    return {
      ok: false,
      message: `unsupported action ${action}`,
      debug: picked?.debug || null,
    };
  }

  function readSnapshot(win = window, doc = document) {
    const picked = pickPrimaryPlayer(win, doc, isPlayerReadCandidate);
    const player = picked?.player || null;
    const fromPlayer = String(player?.getVideoData?.()?.video_id || "").trim();
    const fromDocumentLinks = parseVideoIdFromDocumentLinks(doc);
    const fromLocation = parseVideoIdFromLocation(win);
    const videoId = fromPlayer || fromDocumentLinks || fromLocation;
    const locationUrl = parseLocationUrl(win);
    const listId = parseListIdFromDocumentLinks(doc) || String(locationUrl?.searchParams?.get("list") || "").trim();

    return {
      ok: Boolean(videoId),
      videoId: videoId || "",
      listId: listId || "",
      debug: picked?.debug || null,
      message: videoId ? "" : "youtube video id unavailable",
    };
  }

  const onMessage = (event) => {
    const data = event.data;
    if (!data || data[CHANNEL_KEY] !== true || data.kind !== "request" || data.token !== token) return;

    const id = data.id;
    const request = data.request || {};
    let payload;

    try {
      if (request.kind === "control") {
        payload = executeControl(request.action, request.value);
      } else if (request.kind === "snapshot") {
        payload = readSnapshot(window, document);
      } else {
        payload = { ok: false, message: "unknown request kind" };
      }
    } catch (error) {
      payload = { ok: false, message: String(error || "youtube bridge error") };
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
