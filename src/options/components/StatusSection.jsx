import { Card, Text } from "@radix-ui/themes";
import { formatServiceStatus, localizeConnectionState } from "@/shared/i18n";
import { NpCheckbox } from "@/shared/radix";

function buildCurrentLine(snapshot) {
  if (!snapshot) return "—";
  const artist = String(snapshot.artist || "").trim();
  const title = String(snapshot.title || "").trim();
  if (artist && title) return `${artist} — ${title}`;
  return title || artist || "—";
}

function normalizeConnectionState(status) {
  const value = String(status?.state || "idle").toLowerCase();
  if (value === "connected") return "connected";
  if (value === "connecting") return "connecting";
  if (value === "error" || value === "disconnected") return "error";
  if (value === "disabled") return "disabled";
  return "idle";
}

function statusDotClass(status) {
  return `status-dot status-dot--${normalizeConnectionState(status)}`;
}

export function StatusSection({
  trackingEnabled,
  onTrackingChange,
  obsStatus,
  twitchStatus,
  activeSnapshot,
  locale,
  t,
}) {
  const obsLabel = t("services.obs");
  const twitchLabel = t("services.twitch");
  const currentSourceLabel = activeSnapshot?.sourceLabel || activeSnapshot?.sourceId || t("options.common.empty");
  const currentLineLabel = buildCurrentLine(activeSnapshot);

  return (
    <Card className="panel c-stack">
      <div className="status-summary status-summary--three">
        <div className="status-column status-column--toggle">
          <span className="status-service-heading">
            <Text as="span" size="5" weight="bold">
              {t("options.sections.status")}
            </Text>
          </span>
          <NpCheckbox
            checked={trackingEnabled}
            onCheckedChange={onTrackingChange}
            label={t("options.status.tracking")}
          />
        </div>

        <div className="status-column status-column--service" title={formatServiceStatus("obs", obsStatus, locale)}>
          <span className="status-service-heading">
            <Text as="span" size="5" weight="bold">
              {obsLabel}
            </Text>
            <span className={statusDotClass(obsStatus)} aria-hidden="true" />
          </span>
          <Text as="span" size="2" color="gray">
            {localizeConnectionState(obsStatus?.state, locale)}
          </Text>
        </div>

        <div className="status-column status-column--service" title={formatServiceStatus("twitch", twitchStatus, locale)}>
          <span className="status-service-heading">
            <Text as="span" size="5" weight="bold">
              {twitchLabel}
            </Text>
            <span className={statusDotClass(twitchStatus)} aria-hidden="true" />
          </span>
          <Text as="span" size="2" color="gray">
            {localizeConnectionState(twitchStatus?.state, locale)}
          </Text>
        </div>
      </div>

      <div className="status-current-row">
        <div className="field status-current-source">
          <Text color="gray">{t("options.status.currentSource")}</Text>
          <Text>{currentSourceLabel}</Text>
        </div>
        <div className="field status-current-line">
          <Text color="gray">{t("options.status.currentLine")}</Text>
          <Text>{currentLineLabel}</Text>
        </div>
      </div>
    </Card>
  );
}
