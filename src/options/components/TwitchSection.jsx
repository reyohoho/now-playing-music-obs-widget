import { useMemo } from "preact/hooks";
import { Button, Callout, Card, Heading, Text, TextArea, TextField } from "@radix-ui/themes";
import {
  TWITCH_CONTROL_COMMAND_ORDER,
  TWITCH_CONTROL_COMMAND_SPECS,
  normalizeStringList,
} from "@/shared/twitchControlRouter";
import {
  NpCheckbox,
  NpMultiSelect,
  NpRolesMultiSelect,
  NpSelect,
} from "@/shared/radix";

const TWITCH_ROLE_OPTIONS = ["broadcaster", "moderator", "vip", "subscriber"];

function toCsv(list) {
  return (Array.isArray(list) ? list : []).join(",");
}

export function TwitchSection({
  twitch,
  sourceOptions = [],
  routerValidation = "",
  onUpdateTwitch,
  onUpdateRouter,
  onUpdateCommand,
  onStartTwitchOAuth,
  onTwitchReconnect,
  statusText = "",
  logText = "",
  t,
}) {
  const commandRows = useMemo(() => {
    const rows = [];
    const commands = twitch?.controlRouter?.commands || {};
    for (const commandId of TWITCH_CONTROL_COMMAND_ORDER) {
      rows.push({
        commandId,
        spec: TWITCH_CONTROL_COMMAND_SPECS[commandId],
        command: commands[commandId],
      });
    }
    return rows;
  }, [twitch?.controlRouter?.commands]);

  return (
    <Card className="panel c-stack">
      <Heading size="5">{t("options.sections.twitch")}</Heading>
      <Callout.Root size="1" variant="surface" color="amber" className="obs-callout">
        <Callout.Text>{t("options.twitch.callout.moderationRisk")}</Callout.Text>
      </Callout.Root>
      <NpCheckbox
        checked={twitch?.enabled}
        onCheckedChange={(checked) => onUpdateTwitch({ enabled: checked })}
        label={t("options.twitch.enabled")}
      />
      <NpCheckbox
        checked={twitch?.controlEnabled}
        onCheckedChange={(checked) => onUpdateTwitch({ controlEnabled: checked })}
        label={t("options.twitch.controlEnabled")}
      />
      <NpCheckbox
        checked={twitch?.announceEnabled}
        onCheckedChange={(checked) => onUpdateTwitch({ announceEnabled: checked })}
        label={t("options.twitch.announceEnabled")}
      />

      <label className="field">
        <Text color="gray">{t("options.twitch.fields.channel")}</Text>
        <TextField.Root
          value={twitch?.channel || ""}
          placeholder={t("options.twitch.placeholders.channel")}
          onInput={(e) => onUpdateTwitch({ channel: e.currentTarget.value })}
        />
      </label>

      <section className="twitch-router c-stack">
        <Heading size="4">{t("options.twitch.fields.commandRouter")}</Heading>
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.trigger")}</Text>
          <TextField.Root
            value={twitch?.controlRouter?.trigger || ""}
            placeholder={t("options.twitch.placeholders.trigger")}
            onInput={(e) => onUpdateRouter({ trigger: e.currentTarget.value })}
          />
        </label>

        <div className="field">
          <Text color="gray">{t("options.twitch.fields.commands")}</Text>
          <div className="router-table-wrap">
            <table className="router-table">
              <thead>
                <tr>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.enabled")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.canonical")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.aliases")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.arg")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.accessMode")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.allowedRoles")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.allowedUsers")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.deniedUsers")}</Text></th>
                  <th><Text as="span" size="1" weight="medium" color="gray">{t("options.twitch.table.sourcesOverride")}</Text></th>
                </tr>
              </thead>
              <tbody>
                {commandRows.map(({ commandId, command, spec }) => {
                  const mode = command?.access?.mode || "roles";
                  return (
                    <tr key={commandId}>
                      <td>
                        <NpCheckbox
                          checked={command?.enabled === true}
                          onCheckedChange={(checked) =>
                            onUpdateCommand(commandId, (prev) => ({ ...prev, enabled: checked }))
                          }
                        />
                      </td>
                      <td>
                        <Text as="span" size="1">
                          {commandId}
                        </Text>
                      </td>
                      <td>
                        <TextField.Root
                          value={toCsv(command?.aliases || [])}
                          placeholder={t("options.twitch.placeholders.aliases")}
                          onInput={(e) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              aliases: normalizeStringList(e.currentTarget.value),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <Text as="span" size="1">
                          {spec?.argType || t("options.common.none")}
                        </Text>
                      </td>
                      <td>
                        <NpSelect
                          value={mode}
                          onValueChange={(value) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              access: { ...prev.access, mode: value },
                            }))
                          }
                          options={[
                            { value: "roles", label: t("options.twitch.accessModes.roles") },
                            { value: "users", label: t("options.twitch.accessModes.users") },
                            { value: "everyone", label: t("options.twitch.accessModes.everyone") },
                          ]}
                        />
                      </td>
                      <td>
                        <NpRolesMultiSelect
                          value={command?.access?.allowedRoles || []}
                          options={TWITCH_ROLE_OPTIONS}
                          disabled={mode !== "roles"}
                          onChange={(nextRoles) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              access: { ...prev.access, allowedRoles: normalizeStringList(nextRoles) },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <TextField.Root
                          disabled={mode !== "users"}
                          value={toCsv(command?.access?.allowedUsers || [])}
                          placeholder={t("options.twitch.placeholders.users")}
                          onInput={(e) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              access: {
                                ...prev.access,
                                allowedUsers: normalizeStringList(e.currentTarget.value),
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <TextField.Root
                          value={toCsv(command?.access?.deniedUsers || [])}
                          placeholder={t("options.twitch.placeholders.deniedUser")}
                          onInput={(e) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              access: {
                                ...prev.access,
                                deniedUsers: normalizeStringList(e.currentTarget.value),
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <TextField.Root
                          value={toCsv(command?.allowedSourcesOverride || [])}
                          placeholder={t("options.twitch.placeholders.sources")}
                          onInput={(e) =>
                            onUpdateCommand(commandId, (prev) => ({
                              ...prev,
                              allowedSourcesOverride: normalizeStringList(e.currentTarget.value),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <label className="field">
          <Text color="gray">{t("options.twitch.fields.globalAllowedSources")}</Text>
          <NpMultiSelect
            value={twitch?.controlRouter?.sources?.globalAllowed || []}
            options={sourceOptions}
            onChange={(nextValues) =>
              onUpdateRouter({
                sources: {
                  ...(twitch?.controlRouter?.sources || {}),
                  globalAllowed: normalizeStringList(nextValues),
                },
              })
            }
          />
        </label>

        <div className="c-grid c-grid--3">
          <label className="field">
            <Text color="gray">{t("options.twitch.rateLimit.global")}</Text>
            <TextField.Root
              type="number"
              min={0}
              value={String(twitch?.controlRouter?.rateLimit?.globalMs || 0)}
              onInput={(e) =>
                onUpdateRouter({
                  rateLimit: {
                    ...(twitch?.controlRouter?.rateLimit || {}),
                    globalMs: Number(e.currentTarget.value) || 0,
                  },
                })
              }
            />
          </label>
          <label className="field">
            <Text color="gray">{t("options.twitch.rateLimit.perUser")}</Text>
            <TextField.Root
              type="number"
              min={0}
              value={String(twitch?.controlRouter?.rateLimit?.perUserMs || 0)}
              onInput={(e) =>
                onUpdateRouter({
                  rateLimit: {
                    ...(twitch?.controlRouter?.rateLimit || {}),
                    perUserMs: Number(e.currentTarget.value) || 0,
                  },
                })
              }
            />
          </label>
          <label className="field">
            <Text color="gray">{t("options.twitch.rateLimit.perCommand")}</Text>
            <TextField.Root
              type="number"
              min={0}
              value={String(twitch?.controlRouter?.rateLimit?.perCommandMs || 0)}
              onInput={(e) =>
                onUpdateRouter({
                  rateLimit: {
                    ...(twitch?.controlRouter?.rateLimit || {}),
                    perCommandMs: Number(e.currentTarget.value) || 0,
                  },
                })
              }
            />
          </label>
        </div>

        <Text className="router-validation">{routerValidation}</Text>
      </section>

      <div className="c-grid c-grid--3">
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.username")}</Text>
          <TextField.Root
            value={twitch?.username || ""}
            onInput={(e) => onUpdateTwitch({ username: e.currentTarget.value })}
          />
        </label>
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.clientId")}</Text>
          <TextField.Root
            value={twitch?.clientId || ""}
            onInput={(e) => onUpdateTwitch({ clientId: e.currentTarget.value })}
          />
        </label>
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.oauthToken")}</Text>
          <TextField.Root
            type="password"
            value={twitch?.oauthToken || ""}
            onInput={(e) => onUpdateTwitch({ oauthToken: e.currentTarget.value })}
          />
        </label>
      </div>

      <div className="c-grid">
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.announceTemplate")}</Text>
          <TextField.Root
            value={twitch?.announceTemplate || ""}
            onInput={(e) => onUpdateTwitch({ announceTemplate: e.currentTarget.value })}
          />
        </label>
        <label className="field">
          <Text color="gray">{t("options.twitch.fields.announceMinInterval")}</Text>
          <TextField.Root
            type="number"
            min={1000}
            value={String(twitch?.announceMinIntervalMs || 1000)}
            onInput={(e) =>
              onUpdateTwitch({ announceMinIntervalMs: Math.max(1000, Number(e.currentTarget.value) || 1000) })
            }
          />
        </label>
      </div>

      <div className="c-cluster">
        <Button onClick={onStartTwitchOAuth}>{t("options.twitch.actions.oauthAuthorize")}</Button>
        <Button onClick={onTwitchReconnect}>{t("options.twitch.actions.reconnect")}</Button>
        <Text color="gray">{statusText}</Text>
      </div>

      <label className="field">
        <Text color="gray">{t("options.twitch.fields.log")}</Text>
        <TextArea value={logText} rows={8} readOnly />
      </label>
    </Card>
  );
}
