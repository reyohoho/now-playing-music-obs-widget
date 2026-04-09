import { ChevronDownIcon, PauseIcon, PlayIcon, StopIcon } from "@radix-ui/react-icons";
import { Checkbox, Switch } from "@radix-ui/themes";
import { formatServiceStatus, localizePlaybackState } from "@/shared/i18n";
import { connectionDotClass, normalizePlaybackState } from "@/popup/popupHelpers";

export function PopupTopPanel({
  showNowPlayingBlockInPopup,
  sourcesExpanded,
  setSourcesExpanded,
  t,
  primaryPreviewLine,
  themeAccentColor,
  view,
  obsLabel,
  twitchLabel,
  headerTogglesDisabled,
  twitchControlDisabled,
  twitchAnnounceDisabled,
  locale,
  connectionError,
  actionInfo,
  providersByOrder,
  sessionsBySource,
  onToggleObsEnabled,
  onToggleTracking,
  onToggleTwitchEnabled,
  onToggleTwitchControl,
  onToggleTwitchAnnounce,
  onToggleAllowGenericWebInjection,
  onProviderDragStart,
  onProviderDrop,
  onProviderEnabled,
}) {
  if (!showNowPlayingBlockInPopup) return null;

  const renderPlaybackStatusIcon = (playbackState) => {
    if (playbackState === "idle") return null;

    const label = localizePlaybackState(playbackState, locale);
    const className = `source-list__status-icon source-list__status-icon--${playbackState}`.trim();

    if (playbackState === "playing") {
      return (
        <span class={className} title={label} aria-label={label}>
          <PlayIcon width={10} height={10} aria-hidden="true" />
        </span>
      );
    }
    if (playbackState === "paused") {
      return (
        <span class={className} title={label} aria-label={label}>
          <PauseIcon width={10} height={10} aria-hidden="true" />
        </span>
      );
    }
    return (
      <span class={className} title={label} aria-label={label}>
        <StopIcon width={10} height={10} aria-hidden="true" />
      </span>
    );
  };

  return (
    <header class="panel panel--top">
      <div
        class="c-cluster c-cluster--space panel-top-trigger"
        role="button"
        tabIndex={0}
        aria-expanded={sourcesExpanded}
        aria-controls="sources-content"
        onClick={() => setSourcesExpanded((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setSourcesExpanded((prev) => !prev);
        }}
      >
        <div class="panel-top-title">
          <strong>{t("popup.appTitle", null, "Now Playing")}</strong>
          <p class="panel-top-primary">{primaryPreviewLine}</p>
        </div>
        <ChevronDownIcon
          width={16}
          height={16}
          className={`panel-top-caret ${sourcesExpanded ? "panel-top-caret--open" : ""}`.trim()}
          aria-hidden="true"
        />
      </div>
      {sourcesExpanded ? (
        <div id="sources-content" class="panel-top-expanded c-stack">
          <div class="sources-controls-grid">
            <label class="sources-controls__toggle sources-controls__toggle--tracking">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                aria-label={t("popup.toggles.on")}
                title={t("popup.toggles.on")}
                checked={view?.trackingEnabled !== false}
                onCheckedChange={onToggleTracking}
              />
              <span>{t("popup.toggles.on")}</span>
            </label>

            <label class="sources-controls__toggle sources-controls__toggle--obs">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                disabled={headerTogglesDisabled}
                checked={view?.obsEnabled === true}
                aria-label={obsLabel}
                title={obsLabel}
                onCheckedChange={onToggleObsEnabled}
              />
              <span class="sources-controls__label">
                <span>{obsLabel}</span>
                <span
                  class={connectionDotClass(view?.obsStatus)}
                  title={formatServiceStatus("obs", view?.obsStatus, locale)}
                  aria-hidden="true"
                />
              </span>
            </label>

            <label class="sources-controls__toggle sources-controls__toggle--allow-generic">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                aria-label={t("popup.toggles.allowGenericWebInjection")}
                title={t("popup.toggles.allowGenericWebInjection")}
                checked={view?.allowGenericWebInjection !== false}
                onCheckedChange={onToggleAllowGenericWebInjection}
              />
              <span>{t("popup.toggles.allowGenericWebInjection")}</span>
            </label>

            <label class="sources-controls__toggle sources-controls__toggle--twitch">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                disabled={headerTogglesDisabled}
                aria-label={twitchLabel}
                title={twitchLabel}
                checked={view?.twitchEnabled !== false}
                onCheckedChange={onToggleTwitchEnabled}
              />
              <span class="sources-controls__label">
                <span>{twitchLabel}</span>
                <span
                  class={connectionDotClass(view?.twitchStatus)}
                  title={formatServiceStatus("twitch", view?.twitchStatus, locale)}
                  aria-hidden="true"
                />
              </span>
            </label>

            <label class="sources-controls__toggle sources-controls__toggle--twitch-control">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                disabled={twitchControlDisabled}
                aria-label={t("popup.toggles.twitchControl")}
                title={t("popup.toggles.twitchControl")}
                checked={view?.twitchControlEnabled === true}
                onCheckedChange={onToggleTwitchControl}
              />
              <span>{t("popup.toggles.twitchControl")}</span>
            </label>

            <label class="sources-controls__toggle sources-controls__toggle--twitch-announce">
              <Switch
                size="1"
                variant="classic"
                color={themeAccentColor}
                disabled={twitchAnnounceDisabled}
                aria-label={t("popup.toggles.twitchAnnounce")}
                title={t("popup.toggles.twitchAnnounce")}
                checked={view?.twitchAnnounceEnabled === true}
                onCheckedChange={onToggleTwitchAnnounce}
              />
              <span>{t("popup.toggles.twitchAnnounce")}</span>
            </label>
          </div>

          <div class="c-stack c-stack--sm">
            {connectionError ? <p class="u-muted">{t("popup.errors.sourcesListUnavailable")}</p> : null}
            {actionInfo ? <p class="u-hint">{actionInfo}</p> : null}
          </div>

          <ul class="source-list">
            {providersByOrder.map((provider) => {
              const playbackState = normalizePlaybackState(provider.playbackState);
              const providerSessions = sessionsBySource.get(provider.id) || [];

              return (
                <li
                  key={provider.id}
                  class="source-list__item"
                  draggable={true}
                  data-id={provider.id}
                  onDragStart={() => onProviderDragStart(provider.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    onProviderDrop(provider.id);
                  }}
                >
                  <span class="source-list__drag">☰</span>
                  <Checkbox
                    size="1"
                    variant="classic"
                    color={themeAccentColor}
                    checked={provider.enabled === true}
                    aria-label={t("popup.source.enableAria", { label: provider.label })}
                    onCheckedChange={(checked) => onProviderEnabled(provider.id, checked === true)}
                  />
                  <div class="source-list__meta">
                    <div class="source-list__name">{provider.label}</div>
                    <div class="source-list__tracks">
                      {providerSessions.length
                        ? providerSessions.map((session) => {
                            const artist = session.artist ? `${session.artist} — ` : "";
                            return (
                              <div key={session.sessionId} class="source-list__track">
                                {`${artist}${session.title || t("popup.source.playingFallback")}`}
                              </div>
                            );
                          })
                        : <div class="source-list__track">{t("popup.source.noActivity")}</div>}
                    </div>
                  </div>
                  {renderPlaybackStatusIcon(playbackState)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
