import { Card, Heading, Text, TextArea } from "@radix-ui/themes";
import { NpCheckbox } from "@/shared/radix";

function formatDiagnostics(entries, locale) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return entries
    .slice(-80)
    .reverse()
    .map((entry) => {
      const time = new Date(entry.at || Date.now()).toLocaleTimeString(locale);
      const source = entry?.sourceLabel || entry?.sourceId || "unknown";
      const event = String(entry?.event || "event");
      const payload = entry?.payload;
      let payloadText = "";
      try {
        payloadText = JSON.stringify(payload);
      } catch (_) {
        payloadText = "\"<non-serializable>\"";
      }
      return `[${time}] ${source} ${event} ${payloadText}`;
    })
    .join("\n");
}

export function DebugSection({
  debugMode,
  diagnostics,
  locale,
  onDebugModeChange,
  t,
}) {
  return (
    <Card className="panel c-stack">
      <Heading size="5">{t("options.sections.debug")}</Heading>
      <NpCheckbox
        checked={debugMode}
        onCheckedChange={onDebugModeChange}
        label={t("options.debug.enable")}
      />
      <Text color="gray">{t("options.debug.hint")}</Text>
      <label className="field">
        <Text color="gray">{t("options.debug.channel")}</Text>
        <TextArea
          value={formatDiagnostics(diagnostics, locale) || t("options.debug.channelEmpty")}
          rows={10}
          readOnly
        />
      </label>
    </Card>
  );
}
