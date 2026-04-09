import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Button, Card, Dialog, Heading, Text, TextField } from "@radix-ui/themes";
import { MSG } from "@/shared/messages";
import { PROVIDERS } from "@/shared/providers";
import {
  WRAPPER_VOLUME_CONTROL_MODES,
  isBuiltInWrapperRule,
  makeBuiltInWrapperRuleId,
  makePathRegexTemplate,
  makeWrapperSourceId,
  normalizeBuiltInSourceId,
  normalizeChildSourceIds,
  normalizeWrapperControlModes,
  normalizeHost,
  normalizeHostList,
  normalizeWrapperControlSelectors,
  normalizeWrapperRules,
} from "@/shared/wrapperRules";
import {
  SOURCE_MIN_DURATION_SEC_DISABLED,
  SOURCE_MIN_DURATION_SEC_MAX,
  SOURCE_MIN_DURATION_SEC_MIN,
  defaultSourceMinDurationSecMap,
  normalizeSourceMinDurationSec,
} from "@/shared/webMediaSettings";
import { WrapperRuleEditorFields } from "@/shared/wrapperRuleEditorFields";

function isHostPatternMatch(pattern, host) {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (!normalizedPattern || !normalizedHost) return false;
  if (!normalizedPattern.startsWith("*.")) {
    return normalizedPattern === normalizedHost;
  }
  const suffix = normalizedPattern.slice(1);
  return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
}

function createWrapperRuleId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `rule-${Date.now().toString(36)}-${random}`;
}

function normalizeWrapperRuleDraft(input = {}, fallbackId = "", fallbackBuiltInSourceId = "") {
  const builtInSourceId = normalizeBuiltInSourceId(input.builtinSourceId || fallbackBuiltInSourceId);
  const builtInRuleId = builtInSourceId ? makeBuiltInWrapperRuleId(builtInSourceId) : "";
  return {
    id:
      builtInRuleId ||
      String(input.id || "").trim() ||
      String(fallbackId || "").trim() ||
      createWrapperRuleId(),
    builtinSourceId: builtInSourceId,
    enabled: input.enabled !== false,
    autoPrimary: input.autoPrimary !== false,
    host: normalizeHostList(input.host || "").join(", "),
    pathRegex: String(input.pathRegex || "").trim(),
    label: String(input.label || "").trim(),
    childSourceIds: normalizeChildSourceIds(input.childSourceIds || []),
    controlSelectors: normalizeWrapperControlSelectors(input.controlSelectors),
    controlModes: normalizeWrapperControlModes(input.controlModes),
  };
}

export function WrapperSourcesSection({
  wrapperRules = [],
  primarySourceAutoPickMap = {},
  sourceBulkMuteIgnoreMap = {},
  sourceMinDurationSecMap = {},
  sourceOptions = [],
  updateModel,
  t,
  showToast,
}) {
  const [wrapperEditor, setWrapperEditor] = useState({
    open: false,
    mode: "create",
    targetKind: "custom",
    builtinSourceId: "",
    ruleId: "",
    sourceId: "",
    ignoreBulkMute: false,
    sourceMinDurationSec: SOURCE_MIN_DURATION_SEC_DISABLED,
    draft: normalizeWrapperRuleDraft(),
    error: "",
  });
  const [activeTabContext, setActiveTabContext] = useState({
    url: "",
    host: "",
    pathRegexTemplate: "",
  });

  const defaultSourceMinDurationSecBySourceId = useMemo(
    () => defaultSourceMinDurationSecMap(PROVIDERS.map((provider) => provider?.id)),
    []
  );

  const resolveSourceMinDurationSec = useCallback(
    (sourceId) => {
      const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
      if (!normalizedSourceId) return SOURCE_MIN_DURATION_SEC_DISABLED;
      return normalizeSourceMinDurationSec(
        sourceMinDurationSecMap?.[normalizedSourceId],
        defaultSourceMinDurationSecBySourceId[normalizedSourceId] ?? SOURCE_MIN_DURATION_SEC_DISABLED
      );
    },
    [defaultSourceMinDurationSecBySourceId, sourceMinDurationSecMap]
  );

  const resolveSourceBulkMuteIgnore = useCallback(
    (sourceId) => {
      const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
      if (!normalizedSourceId) return false;
      return sourceBulkMuteIgnoreMap?.[normalizedSourceId] === true;
    },
    [sourceBulkMuteIgnoreMap]
  );

  const normalizedRules = useMemo(
    () => normalizeWrapperRules(wrapperRules || []),
    [wrapperRules]
  );

  const builtInRuleBySourceId = useMemo(() => {
    const map = new Map();
    for (const rule of normalizedRules) {
      if (!isBuiltInWrapperRule(rule)) continue;
      const sourceId = normalizeBuiltInSourceId(rule.builtinSourceId);
      if (!sourceId) continue;
      map.set(sourceId, rule);
    }
    return map;
  }, [normalizedRules]);

  const providerById = useMemo(() => {
    const map = new Map();
    for (const provider of PROVIDERS) {
      const sourceId = normalizeBuiltInSourceId(provider?.id);
      if (!sourceId) continue;
      map.set(sourceId, provider);
    }
    return map;
  }, []);

  const sourceRows = useMemo(() => {
    const builtInRows = PROVIDERS.map((provider) => {
      const sourceId = normalizeBuiltInSourceId(provider?.id);
      if (!sourceId) return null;
      const existingRule = builtInRuleBySourceId.get(sourceId) || null;
      return {
        sourceId,
        label: provider.label || provider.id,
        kind: "builtin",
        ruleId: existingRule?.id || makeBuiltInWrapperRuleId(sourceId),
        hasOverride: Boolean(existingRule),
      };
    }).filter(Boolean);

    const wrapperRows = normalizedRules
      .map((rule) => {
        if (isBuiltInWrapperRule(rule)) return null;
        const sourceId = makeWrapperSourceId(rule.id);
        if (!sourceId) return null;
        return {
          sourceId,
          label: String(rule.label || rule.host || sourceId),
          kind: "custom",
          ruleId: rule.id,
          hasOverride: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));

    return [...builtInRows, ...wrapperRows];
  }, [builtInRuleBySourceId, normalizedRules]);

  useEffect(() => {
    if (!wrapperEditor.open || wrapperEditor.targetKind === "builtin") return;
    if (!chrome?.tabs?.query) return;
    let cancelled = false;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (cancelled) return;
      const tab = tabs?.[0] || null;
      const url = String(tab?.url || "").trim();
      setActiveTabContext({
        url,
        host: normalizeHost(url),
        pathRegexTemplate: makePathRegexTemplate(url),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [wrapperEditor.open, wrapperEditor.targetKind]);

  const pathRegexTemplateForEditor = useMemo(() => {
    if (wrapperEditor.targetKind === "builtin") return "";
    const pageHost = String(activeTabContext.host || "").trim();
    const template = String(activeTabContext.pathRegexTemplate || "").trim();
    if (!pageHost || !template) return "";
    const patterns = normalizeHostList(wrapperEditor.draft?.host || "");
    if (!patterns.length) return "";
    const sameHost = patterns.some((pattern) => isHostPatternMatch(pattern, pageHost));
    return sameHost ? template : "";
  }, [
    activeTabContext.host,
    activeTabContext.pathRegexTemplate,
    wrapperEditor.draft?.host,
    wrapperEditor.targetKind,
  ]);

  const removeCustomWrapperRule = useCallback(
    (ruleId) => {
      const normalizedRuleId = String(ruleId || "").trim();
      if (!normalizedRuleId) return;
      updateModel((prev) => {
        const wrapperSourceId = makeWrapperSourceId(normalizedRuleId);
        const nextAutoPickMap = {
          ...(prev.primarySourceAutoPickMap || {}),
        };
        const nextSourceMinDurationSecMap = {
          ...(prev.sourceMinDurationSecMap || {}),
        };
        const nextSourceBulkMuteIgnoreMap = {
          ...(prev.sourceBulkMuteIgnoreMap || {}),
        };
        if (wrapperSourceId) delete nextAutoPickMap[wrapperSourceId];
        if (wrapperSourceId) delete nextSourceMinDurationSecMap[wrapperSourceId];
        if (wrapperSourceId) delete nextSourceBulkMuteIgnoreMap[wrapperSourceId];

        return {
          ...prev,
          wrapperRules: (prev.wrapperRules || []).filter((rule) => rule.id !== normalizedRuleId),
          primarySourceAutoPickMap: nextAutoPickMap,
          sourceBulkMuteIgnoreMap: nextSourceBulkMuteIgnoreMap,
          sourceMinDurationSecMap: nextSourceMinDurationSecMap,
        };
      });
    },
    [updateModel]
  );

  const clearBuiltInWrapperOverride = useCallback(
    (sourceId) => {
      const normalizedSourceId = normalizeBuiltInSourceId(sourceId);
      if (!normalizedSourceId) return;
      updateModel((prev) => ({
        ...prev,
        wrapperRules: (prev.wrapperRules || []).filter(
          (rule) => normalizeBuiltInSourceId(rule.builtinSourceId) !== normalizedSourceId
        ),
      }));
    },
    [updateModel]
  );

  const openCustomWrapperEditor = useCallback(
    (mode = "create", ruleId = "") => {
      const normalizedMode = mode === "edit" ? "edit" : "create";
      const normalizedRuleId = String(ruleId || "").trim();

      if (normalizedMode === "edit") {
        const currentRule = normalizedRules.find(
          (rule) => !isBuiltInWrapperRule(rule) && rule.id === normalizedRuleId
        );
        if (!currentRule) {
          if (typeof showToast === "function") {
            showToast(t("options.wrapperSources.overlay.errors.startFailed", { error: "Rule not found" }), "error");
          }
          return;
        }
        const wrapperSourceId = makeWrapperSourceId(normalizedRuleId);
        const autoPrimaryEnabled =
          !wrapperSourceId || (primarySourceAutoPickMap || {})[wrapperSourceId] !== false;
        setWrapperEditor({
          open: true,
          mode: "edit",
          targetKind: "custom",
          builtinSourceId: "",
          ruleId: normalizedRuleId,
          sourceId: wrapperSourceId,
          ignoreBulkMute: resolveSourceBulkMuteIgnore(wrapperSourceId),
          sourceMinDurationSec: resolveSourceMinDurationSec(wrapperSourceId),
          draft: normalizeWrapperRuleDraft(
            {
              ...currentRule,
              autoPrimary: autoPrimaryEnabled,
            },
            normalizedRuleId
          ),
          error: "",
        });
        return;
      }

      setWrapperEditor({
        open: true,
        mode: "create",
        targetKind: "custom",
        builtinSourceId: "",
        ruleId: "",
        sourceId: "",
        ignoreBulkMute: false,
        sourceMinDurationSec: SOURCE_MIN_DURATION_SEC_DISABLED,
        draft: normalizeWrapperRuleDraft(),
        error: "",
      });
    },
    [
      normalizedRules,
      primarySourceAutoPickMap,
      resolveSourceBulkMuteIgnore,
      resolveSourceMinDurationSec,
      showToast,
      t,
    ]
  );

  const openBuiltInWrapperEditor = useCallback(
    (sourceId) => {
      const normalizedSourceId = normalizeBuiltInSourceId(sourceId);
      const provider = providerById.get(normalizedSourceId);
      if (!provider) {
        if (typeof showToast === "function") {
          showToast(t("options.wrapperSources.overlay.errors.startFailed", { error: "Source not found" }), "error");
        }
        return;
      }

      const existingRule = builtInRuleBySourceId.get(normalizedSourceId) || null;
      const autoPrimaryEnabled = (primarySourceAutoPickMap || {})[normalizedSourceId] !== false;
      const builtInRuleId =
        existingRule?.id || makeBuiltInWrapperRuleId(normalizedSourceId) || createWrapperRuleId();
      const draftSource = existingRule || {
        id: builtInRuleId,
        builtinSourceId: normalizedSourceId,
        enabled: true,
        host: normalizeHostList(provider?.hosts || []).join(", "),
        pathRegex: "",
        label: String(provider?.label || provider?.id || normalizedSourceId),
        childSourceIds: [normalizedSourceId],
        controlSelectors: {},
      };

      setWrapperEditor({
        open: true,
        mode: "edit",
        targetKind: "builtin",
        builtinSourceId: normalizedSourceId,
        ruleId: builtInRuleId,
        sourceId: normalizedSourceId,
        ignoreBulkMute: resolveSourceBulkMuteIgnore(normalizedSourceId),
        sourceMinDurationSec: resolveSourceMinDurationSec(normalizedSourceId),
        draft: normalizeWrapperRuleDraft(
          {
            ...draftSource,
            builtinSourceId: normalizedSourceId,
            autoPrimary: autoPrimaryEnabled,
          },
          builtInRuleId,
          normalizedSourceId
        ),
        error: "",
      });
    },
    [
      builtInRuleBySourceId,
      primarySourceAutoPickMap,
      providerById,
      resolveSourceBulkMuteIgnore,
      resolveSourceMinDurationSec,
      showToast,
      t,
    ]
  );

  const closeWrapperEditor = useCallback(() => {
    setWrapperEditor((prev) => ({ ...prev, open: false, error: "" }));
  }, []);

  const runSelectorActionOnActiveTab = useCallback(
    async (action, selector, mode = "") => {
      const normalizedAction = String(action || "").trim();
      const normalizedSelector = String(selector || "").trim();
      if (!normalizedAction || !normalizedSelector) return;
      if (!chrome?.tabs?.query || !chrome?.tabs?.sendMessage) {
        if (typeof showToast === "function") {
          showToast(
            t("options.wrapperSources.toasts.runFailed", {
              action: t(`options.wrapperSources.controlActions.${normalizedAction}`),
              error: "Tabs API unavailable",
            }),
            "error"
          );
        }
        return;
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (!Number.isInteger(tabId)) {
        if (typeof showToast === "function") {
          showToast(
            t("options.wrapperSources.toasts.runFailed", {
              action: t(`options.wrapperSources.controlActions.${normalizedAction}`),
              error: "Active tab not found",
            }),
            "error"
          );
        }
        return;
      }

      const value = normalizedAction === "volume" ? 0.5 : undefined;
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          {
            type: MSG.CONTROL_SELECTOR_EXEC,
            action: normalizedAction,
            selector: normalizedSelector,
            value,
            mode: String(mode || "").trim(),
          },
          (result) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, message: chrome.runtime.lastError.message });
              return;
            }
            resolve(result || { ok: false, message: "No response" });
          }
        );
      });

      if (response?.ok) {
        if (typeof showToast === "function") {
          showToast(
            t("options.wrapperSources.toasts.runSuccess", {
              action: t(`options.wrapperSources.controlActions.${normalizedAction}`),
            }),
            "success"
          );
        }
        return;
      }

      if (typeof showToast === "function") {
        showToast(
          t("options.wrapperSources.toasts.runFailed", {
            action: t(`options.wrapperSources.controlActions.${normalizedAction}`),
            error: String(response?.message || "Failed"),
          }),
          "error"
        );
      }
    },
    [showToast, t]
  );

  const updateWrapperEditorDraft = useCallback((updater) => {
    setWrapperEditor((prev) => {
      const nextDraft = typeof updater === "function" ? updater(prev.draft) : { ...prev.draft, ...updater };
      return {
        ...prev,
        draft: normalizeWrapperRuleDraft(nextDraft, prev.ruleId, prev.builtinSourceId),
        error: "",
      };
    });
  }, []);

  const saveWrapperEditor = useCallback(() => {
    const draft = normalizeWrapperRuleDraft(
      wrapperEditor.draft,
      wrapperEditor.ruleId,
      wrapperEditor.builtinSourceId
    );
    if (wrapperEditor.targetKind !== "builtin") {
      if (!draft.host) {
        setWrapperEditor((prev) => ({ ...prev, error: "Host is required" }));
        return;
      }
      if (!Array.isArray(draft.childSourceIds) || draft.childSourceIds.length === 0) {
        setWrapperEditor((prev) => ({ ...prev, error: "Select at least one child source" }));
        return;
      }
    }

    updateModel((prev) => {
      const currentRules = normalizeWrapperRules(prev.wrapperRules || []);
      const ruleDraft = { ...draft };
      delete ruleDraft.autoPrimary;
      const nextAutoPickMap = {
        ...(prev.primarySourceAutoPickMap || {}),
      };
      const nextSourceMinDurationSecMap = {
        ...(prev.sourceMinDurationSecMap || {}),
      };
      const nextSourceBulkMuteIgnoreMap = {
        ...(prev.sourceBulkMuteIgnoreMap || {}),
      };

      if (wrapperEditor.targetKind === "builtin") {
        const builtInSourceId = normalizeBuiltInSourceId(
          ruleDraft.builtinSourceId || wrapperEditor.builtinSourceId
        );
        const provider = providerById.get(builtInSourceId) || null;
        const stableRuleId = makeBuiltInWrapperRuleId(builtInSourceId);
        ruleDraft.id = stableRuleId || ruleDraft.id;
        ruleDraft.builtinSourceId = builtInSourceId;
        ruleDraft.host = normalizeHostList(provider?.hosts || []).join(", ");
        ruleDraft.pathRegex = "";
        ruleDraft.label = String(provider?.label || provider?.id || builtInSourceId);
        ruleDraft.childSourceIds = builtInSourceId ? [builtInSourceId] : [];

        const nextRules = currentRules
          .filter((rule) => normalizeBuiltInSourceId(rule.builtinSourceId) !== builtInSourceId)
          .concat(ruleDraft);
        if (builtInSourceId) {
          nextAutoPickMap[builtInSourceId] = draft.autoPrimary !== false;
          nextSourceBulkMuteIgnoreMap[builtInSourceId] = wrapperEditor.ignoreBulkMute === true;
          nextSourceMinDurationSecMap[builtInSourceId] = normalizeSourceMinDurationSec(
            wrapperEditor.sourceMinDurationSec,
            resolveSourceMinDurationSec(builtInSourceId)
          );
        }

        return {
          ...prev,
          wrapperRules: nextRules,
          primarySourceAutoPickMap: nextAutoPickMap,
          sourceBulkMuteIgnoreMap: nextSourceBulkMuteIgnoreMap,
          sourceMinDurationSecMap: nextSourceMinDurationSecMap,
        };
      }

      delete ruleDraft.builtinSourceId;
      const exists = currentRules.some((rule) => rule.id === draft.id);
      const nextRules = exists
        ? currentRules.map((rule) => (rule.id === draft.id ? ruleDraft : rule))
        : [...currentRules, ruleDraft];
      const wrapperSourceId = makeWrapperSourceId(draft.id);
      if (wrapperSourceId) nextAutoPickMap[wrapperSourceId] = draft.autoPrimary !== false;
      if (wrapperSourceId) {
        nextSourceBulkMuteIgnoreMap[wrapperSourceId] = wrapperEditor.ignoreBulkMute === true;
        nextSourceMinDurationSecMap[wrapperSourceId] = normalizeSourceMinDurationSec(
          wrapperEditor.sourceMinDurationSec,
          resolveSourceMinDurationSec(wrapperSourceId)
        );
      }

      return {
        ...prev,
        wrapperRules: nextRules,
        primarySourceAutoPickMap: nextAutoPickMap,
        sourceBulkMuteIgnoreMap: nextSourceBulkMuteIgnoreMap,
        sourceMinDurationSecMap: nextSourceMinDurationSecMap,
      };
    });

    setWrapperEditor((prev) => ({ ...prev, open: false, error: "" }));
  }, [
    updateModel,
    wrapperEditor.builtinSourceId,
    wrapperEditor.draft,
    wrapperEditor.ignoreBulkMute,
    wrapperEditor.ruleId,
    wrapperEditor.sourceMinDurationSec,
    wrapperEditor.targetKind,
    providerById,
    resolveSourceMinDurationSec,
  ]);

  return (
    <>
      <Card className="panel c-stack">
        <section className="c-cluster c-cluster--space">
          <Heading size="5">{t("options.sections.wrapperSources")}</Heading>
          <div className="c-cluster">
            <Button variant="surface" onClick={() => openCustomWrapperEditor("create")}>
              {t("options.wrapperSources.actions.add")}
            </Button>
          </div>
        </section>

        <div className="sources-policy-list">
          {sourceRows.map((row) => {
            const isBuiltIn = row.kind === "builtin";
            return (
              <div key={row.sourceId} className="sources-policy-row">
                <div className="sources-policy-row__meta">
                  <Text weight="medium">{row.label}</Text>
                </div>

                <div className="sources-policy-row__actions">
                  <Button
                    variant="soft"
                    color="gray"
                    onClick={() => {
                      if (isBuiltIn) {
                        openBuiltInWrapperEditor(row.sourceId);
                        return;
                      }
                      openCustomWrapperEditor("edit", row.ruleId);
                    }}
                  >
                    {t("options.wrapperSources.actions.edit")}
                  </Button>
                  <Button
                    variant="soft"
                    color="red"
                    disabled={isBuiltIn && !row.hasOverride}
                    onClick={() => {
                      if (isBuiltIn) {
                        clearBuiltInWrapperOverride(row.sourceId);
                        return;
                      }
                      removeCustomWrapperRule(row.ruleId);
                    }}
                  >
                    {t("options.wrapperSources.actions.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {sourceRows.filter((row) => row.kind === "custom").length === 0 ? (
          <Text color="gray">{t("options.wrapperSources.empty")}</Text>
        ) : null}
      </Card>

      <Dialog.Root
        open={wrapperEditor.open}
        onOpenChange={(open) => {
          if (!open) closeWrapperEditor();
        }}
      >
        <Dialog.Content maxWidth="660px" className="wrapper-editor-dialog">
          <Dialog.Title>
            {wrapperEditor.mode === "edit"
              ? t("options.wrapperSources.actions.edit")
              : t("options.wrapperSources.actions.add")}
          </Dialog.Title>

          <div className="c-stack">
            <div className="wrapper-editor-grid">
              <WrapperRuleEditorFields
                draft={wrapperEditor.draft}
                onDraftChange={updateWrapperEditorDraft}
                sourceOptions={sourceOptions}
                showAutoPrimary
                showIgnoreBulkMute
                onRunAction={runSelectorActionOnActiveTab}
                ignoreBulkMute={wrapperEditor.ignoreBulkMute === true}
                onIgnoreBulkMuteChange={(checked) => {
                  setWrapperEditor((prev) => ({ ...prev, ignoreBulkMute: checked === true }));
                }}
                showHostField={wrapperEditor.targetKind !== "builtin"}
                showLabelField={wrapperEditor.targetKind !== "builtin"}
                showPathRegexField={wrapperEditor.targetKind !== "builtin"}
                showChildSourcesField={wrapperEditor.targetKind !== "builtin"}
                showPickerButtons
                pickerButtonsDisabled
                pathRegexTemplate={pathRegexTemplateForEditor}
                canApplyPathRegexTemplate={Boolean(pathRegexTemplateForEditor)}
                onApplyPathRegexTemplate={(template) =>
                  updateWrapperEditorDraft((prev) => ({
                    ...prev,
                    pathRegex: String(template || "").trim(),
                  }))
                }
                labels={{
                  enabled: t("options.wrapperSources.fields.enabled"),
                  autoPrimary: t("options.wrapperSources.fields.autoPrimary"),
                  host: t("options.wrapperSources.fields.host"),
                  pathRegex: t("options.wrapperSources.fields.pathRegex"),
                  pathRegexApplyTitle: t("options.wrapperSources.actions.usePathRegexTemplate"),
                  label: t("options.wrapperSources.fields.label"),
                  childSources: t("options.wrapperSources.fields.childSources"),
                  controlSelectors: t("options.wrapperSources.fields.controlSelectors"),
                  runActionTitle: t("options.wrapperSources.actions.run"),
                  volumeModeTitle: t("options.wrapperSources.fields.volumeMode"),
                  volumeModeLabel: (mode) => t(`options.wrapperSources.volumeControlModes.${mode}`),
                  ignoreBulkMute: t("options.wrapperSources.fields.ignoreBulkMute"),
                  selectorPlaceholder: t("options.wrapperSources.placeholders.selector"),
                  hostPlaceholder: t("options.wrapperSources.placeholders.host"),
                  pathRegexPlaceholder: t("options.wrapperSources.placeholders.pathRegex"),
                  labelPlaceholder: t("options.wrapperSources.placeholders.label"),
                  actionLabel: (action) => t(`options.wrapperSources.controlActions.${action}`),
                }}
                ignoreBulkMuteLabel={t("options.wrapperSources.fields.ignoreBulkMute")}
                classNames={{
                  field: "field",
                  fieldFull: "field field--full",
                  controlsWrap: "c-stack wrapper-rule__controls",
                  selectorsList: "wrapper-editor-selectors",
                  selectorInput: "wrapper-selector-input",
                }}
                volumeModeOptions={WRAPPER_VOLUME_CONTROL_MODES}
              />
              <label className="field field--full">
                <Text size="1" color="gray">{t("options.wrapperSources.fields.shortVideoFilterSec")}</Text>
                <TextField.Root
                  type="number"
                  min={SOURCE_MIN_DURATION_SEC_MIN}
                  max={SOURCE_MIN_DURATION_SEC_MAX}
                  step={1}
                  value={String(
                    normalizeSourceMinDurationSec(
                      wrapperEditor.sourceMinDurationSec,
                      SOURCE_MIN_DURATION_SEC_DISABLED
                    )
                  )}
                  onInput={(event) => {
                    setWrapperEditor((prev) => ({
                      ...prev,
                      sourceMinDurationSec: normalizeSourceMinDurationSec(
                        event.currentTarget.value,
                        prev.sourceMinDurationSec
                      ),
                    }));
                  }}
                />
              </label>
            </div>

            {wrapperEditor.error ? (
              <Text color="red" size="2">{wrapperEditor.error}</Text>
            ) : null}

            <div className="c-cluster wrapper-editor-actions">
              <Button variant="soft" color="gray" onClick={closeWrapperEditor}>
                Cancel
              </Button>
              <Button onClick={saveWrapperEditor}>Save</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
