import * as Slider from "@radix-ui/react-slider";
import {
  DotsVerticalIcon,
  PauseIcon,
  PlayIcon,
  SpeakerLoudIcon,
  SpeakerOffIcon,
  TrackNextIcon,
  TrackPreviousIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { DropdownMenu, IconButton } from "@radix-ui/themes";
import coverFallbackDarkUrl from "@/assets/cover-fallback-dark.png";
import coverFallbackLightUrl from "@/assets/cover-fallback-light.png";
import { toClock } from "@/core/time";
import { MSG } from "@/shared/messages";
import {
  findMatchingWrapperRule,
  isWrapperSourceId,
  normalizeWrapperControlSelectors,
  wrapperRuleIdFromSourceId,
} from "@/shared/wrapperRules";
import {
  DEFAULT_UNMUTE_VOLUME,
  VOLUME_EPSILON,
  collectTabSeedSourceIds,
  copyTextToClipboard,
  delay,
  normalizePlaybackState,
  runtimeMessage,
  sessionKey,
  waitTabClosed,
} from "@/popup/popupHelpers";
import { SwipeActionCard } from "@/popup/components/SwipeActionCard";

export function SessionCard({
  session,
  isPrimary,
  t,
  activeSessions = [],
  wrapperRules = [],
  wrapperRuleById,
  sessionById,
  drafts,
  sendSessionControl,
  sendSetPrimarySession,
  sendSeek,
  refreshState,
  setActionInfo,
  setConnectionError,
  openWrapperOverlayOnTab,
  activateTabById,
  onLivePreviewHoverChange,
  resolvedThemeAppearance = "dark",
}) {
  const id = sessionKey(session);
  const playbackDraft = drafts.playbackDraftsRef.current.get(id);
  const playbackState = normalizePlaybackState(playbackDraft || session.playbackState);

  const durationSec = Math.max(0, Number(session.durationSec) || 0);
  let positionSec = Math.max(0, Number(session.positionSec) || 0);

  const seekDraft = drafts.seekDraftsRef.current.get(id);
  if (Number.isFinite(seekDraft)) {
    positionSec = seekDraft;
  } else if (playbackState === "playing") {
    const updatedAt = Number(session.updatedAt) || drafts.nowMsRef.current;
    positionSec += Math.max(0, (drafts.nowMsRef.current - updatedAt) / 1000);
  }
  if (durationSec > 0) positionSec = Math.min(positionSec, durationSec);
  const hasFiniteDuration = durationSec > 0;
  const isLiveWithoutDuration = !hasFiniteDuration;
  const hideTimeline = !hasFiniteDuration && !isLiveWithoutDuration;
  const timeLabel = isLiveWithoutDuration
    ? t("popup.track.live")
    : `${toClock(positionSec)} / ${toClock(durationSec)}`;

  const volumeDraft = drafts.volumeDraftsRef.current.get(id);
  const volume = Math.max(0, Math.min(1, Number.isFinite(volumeDraft) ? volumeDraft : Number(session.volume) || 0));
  const volumePercent = Math.max(0, Math.min(100, Math.round(volume * 100)));
  const muted = Boolean(session.muted) || volume <= VOLUME_EPSILON;
  const isLiveFrameCover = String(session.coverUrl || "").trim().startsWith("data:image/");
  const fallbackCoverUrl =
    String(resolvedThemeAppearance || "").trim().toLowerCase() === "light"
      ? coverFallbackLightUrl
      : coverFallbackDarkUrl;
  const preferredCoverUrl = String(session.coverUrl || "").trim();
  const coverSrc = preferredCoverUrl || fallbackCoverUrl;

  const wrapperRuleId = wrapperRuleIdFromSourceId(session?.sourceId || "");
  const wrapperRule = wrapperRuleById.get(wrapperRuleId);
  const matchedRule =
    wrapperRule ||
    findMatchingWrapperRule({
      sourceId: session?.sourceId || "",
      url: session?.url || "",
      wrapperRules,
    })?.rule ||
    null;
  const targetRuleId = String(matchedRule?.id || "").trim();
  const wrapperOverlayMode = targetRuleId ? "edit" : "create";
  const wrapperMenuLabel = targetRuleId ? t("popup.trackMenu.editSource") : t("popup.trackMenu.createSource");
  const wrapperSelectors = normalizeWrapperControlSelectors(matchedRule?.controlSelectors);
  const canPrevious = session?.controlCapabilities?.previous === true || Boolean(wrapperSelectors.previous);
  const canNext = session?.controlCapabilities?.next === true || Boolean(wrapperSelectors.next);
  const previousControlTitle = canPrevious ? "" : t("popup.controls.unsupported");
  const nextControlTitle = canNext ? "" : t("popup.controls.unsupported");

  if (volume > VOLUME_EPSILON) {
    drafts.lastNonZeroVolumesRef.current.set(id, volume);
  }

  const getRestoreVolume = () => {
    const cached = drafts.lastNonZeroVolumesRef.current.get(id);
    if (Number.isFinite(cached) && cached > VOLUME_EPSILON) return cached;
    const currentSession = sessionById.get(id) || session;
    const current = Number(currentSession?.volume);
    if (Number.isFinite(current) && current > VOLUME_EPSILON) return current;
    return DEFAULT_UNMUTE_VOLUME;
  };

  const onSelectPrimary = () => {
    if (isPrimary) return;
    void sendSetPrimarySession(id);
  };

  const stopCardSelection = (event) => {
    event.stopPropagation();
  };

  const preventNativeDrag = (event) => {
    event.preventDefault();
  };

  const onCoverError = (event) => {
    const image = event?.currentTarget;
    if (!image || image.dataset.fallbackApplied === "1") return;
    image.dataset.fallbackApplied = "1";
    image.src = fallbackCoverUrl;
  };

  const emitLivePreviewHover = (event, active) => {
    if (typeof onLivePreviewHoverChange !== "function") return;

    if (!active) {
      onLivePreviewHoverChange({ active: false, sessionId: id });
      return;
    }

    if (!isLiveFrameCover) return;

    const tabId = Number(session?.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) return;

    const frameId = Number.isInteger(session?.frameId) ? session.frameId : 0;
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return;

    onLivePreviewHoverChange({
      active: true,
      sessionId: id,
      tabId,
      frameId,
      anchorRect: {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      },
    });
  };

  const onPrevious = () => {
    void sendSessionControl(id, "previous").then((result) => {
      if (!result?.ok) {
        setActionInfo(String(result?.message || t("status.unknown")));
      } else {
        setActionInfo("");
      }
      void refreshState();
    });
  };

  const onPlayPause = () => {
    const nextPlayback = playbackState === "playing" ? "paused" : "playing";
    const action = playbackState === "playing" ? "pause" : "play";
    drafts.playbackDraftsRef.current.set(id, nextPlayback);
    drafts.requestUiRefresh();

    void sendSessionControl(id, action).then((result) => {
      if (!result?.ok) {
        drafts.playbackDraftsRef.current.delete(id);
        setActionInfo(String(result?.message || t("status.unknown")));
      } else {
        setActionInfo("");
      }
      void refreshState();
    });
  };

  const onNext = () => {
    void sendSessionControl(id, "next").then((result) => {
      if (!result?.ok) {
        setActionInfo(String(result?.message || t("status.unknown")));
      } else {
        setActionInfo("");
      }
      void refreshState();
    });
  };

  const onVolumeChange = (nextValues) => {
    const nextVolume = Math.max(0, Math.min(1, Number(nextValues?.[0]) / 100));
    if (!Number.isFinite(nextVolume)) return;

    drafts.volumeDraftsRef.current.set(id, nextVolume);
    if (nextVolume > VOLUME_EPSILON) {
      drafts.lastNonZeroVolumesRef.current.set(id, nextVolume);
    }
    drafts.requestUiRefresh();
    void sendSessionControl(id, "volume", nextVolume);
  };

  const onMuteToggle = () => {
    const currentSession = sessionById.get(id) || session;
    const current = Math.max(0, Math.min(1, Number(currentSession.volume) || 0));

    if (!muted) {
      drafts.lastNonZeroVolumesRef.current.set(id, current);
      void sendSessionControl(id, "mute").then(() => {
        void refreshState();
      });
      return;
    }

    if (current > VOLUME_EPSILON) {
      void sendSessionControl(id, "unmute").then(() => {
        void refreshState();
      });
      return;
    }

    const restored = getRestoreVolume();
    drafts.volumeDraftsRef.current.set(id, restored);
    drafts.requestUiRefresh();
    void sendSessionControl(id, "volume", restored)
      .then(() => sendSessionControl(id, "unmute"))
      .then(() => {
        void refreshState();
      });
  };

  const onSeekValueChange = (nextValues) => {
    const value = Number(nextValues?.[0]);
    if (!Number.isFinite(value)) return;
    drafts.seekDraggingIdRef.current = id;
    drafts.seekDraftsRef.current.set(id, value);
    drafts.requestUiRefresh();
    drafts.scheduleSeek(id, value);
  };

  const onSeekValueCommit = (nextValues) => {
    const value = Number(nextValues?.[0]);
    if (!Number.isFinite(value)) return;
    drafts.clearSeekTimer(id);
    drafts.seekDraftsRef.current.set(id, value);
    drafts.seekDraggingIdRef.current = "";
    drafts.requestUiRefresh();

    void sendSeek(id, value).then((result) => {
      if (!result?.ok) drafts.seekDraftsRef.current.delete(id);
      void refreshState();
    });
  };

  const onCloseTabBySwipe = async () => {
    const tabId = Number(session.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      setActionInfo(t("popup.swipe.tabMissing"));
      return { ok: false };
    }

    let stopWarning = "";
    if (playbackState === "playing") {
      drafts.playbackDraftsRef.current.set(id, "paused");
      drafts.requestUiRefresh();

      const stopResult = await sendSessionControl(id, "pause");
      if (!stopResult?.ok) {
        const rawMessage =
          stopResult?.message && String(stopResult.message).trim()
            ? String(stopResult.message)
            : t("status.unknown");
        stopWarning = t("popup.swipe.stopPlaybackFailed", { error: rawMessage });
      }

      if (!stopWarning) {
        let stopped = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const response = await runtimeMessage({ type: MSG.POPUP_GET_STATE });
          if (response?.ok) {
            const activeNow = Array.isArray(response?.payload?.activeSessions) ? response.payload.activeSessions : [];
            const current = activeNow.find((item) => sessionKey(item) === id);
            if (!current || normalizePlaybackState(current.playbackState) !== "playing") {
              stopped = true;
              break;
            }
          }
          await delay(80);
        }
        if (!stopped) {
          stopWarning = t("popup.swipe.stopPlaybackTimeout");
        }
      }

      drafts.playbackDraftsRef.current.delete(id);
      drafts.requestUiRefresh();
      await delay(80);
    }

    try {
      await chrome.tabs.remove(tabId);
      const closed = await waitTabClosed(tabId);
      if (!closed) {
        setActionInfo(stopWarning || t("popup.swipe.closeTabCanceled"));
        return { ok: false };
      }
      setConnectionError("");
      setActionInfo("");
      return { ok: true };
    } catch (error) {
      const rawMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : t("status.unknown");
      setActionInfo(t("popup.swipe.closeTabFailed", { error: rawMessage }));
      return { ok: false };
    }
  };

  const onOpenWrapperSourceFromCard = async () => {
    let invocationTabId = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = Number(tabs?.[0]?.id);
      if (Number.isInteger(activeTabId) && activeTabId >= 0) {
        invocationTabId = activeTabId;
      }
    } catch (_) {
      // fallback to session tab below
    }

    const sessionTabId = Number(session.tabId);
    let targetTabId = null;
    if (Number.isInteger(invocationTabId) && invocationTabId >= 0) {
      targetTabId = invocationTabId;
    } else if (Number.isInteger(sessionTabId) && sessionTabId >= 0) {
      targetTabId = sessionTabId;
    }
    if (!Number.isInteger(targetTabId) || targetTabId < 0) {
      setActionInfo(t("popup.swipe.tabMissing"));
      return;
    }

    const tabSourceIds = collectTabSeedSourceIds(activeSessions, targetTabId, isWrapperSourceId);
    const response = await openWrapperOverlayOnTab(targetTabId, wrapperOverlayMode, targetRuleId, tabSourceIds);
    if (!response?.ok) {
      setActionInfo(
        t("popup.wrapper.picker.errors.startFailed", {
          error: String(response?.message || t("status.unknown")),
        })
      );
      return;
    }
    setActionInfo("");
    window.close();
  };

  const onGoToTabFromCard = async () => {
    const tabId = Number(session.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      setActionInfo(t("popup.swipe.tabMissing"));
      return { ok: false };
    }
    const result = await activateTabById(tabId);
    if (!result?.ok) {
      setActionInfo(String(result?.message || t("status.unknown")));
      return { ok: false };
    }
    setActionInfo("");
    window.close();
    return { ok: true };
  };

  const onCloseTabFromCard = async () => {
    const result = await onCloseTabBySwipe();
    if (result?.ok) {
      window.close();
    }
  };

  const onCopyTrackNameFromCard = async () => {
    const artist = String(session?.artist || "").trim();
    const title = String(session?.title || "").trim();
    const text = artist && title ? `${artist} - ${title}` : artist || title;

    if (!text) {
      setActionInfo(t("popup.trackMenu.copyNameEmpty"));
      return;
    }

    const copyResult = await copyTextToClipboard(text);
    if (!copyResult?.ok) {
      setActionInfo(
        t("popup.trackMenu.copyNameFailed", {
          error: String(copyResult?.message || t("status.unknown")),
        })
      );
      return;
    }

    setActionInfo(t("popup.trackMenu.copyNameCopied"));
  };

  const onCopyTrackLinkFromCard = async () => {
    const trackUrl = String(session?.trackUrl || "").trim();
    if (!trackUrl) {
      setActionInfo(t("popup.trackMenu.copyLinkEmpty"));
      return;
    }

    const copyResult = await copyTextToClipboard(trackUrl);
    if (!copyResult?.ok) {
      setActionInfo(
        t("popup.trackMenu.copyLinkFailed", {
          error: String(copyResult?.message || t("status.unknown")),
        })
      );
      return;
    }

    setActionInfo(t("popup.trackMenu.copyLinkCopied"));
  };

  return (
    <SwipeActionCard
      ignoreSelector={"button:not(.track__cover-hit),input,textarea,select,a,[role=\"slider\"],[data-swipe-ignore]"}
      dragConfig={{
        maxRevealPx: 50,
      }}
      leftAction={{
        enabled: true,
        thresholdPx: 70,
        renderUnderlay: ({ progress, isCommitReady, direction }) => (
          <div
            class={`swipe-underlay swipe-underlay--danger ${isCommitReady ? "swipe-underlay--ready" : ""}`.trim()}
            style={{
              "--swipe-danger-alpha": String(0.06 + Math.min(1, Math.max(0, progress)) * 0.22),
            }}
          >
            <div class={`swipe-underlay__content swipe-underlay__content--${direction}`.trim()}>
              <TrashIcon className="swipe-underlay__icon" width={34} height={34} aria-hidden="true" />
              <span>{t("popup.swipe.closeTab")}</span>
            </div>
          </div>
        ),
        onCommit: onCloseTabBySwipe,
      }}
      rightAction={{
        enabled: true,
        thresholdPx: 70,
        renderUnderlay: ({ isCommitReady, direction }) => (
          <div
            class={[
              "swipe-underlay",
              "swipe-underlay--accent",
              `swipe-underlay--accent-${direction}`,
              isCommitReady ? "swipe-underlay--ready" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div class={`swipe-underlay__content swipe-underlay__content--${direction}`.trim()}>
              <TrackNextIcon className="swipe-underlay__icon" width={34} height={34} aria-hidden="true" />
              <span>{t("popup.trackMenu.openTab")}</span>
            </div>
          </div>
        ),
        onCommit: onGoToTabFromCard,
      }}
    >
      <article class={`active-card ${isPrimary ? "active-card--primary" : ""}`.trim()} data-session-id={id}>
        <div class="track">
          <button
            type="button"
            class="track__cover-hit"
            draggable={false}
            onDragStart={preventNativeDrag}
            onPointerEnter={(event) => emitLivePreviewHover(event, true)}
            onPointerMove={(event) => emitLivePreviewHover(event, true)}
            onPointerLeave={(event) => emitLivePreviewHover(event, false)}
            onBlur={(event) => emitLivePreviewHover(event, false)}
            onClick={(event) => {
              stopCardSelection(event);
              onSelectPrimary();
            }}
            aria-label={isPrimary ? t("popup.track.primary") : t("popup.track.setPrimary")}
          >
            <img
              class={`track__cover ${isLiveFrameCover ? "track__cover--full-frame" : ""}`.trim()}
              alt=""
              src={coverSrc}
              draggable={false}
              onDragStart={preventNativeDrag}
              onError={onCoverError}
            />
          </button>
          <div class="track__meta">
            <div class="track__head">
              <div class="track__labels">
                <div class="track__title">{session.title || t("popup.track.untitled")}</div>
                <div class="track__artist">{session.artist || "—"}</div>
              </div>
              <div class="track__menu-col" onClick={stopCardSelection}>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="2"
                      color="gray"
                      radius="full"
                      className="active-sources__action-btn track__menu-btn"
                      aria-label={t("popup.trackMenu.actions")}
                      title={t("popup.trackMenu.actions")}
                    >
                      <DotsVerticalIcon width={14} height={14} />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" sideOffset={6} className="track__menu-content">
                    <DropdownMenu.Item onSelect={() => void onOpenWrapperSourceFromCard()}>{wrapperMenuLabel}</DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => void onCopyTrackNameFromCard()}>
                      {t("popup.trackMenu.copyName")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => void onCopyTrackLinkFromCard()}>
                      {t("popup.trackMenu.copyLink")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => void onGoToTabFromCard()}>
                      {t("popup.trackMenu.openTab")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => void onCloseTabFromCard()}>
                      {t("popup.trackMenu.closeTab")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
            </div>
            <div class={`track__seek-row ${hideTimeline ? "track__seek-row--empty" : ""}`.trim()}>
              {!hideTimeline ? <div class="track__time">{timeLabel}</div> : null}
              {!isLiveWithoutDuration && !hideTimeline ? (
                <Slider.Root
                  className="np-slider np-slider--seek"
                  min={0}
                  max={Math.max(1, Math.round(durationSec || 1))}
                  step={1}
                  value={[Math.min(positionSec, Math.max(1, Math.round(durationSec || 1)))]}
                  disabled={!durationSec}
                  onValueChange={onSeekValueChange}
                  onValueCommit={onSeekValueCommit}
                  onPointerDown={stopCardSelection}
                  onClick={stopCardSelection}
                >
                  <Slider.Track className="np-slider__track">
                    <Slider.Range className="np-slider__range" />
                  </Slider.Track>
                  <Slider.Thumb className="np-slider__thumb" aria-label={t("popup.track.position")} />
                </Slider.Root>
              ) : null}
            </div>

            <div class="c-cluster controls controls--compact" onClick={stopCardSelection}>
              <button
                type="button"
                class="btn btn--icon"
                aria-label={t("popup.controls.previous")}
                onClick={onPrevious}
                disabled={!canPrevious}
                title={previousControlTitle}
              >
                <TrackPreviousIcon width={14} height={14} />
              </button>
              <button
                type="button"
                class={`${playbackState === "playing" ? "btn btn--accent" : "btn"} btn--icon btn--toggle-play`.trim()}
                aria-label={playbackState === "playing" ? t("popup.controls.pause") : t("popup.controls.play")}
                onClick={onPlayPause}
              >
                {playbackState === "playing" ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
              </button>
              <button
                type="button"
                class="btn btn--icon"
                aria-label={t("popup.controls.next")}
                onClick={onNext}
                disabled={!canNext}
                title={nextControlTitle}
              >
                <TrackNextIcon width={14} height={14} />
              </button>
              <button
                type="button"
                class={`btn btn--icon btn--mute ${muted ? "btn--accent" : ""}`.trim()}
                aria-label={muted ? t("popup.controls.unmute") : t("popup.controls.mute")}
                onClick={onMuteToggle}
              >
                {muted ? <SpeakerOffIcon width={14} height={14} /> : <SpeakerLoudIcon width={14} height={14} />}
              </button>
            </div>

            <div class="field field--volume" onClick={stopCardSelection}>
              <Slider.Root
                className={`np-slider np-slider--volume ${muted ? "np-slider--volume-muted" : ""}`.trim()}
                min={0}
                max={100}
                step={1}
                value={[volumePercent]}
                onValueChange={onVolumeChange}
                onPointerDown={stopCardSelection}
                onClick={stopCardSelection}
              >
                <Slider.Track className="np-slider__track">
                  <Slider.Range className="np-slider__range" />
                </Slider.Track>
                <Slider.Thumb className="np-slider__thumb np-slider__thumb--volume" aria-label={t("popup.track.volume")} />
              </Slider.Root>
            </div>
          </div>
        </div>
      </article>
    </SwipeActionCard>
  );
}
