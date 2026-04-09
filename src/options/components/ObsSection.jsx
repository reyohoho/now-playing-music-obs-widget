import { Button, Callout, Card, Heading, Text, TextField } from "@radix-ui/themes";
import { formatServiceStatus } from "@/shared/i18n";
import { NpCheckbox } from "@/shared/radix";

export function ObsSection({
  obs,
  obsStatus,
  locale,
  onUpdateObs,
  onObsReconnect,
  t,
}) {
  return (
    <Card className="panel c-stack">
      <Heading size="5">{t("options.sections.obs")}</Heading>
      <NpCheckbox
        checked={obs?.enabled}
        onCheckedChange={(checked) => onUpdateObs({ enabled: checked })}
        label={t("options.obs.enabled")}
      />

      <div className="c-grid">
        <label className="field">
          <Text color="gray">{t("options.obs.fields.host")}</Text>
          <TextField.Root value={obs?.host || ""} onInput={(e) => onUpdateObs({ host: e.currentTarget.value })} />
        </label>
        <label className="field">
          <Text color="gray">{t("options.obs.fields.port")}</Text>
          <TextField.Root
            type="number"
            value={String(obs?.port || 4455)}
            min={1}
            max={65535}
            onInput={(e) => onUpdateObs({ port: Number(e.currentTarget.value) || 4455 })}
          />
        </label>
      </div>

      <label className="field">
        <Text color="gray">{t("options.obs.fields.password")}</Text>
        <TextField.Root
          type="password"
          value={obs?.password || ""}
          onInput={(e) => onUpdateObs({ password: e.currentTarget.value })}
        />
      </label>

      <div className="c-cluster">
        <Button onClick={onObsReconnect}>{t("options.obs.reconnect")}</Button>
        <Text color="gray">{formatServiceStatus("obs", obsStatus, locale)}</Text>
      </div>

      <section className="obs-subsection c-stack">
        <Heading size="4">{t("options.obs.display.textSource")}</Heading>
        <label className="field">
          <Text color="gray">{t("options.obs.fields.textSourceName")}</Text>
          <TextField.Root
            value={obs?.textSourceName || ""}
            onInput={(e) => onUpdateObs({ textSourceName: e.currentTarget.value })}
          />
        </label>
        <label className="field">
          <Text color="gray">{t("options.obs.fields.textTemplate")}</Text>
          <TextField.Root
            value={obs?.textTemplate || ""}
            onInput={(e) => onUpdateObs({ textTemplate: e.currentTarget.value })}
          />
        </label>

        <Callout.Root size="1" variant="surface" color="blue" className="obs-callout">
          <Callout.Text>
            {t("options.obs.callout.changeTextSource")}
          </Callout.Text>
        </Callout.Root>
      </section>

      <section className="obs-subsection c-stack">
        <Heading size="4">{t("options.obs.display.browserSource")}</Heading>
        <NpCheckbox
          checked={obs?.browserEventEnabled}
          onCheckedChange={(checked) => onUpdateObs({ browserEventEnabled: checked })}
          label={t("options.obs.fields.browserEventEnabled")}
        />
        <label className="field">
          <Text color="gray">{t("options.obs.fields.browserEventName")}</Text>
          <TextField.Root
            value={obs?.browserEventName || ""}
            onInput={(e) => onUpdateObs({ browserEventName: e.currentTarget.value })}
          />
        </label>
        <Callout.Root size="1" variant="surface" color="blue" className="obs-callout">
          <Callout.Text>{t("options.obs.callout.browserLocalFileInfo")}</Callout.Text>
        </Callout.Root>
      </section>
    </Card>
  );
}
