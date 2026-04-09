import { Button, Checkbox, IconButton, Text, TextField } from "@radix-ui/themes";
import {
  CommitIcon,
  LightningBoltIcon,
  MagicWandIcon,
  PauseIcon,
  PlayIcon,
  SpeakerLoudIcon,
  SpeakerOffIcon,
  TrackNextIcon,
  TrackPreviousIcon,
} from "@radix-ui/react-icons";
import { NpMultiSelect, NpSelect } from "@/shared/radix";
import {
  normalizeChildSourceIds,
  normalizeWrapperControlModes,
  normalizeWrapperVolumeControlMode,
  normalizeHostList,
  normalizeWrapperControlSelectors,
  WRAPPER_VOLUME_CONTROL_MODES,
  WRAPPER_VOLUME_CONTROL_MODE_DEFAULT,
  WRAPPER_CONTROL_EDITOR_ACTIONS,
} from "@/shared/wrapperRules";
import "./wrapperRuleEditorFields.css";

function iconByAction(action) {
  if (action === "play") return PlayIcon;
  if (action === "pause") return PauseIcon;
  if (action === "next") return TrackNextIcon;
  if (action === "previous") return TrackPreviousIcon;
  if (action === "volume") return CommitIcon;
  if (action === "mute") return SpeakerOffIcon;
  if (action === "unmute") return SpeakerLoudIcon;
  if (action === "toggle") return PlayIcon;
  if (action === "muteToggle") return SpeakerOffIcon;
  return PlayIcon;
}

function withDefaults(labels = {}) {
  return {
    enabled: labels.enabled || "Enabled",
    autoPrimary: labels.autoPrimary || "Allow auto-set as primary",
    host: labels.host || "Host",
    pathRegex: labels.pathRegex || "Path regex",
    label: labels.label || "Label",
    childSources: labels.childSources || "Child sources",
    controlSelectors: labels.controlSelectors || "Control selectors",
    selectorPlaceholder: labels.selectorPlaceholder || "",
    hostPlaceholder: labels.hostPlaceholder || "",
    pathRegexPlaceholder: labels.pathRegexPlaceholder || "",
    pathRegexApplyTitle: labels.pathRegexApplyTitle || "Use path regex template",
    runActionTitle: labels.runActionTitle || "Run action",
    volumeModeTitle: labels.volumeModeTitle || "Volume mode",
    volumeModeLabel:
      typeof labels.volumeModeLabel === "function"
        ? labels.volumeModeLabel
        : (mode) => String(mode || ""),
    labelPlaceholder: labels.labelPlaceholder || "",
    pickActionTitle: labels.pickActionTitle || "Pick selector",
    actionLabel:
      typeof labels.actionLabel === "function"
        ? labels.actionLabel
        : (action) => String(action || ""),
  };
}

function withClassNames(classNames = {}) {
  const selectorInput = classNames.selectorInput || "wrapper-selector-input";
  return {
    field: classNames.field || "field",
    fieldFull: classNames.fieldFull || "field field--full",
    controlsWrap: classNames.controlsWrap || "c-stack wrapper-rule__controls",
    selectorsList: classNames.selectorsList || "c-grid",
    selectorInput,
    selectorInputWithRun:
      classNames.selectorInputWithRun || `${selectorInput}--with-run`,
    selectorInputNoPicker:
      classNames.selectorInputNoPicker || `${selectorInput}--no-picker`,
    selectorInputNoPickerWithRun:
      classNames.selectorInputNoPickerWithRun || `${selectorInput}--no-picker-with-run`,
    selectorInputWithVolumeMode:
      classNames.selectorInputWithVolumeMode || `${selectorInput}--with-volume-mode`,
    selectorInputNoPickerWithVolumeMode:
      classNames.selectorInputNoPickerWithVolumeMode ||
      `${selectorInput}--no-picker-with-volume-mode`,
    selectorMode: classNames.selectorMode || "wrapper-selector-mode",
    selectorModePopover:
      classNames.selectorModePopover || "wrapper-selector-mode-popover",
    icon: classNames.icon || "",
  };
}

export function WrapperRuleEditorFields({
  draft,
  onDraftChange,
  sourceOptions = [],
  labels = {},
  classNames = {},
  showAutoPrimary = false,
  onTogglePick = null,
  pickAction = "",
  showPickerButtons = false,
  pickerButtonsDisabled = false,
  showActionLabels = false,
  onRunAction = null,
  runButtonsDisabled = false,
  volumeModeOptions = WRAPPER_VOLUME_CONTROL_MODES,
  multiSelectPopoverClassName = "",
  showHostField = true,
  showLabelField = true,
  showPathRegexField = true,
  showChildSourcesField = true,
  childSourcesFieldFull = true,
  showIgnoreBulkMute = false,
  ignoreBulkMute = false,
  onIgnoreBulkMuteChange = null,
  ignoreBulkMuteLabel = "",
  pathRegexTemplate = "",
  canApplyPathRegexTemplate = false,
  onApplyPathRegexTemplate = null,
}) {
  const ui = withDefaults(labels);
  const cls = withClassNames(classNames);
  const hasPickerHandler = typeof onTogglePick === "function";
  const hasPickerUi = showPickerButtons || hasPickerHandler;
  const hasRunHandler = typeof onRunAction === "function";
  const normalizedPathRegexTemplate = String(pathRegexTemplate || "").trim();
  const pathRegexApplyAvailable =
    showPathRegexField &&
    canApplyPathRegexTemplate === true &&
    normalizedPathRegexTemplate &&
    typeof onApplyPathRegexTemplate === "function";

  return (
    <>
      <label className={`${cls.fieldFull} wrapper-rule-checkbox-field`}>
        <Checkbox
          variant="classic"
          checked={draft?.enabled !== false}
          onCheckedChange={(checked) =>
            onDraftChange((prev) => ({
              ...prev,
              enabled: checked === true,
            }))
          }
        />
        <Text size="2">{ui.enabled}</Text>
      </label>

      {showHostField ? (
        <label className={cls.field}>
          <Text size="1" color="gray">{ui.host}</Text>
          <TextField.Root
            value={draft?.host || ""}
            placeholder={ui.hostPlaceholder}
            onInput={(event) =>
              onDraftChange((prev) => ({
                ...prev,
                host: normalizeHostList(event.currentTarget.value).join(", "),
              }))
            }
          />
        </label>
      ) : null}

      {showLabelField ? (
        <label className={cls.field}>
          <Text size="1" color="gray">{ui.label}</Text>
          <TextField.Root
            value={draft?.label || ""}
            placeholder={ui.labelPlaceholder}
            onInput={(event) =>
              onDraftChange((prev) => ({
                ...prev,
                label: event.currentTarget.value,
              }))
            }
          />
        </label>
      ) : null}

      {showPathRegexField ? (
        <label className={cls.field}>
          <Text size="1" color="gray">{ui.pathRegex}</Text>
          <TextField.Root
            value={draft?.pathRegex || ""}
            placeholder={normalizedPathRegexTemplate || ui.pathRegexPlaceholder}
            onInput={(event) =>
              onDraftChange((prev) => ({
                ...prev,
                pathRegex: event.currentTarget.value,
              }))
            }
          >
            {pathRegexApplyAvailable ? (
              <TextField.Slot side="right" pr="1">
                <IconButton
                  type="button"
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => onApplyPathRegexTemplate(normalizedPathRegexTemplate)}
                  title={ui.pathRegexApplyTitle}
                  aria-label={ui.pathRegexApplyTitle}
                >
                  <MagicWandIcon className={cls.icon} />
                </IconButton>
              </TextField.Slot>
            ) : null}
          </TextField.Root>
        </label>
      ) : null}

      {showChildSourcesField ? (
        <div className={childSourcesFieldFull ? cls.fieldFull : cls.field}>
          <Text size="1" color="gray">{ui.childSources}</Text>
          <NpMultiSelect
            value={draft?.childSourceIds || []}
            options={sourceOptions}
            popoverClassName={multiSelectPopoverClassName}
            onChange={(nextValues) =>
              onDraftChange((prev) => ({
                ...prev,
                childSourceIds: normalizeChildSourceIds(nextValues),
              }))
            }
          />
        </div>
      ) : null}

      {showAutoPrimary ? (
        <label className={`${cls.fieldFull} np-field-checkbox`}>
          <Checkbox
            variant="classic"
            checked={draft?.autoPrimary !== false}
            onCheckedChange={(checked) => {
              onDraftChange((prev) => ({
                ...prev,
                autoPrimary: checked === true,
              }));
            }}
          />
          <Text size="2">{ui.autoPrimary}</Text>
        </label>
      ) : null}

      {showIgnoreBulkMute ? (
        <label className={`${cls.fieldFull} np-field-checkbox`}>
          <Checkbox
            variant="classic"
            checked={ignoreBulkMute === true}
            onCheckedChange={(checked) => {
              if (typeof onIgnoreBulkMuteChange === "function") {
                onIgnoreBulkMuteChange(checked === true);
              }
            }}
          />
          <Text size="2">{ignoreBulkMuteLabel}</Text>
        </label>
      ) : null}

      <div className={cls.fieldFull}>
        <div className={cls.controlsWrap}>
          <Text size="1" color="gray">{ui.controlSelectors}</Text>
          <div className={cls.selectorsList}>
            {WRAPPER_CONTROL_EDITOR_ACTIONS.map((action) => {
              const isPicking = String(pickAction || "") === action;
              const selectorValue = String(draft?.controlSelectors?.[action] || "");
              const isVolumeAction = action === "volume";
              const volumeMode = normalizeWrapperVolumeControlMode(
                draft?.controlModes?.volume,
                WRAPPER_VOLUME_CONTROL_MODE_DEFAULT
              );
              const ActionIcon = iconByAction(action);
              const pickTitle = `${ui.pickActionTitle}: ${ui.actionLabel(action)}`;
              const runTitle = `${ui.runActionTitle}: ${ui.actionLabel(action)}`;
              return (
                <label className={cls.field} key={`editor-field:${action}`}>
                  {showActionLabels ? (
                    <Text size="1" color="gray">{ui.actionLabel(action)}</Text>
                  ) : null}
                  <div
                    className={[
                      cls.selectorInput,
                      !hasPickerUi && isVolumeAction
                        ? cls.selectorInputNoPickerWithVolumeMode
                      : !hasPickerUi && hasRunHandler
                        ? cls.selectorInputNoPickerWithRun
                      : !hasPickerUi
                        ? cls.selectorInputNoPicker
                            : isVolumeAction
                              ? cls.selectorInputWithVolumeMode
                              : hasRunHandler
                                ? cls.selectorInputWithRun
                                : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {hasPickerUi ? (
                      <Button
                        type="button"
                        size="1"
                        variant={isPicking ? "solid" : "soft"}
                        color={isPicking ? "amber" : "gray"}
                        disabled={pickerButtonsDisabled || !hasPickerHandler}
                        onClick={() => {
                          if (hasPickerHandler) void onTogglePick(action);
                        }}
                        title={pickTitle}
                        aria-label={pickTitle}
                      >
                        <ActionIcon className={cls.icon} />
                      </Button>
                    ) : null}
                    <TextField.Root
                      size="1"
                      value={selectorValue}
                      placeholder={ui.selectorPlaceholder}
                      onInput={(event) =>
                        onDraftChange((prev) => ({
                          ...prev,
                          controlSelectors: normalizeWrapperControlSelectors({
                            ...(prev.controlSelectors || {}),
                            [action]: event.currentTarget.value,
                          }),
                        }))
                      }
                    />
                    {isVolumeAction && hasRunHandler ? (
                      <div className={cls.selectorMode}>
                        <NpSelect
                          size="1"
                          value={volumeMode}
                          contentClassName={cls.selectorModePopover}
                          contentPosition="popper"
                          contentSide="top"
                          contentAlign="end"
                          contentSideOffset={6}
                          options={(volumeModeOptions || WRAPPER_VOLUME_CONTROL_MODES).map(
                            (mode) => ({
                              value: mode,
                              label: ui.volumeModeLabel(mode),
                            })
                          )}
                          onValueChange={(nextMode) =>
                            onDraftChange((prev) => ({
                              ...prev,
                              controlModes: normalizeWrapperControlModes({
                                ...(prev.controlModes || {}),
                                volume: nextMode,
                              }),
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {hasRunHandler && !isVolumeAction ? (
                      <Button
                        type="button"
                        size="1"
                        variant="soft"
                        color="gray"
                        disabled={runButtonsDisabled || !selectorValue}
                        onClick={() => {
                          if (!selectorValue || !hasRunHandler) return;
                          void onRunAction(action, selectorValue, "");
                        }}
                        title={runTitle}
                        aria-label={runTitle}
                      >
                        <LightningBoltIcon className={cls.icon} />
                      </Button>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
