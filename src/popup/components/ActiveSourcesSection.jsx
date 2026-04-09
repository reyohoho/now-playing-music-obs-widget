import { GearIcon, PlusIcon, SpeakerLoudIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { IconButton } from "@radix-ui/themes";
import { sessionKey } from "@/popup/popupHelpers";
import { SessionCard } from "@/popup/components/SessionCard";

export function ActiveSourcesSection({
  t,
  connectionError = "",
  actionInfo = "",
  sessions = [],
  accentColor = "teal",
  bulkMuteToggleActive = false,
  onToggleBulkMute,
  onAddWrapperFromTab,
  onOpenOptions,
  cardSharedProps,
}) {
  const bulkMuteAria = bulkMuteToggleActive
    ? t("popup.activeSources.bulkMute.unmuteAria")
    : t("popup.activeSources.bulkMute.muteAria");

  return (
    <section class="panel panel--compact">
      <div class="active-sources__header">
        <h2 class="heading">{t("popup.activeSources.title")}</h2>
        <div class="active-sources__actions">
          <IconButton
            type="button"
            variant="ghost"
            size="2"
            color={bulkMuteToggleActive ? accentColor : "gray"}
            radius="full"
            className="active-sources__action-btn"
            aria-label={bulkMuteAria}
            title={bulkMuteAria}
            onClick={onToggleBulkMute}
            disabled={!sessions.length}
          >
            {bulkMuteToggleActive ? <SpeakerLoudIcon width={16} height={16} /> : <SpeakerOffIcon width={16} height={16} />}
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="2"
            color="gray"
            radius="full"
            className="active-sources__action-btn"
            aria-label={t("popup.wrapper.addFromTab")}
            title={t("popup.wrapper.addFromTab")}
            onClick={onAddWrapperFromTab}
          >
            <PlusIcon width={16} height={16} />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="2"
            color="gray"
            radius="full"
            className="active-sources__action-btn"
            aria-label={t("popup.settings")}
            title={t("popup.settings")}
            onClick={onOpenOptions}
          >
            <GearIcon width={16} height={16} />
          </IconButton>
        </div>
      </div>
      {connectionError ? <p class="u-muted">{t("popup.errors.backgroundConnection", { error: connectionError })}</p> : null}
      {actionInfo ? <p class="u-hint">{actionInfo}</p> : null}
      <div class="active-sources">
        {sessions.length ? (
          sessions.map((session) => (
            <SessionCard
              key={sessionKey(session)}
              session={session}
              isPrimary={sessionKey(session) === String(cardSharedProps?.primarySessionId || "")}
              {...cardSharedProps}
            />
          ))
        ) : (
          <p class="active-sources__empty">{t("popup.activeSources.empty")}</p>
        )}
      </div>
    </section>
  );
}
