import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Card, Flex, Grid, Text, TextField, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { MSG } from "@/shared/messages";
import { PROVIDERS } from "@/shared/providers";
import { POPUP_WRAPPER_DRAFT_CREATE_RULE_ID, normalizePopupTabUrl } from "@/shared/popupPicker";
import { executeSelectorControl } from "@/sources/shared/selectorControl";
import {
  SOURCE_MIN_DURATION_SEC_DISABLED,
  SOURCE_MIN_DURATION_SEC_MAX,
  SOURCE_MIN_DURATION_SEC_MIN,
  normalizeSourceMinDurationSec,
} from "@/shared/webMediaSettings";
import {
  isWrapperSourceId,
  WRAPPER_VOLUME_CONTROL_MODES,
  makeWrapperSourceId,
  makePathRegexTemplate,
  normalizeChildSourceIds,
  normalizeWrapperControlModes,
  normalizeHost,
  normalizeHostList,
  normalizeWrapperControlSelectors,
  normalizeWrapperRules,
} from "@/shared/wrapperRules";
import { WrapperRuleEditorFields } from "@/shared/wrapperRuleEditorFields";

const ROOT_ID = "__np_wrapper_overlay_root";
const STYLE_ID = "__np_wrapper_overlay_style";
const PROVIDER_ID_BY_HOST = new Map();

for (const provider of PROVIDERS) {
  const providerId = String(provider?.id || "").trim().toLowerCase();
  if (!providerId) continue;
  for (const host of provider?.hosts || []) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) continue;
    if (!PROVIDER_ID_BY_HOST.has(normalizedHost)) {
      PROVIDER_ID_BY_HOST.set(normalizedHost, providerId);
    }
  }
}

function createRuleId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `rule-${Date.now().toString(36)}-${random}`;
}

function runtimeMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, message: "No response" });
    });
  });
}

function normalizeDraft(input, fallbackId = "") {
  const draft = input && typeof input === "object" ? input : {};
  return {
    id: String(draft.id || "").trim() || String(fallbackId || "").trim() || createRuleId(),
    enabled: draft.enabled !== false,
    autoPrimary: draft.autoPrimary !== false,
    host: normalizeHostList(draft.host || "").join(", "),
    pathRegex: String(draft.pathRegex || "").trim(),
    label: String(draft.label || "").trim(),
    childSourceIds: normalizeChildSourceIds(draft.childSourceIds || []),
    controlSelectors: normalizeWrapperControlSelectors(draft.controlSelectors),
    controlModes: normalizeWrapperControlModes(draft.controlModes),
  };
}

function resolveDraftRuleId(mode, draftId) {
  if (mode === "create") return POPUP_WRAPPER_DRAFT_CREATE_RULE_ID;
  const normalized = String(draftId || "").trim();
  return normalized || POPUP_WRAPPER_DRAFT_CREATE_RULE_ID;
}

function ensureStyles(documentRef) {
  if (documentRef.getElementById(STYLE_ID)) return;
  const style = documentRef.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }
    #${ROOT_ID} .np-overlay-window {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 16px));
      max-height: none;
      overflow: visible;
      pointer-events: auto;
      padding: 8px;
      border-radius: 10px;
      border: 1px solid var(--gray-a6);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
    }
    #${ROOT_ID} .np-overlay-header {
      cursor: grab;
      user-select: none;
      margin-bottom: 8px;
    }
    #${ROOT_ID} .np-overlay-header:active {
      cursor: grabbing;
    }
    #${ROOT_ID} .np-overlay-grid {
      gap: 8px;
    }
    #${ROOT_ID} .np-overlay-field {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    #${ROOT_ID} .np-overlay-field--full {
      grid-column: 1 / -1;
    }
    #${ROOT_ID} .wrapper-rule-checkbox-field {
      display: flex !important;
      align-items: center;
      gap: 8px;
    }
    #${ROOT_ID} .np-overlay-selectors {
      border: 1px solid var(--gray-a6);
      border-radius: 8px;
      padding: 6px;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
    #${ROOT_ID} .np-overlay-control-card {
      border: 1px solid var(--gray-a5);
      border-radius: 8px;
      padding: 6px;
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    #${ROOT_ID} .np-overlay-control-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${ROOT_ID} .np-overlay-control-icon {
      color: var(--gray-11);
      flex: none;
    }
    #${ROOT_ID} .np-overlay-selector-input {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0;
      align-items: center;
    }
    #${ROOT_ID} .np-overlay-selector-input--with-run {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    #${ROOT_ID} .np-overlay-selector-input--with-volume-mode {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    #${ROOT_ID} .np-overlay-selector-input--no-picker-with-run {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    #${ROOT_ID} .np-overlay-selector-input--no-picker-with-volume-mode {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    #${ROOT_ID} .np-overlay-selector-mode .rt-SelectTrigger {
      min-width: 102px;
    }
    #${ROOT_ID} .np-overlay-selector-mode-popover {
      z-index: 2147483647 !important;
    }
    #${ROOT_ID} .np-overlay-actions {
      margin-top: 10px;
    }
    #${ROOT_ID} .np-overlay-status {
      margin-top: 8px;
      min-height: 16px;
    }
    #${ROOT_ID} .np-field-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      width: 100%;
    }
    #${ROOT_ID} .np-multi-trigger {
      display: flex !important;
      width: 100%;
      justify-content: flex-start;
      align-items: flex-start;
      min-height: 34px;
      height: auto !important;
      padding: 6px 8px !important;
      white-space: normal !important;
      line-height: 1.2;
    }
    #${ROOT_ID} .np-multi-trigger__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      width: 100%;
      min-height: 18px;
    }
    #${ROOT_ID} .np-multi-trigger__placeholder {
      color: var(--gray-11);
    }
    #${ROOT_ID} .np-multi-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      border-radius: 999px;
      min-height: 22px;
      padding: 3px 10px;
      background: var(--np-chip-bg, var(--gray-a4));
      color: var(--np-chip-fg, var(--gray-11));
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${ROOT_ID} .np-multi-popover {
      width: 260px;
      max-height: 240px;
      overflow: auto;
      z-index: 2147483647 !important;
    }
    .np-overlay-multi-popover {
      width: 260px;
      max-height: 240px;
      overflow: auto;
      z-index: 2147483647 !important;
    }
    .np-overlay-multi-popover .np-multi-list {
      display: grid;
      gap: 6px;
    }
    .np-overlay-multi-popover .np-field-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      width: 100%;
    }
    #${ROOT_ID} .np-multi-list {
      display: grid;
      gap: 6px;
    }
    @media (max-width: 980px) {
      #${ROOT_ID} .np-overlay-window {
        width: min(480px, calc(100vw - 16px));
      }
    }
    @media (max-width: 740px) {
      #${ROOT_ID} .np-overlay-window {
        width: calc(100vw - 12px);
        max-height: calc(100vh - 12px);
        overflow: auto;
      }
      #${ROOT_ID} .np-overlay-selectors {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
  documentRef.documentElement.appendChild(style);
}

function collectDefaultChildSourceIds({ locationRef, documentRef, adapter, seedChildSourceIds = [] }) {
  const known = new Set();

  for (const sourceId of normalizeChildSourceIds(seedChildSourceIds)) {
    known.add(sourceId);
  }

  const adapterId = String(adapter?.id || "").trim().toLowerCase();
  if (adapterId) known.add(adapterId);

  const pageHost = normalizeHost(locationRef?.href || "");
  const pageHostSourceId = PROVIDER_ID_BY_HOST.get(pageHost);
  if (pageHostSourceId) known.add(pageHostSourceId);

  if (typeof documentRef?.querySelectorAll === "function") {
    const frames = documentRef.querySelectorAll("iframe[src]");
    for (const frame of frames) {
      const rawSrc = String(frame?.getAttribute?.("src") || "").trim();
      if (!rawSrc) continue;

      let frameUrl = null;
      try {
        frameUrl = new URL(rawSrc, locationRef?.href || "");
      } catch (_) {
        frameUrl = null;
      }
      if (!frameUrl) continue;

      const frameHost = normalizeHost(frameUrl.hostname || "");
      const frameSourceId = PROVIDER_ID_BY_HOST.get(frameHost);
      if (frameSourceId) known.add(frameSourceId);
    }
  }

  return normalizeChildSourceIds([...known]);
}

function buildDefaultDraft({ locationRef, documentRef, adapter, seedChildSourceIds = [] }) {
  const host = normalizeHost(locationRef.href || "");
  const childSourceIds = collectDefaultChildSourceIds({
    locationRef,
    documentRef,
    adapter,
    seedChildSourceIds,
  });
  return normalizeDraft({
    enabled: true,
    host,
    pathRegex: "",
    label: host ? host.replace(/^www\./, "").split(".")[0] : "",
    childSourceIds,
    controlSelectors: {},
  });
}

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

function resolveSourceBulkMuteIgnore(settings, sourceId) {
  const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
  if (!normalizedSourceId) return false;
  return settings?.sourceBulkMuteIgnoreMap?.[normalizedSourceId] === true;
}

function resolveSourceMinDurationSec(settings, sourceId) {
  const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
  if (!normalizedSourceId) return SOURCE_MIN_DURATION_SEC_DISABLED;
  return normalizeSourceMinDurationSec(
    settings?.sourceMinDurationSecMap?.[normalizedSourceId],
    SOURCE_MIN_DURATION_SEC_DISABLED
  );
}

function WrapperRuleOverlayApp({
  initialDraft,
  initialIgnoreBulkMute = false,
  initialSourceMinDurationSec = SOURCE_MIN_DURATION_SEC_DISABLED,
  mode,
  sourceOptions,
  pickerController,
  currentPageHost = "",
  currentPathRegexTemplate = "",
  onSave,
  onDraftUpsert,
  onClose,
}) {
  const [draft, setDraft] = useState(() => normalizeDraft(initialDraft));
  const [ignoreBulkMute, setIgnoreBulkMute] = useState(initialIgnoreBulkMute === true);
  const [sourceMinDurationSec, setSourceMinDurationSec] = useState(
    normalizeSourceMinDurationSec(initialSourceMinDurationSec, SOURCE_MIN_DURATION_SEC_DISABLED)
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickAction, setPickAction] = useState("");
  const [pickRequestId, setPickRequestId] = useState("");
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const pickRequestRef = useRef("");
  const hostPatterns = normalizeHostList(draft?.host || "");
  const canApplyPathRegexTemplate =
    Boolean(currentPathRegexTemplate) &&
    hostPatterns.some((pattern) => isHostPatternMatch(pattern, currentPageHost));

  useEffect(() => {
    setDraft(normalizeDraft(initialDraft));
  }, [initialDraft]);

  useEffect(() => {
    setIgnoreBulkMute(initialIgnoreBulkMute === true);
  }, [initialIgnoreBulkMute]);

  useEffect(() => {
    setSourceMinDurationSec(
      normalizeSourceMinDurationSec(initialSourceMinDurationSec, SOURCE_MIN_DURATION_SEC_DISABLED)
    );
  }, [initialSourceMinDurationSec]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void onDraftUpsert(draft, mode);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [draft, mode, onDraftUpsert]);

  useEffect(() => {
    pickRequestRef.current = pickRequestId;
  }, [pickRequestId]);

  useEffect(() => {
    return () => {
      const requestId = String(pickRequestRef.current || "").trim();
      if (requestId && pickerController) pickerController.cancel(requestId);
    };
  }, [pickerController]);

  const onHeaderPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-no-drag='1']")) return;

    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };

    const onMove = (moveEvent) => {
      if (!dragRef.current || !cardRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      const left = dragRef.current.startLeft + dx;
      const top = dragRef.current.startTop + dy;
      cardRef.current.style.left = `${left}px`;
      cardRef.current.style.top = `${top}px`;
      cardRef.current.style.transform = "none";
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  };

  const updateControlSelector = (action, value) => {
    setDraft((prev) => ({
      ...prev,
      controlSelectors: normalizeWrapperControlSelectors({
        ...(prev.controlSelectors || {}),
        [action]: String(value || ""),
      }),
    }));
  };

  const handleSave = async () => {
    setBusy(true);
    const result = await onSave(draft, mode, {
      ignoreBulkMute,
      sourceMinDurationSec,
    });
    setBusy(false);
    if (!result?.ok) {
      setStatus(String(result?.message || "Save failed"));
      return;
    }
    setStatus("Saved");
    onClose();
  };

  const handleClose = () => {
    const requestId = String(pickRequestRef.current || "").trim();
    if (requestId && pickerController) pickerController.cancel(requestId);
    onClose();
  };

  const togglePick = async (action) => {
    if (!pickerController) return;
    const normalizedAction = String(action || "").trim();
    if (!normalizedAction) return;

    if (pickAction === normalizedAction && pickRequestId) {
      pickerController.cancel(pickRequestId);
      setPickAction("");
      setPickRequestId("");
      setStatus("");
      return;
    }

    if (pickRequestId) {
      pickerController.cancel(pickRequestId);
    }

    const requestId = `overlay-pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const result = pickerController.start(requestId, {
      emitBackground: false,
      onResult: (payload) => {
        if (String(payload?.requestId || "") !== requestId) return;

        const selector = String(payload?.selector || "").trim();
        if (payload?.ok && selector) {
          updateControlSelector(normalizedAction, selector);
          setStatus(`Selected for ${normalizedAction}`);
        } else if (String(payload?.message || "").trim() !== "canceled") {
          setStatus(String(payload?.message || "Pick failed"));
        } else {
          setStatus("");
        }

        setPickAction("");
        setPickRequestId("");
      },
    });

    if (!result?.ok) {
      setStatus(String(result?.message || "Pick failed"));
      return;
    }

    setPickAction(normalizedAction);
    setPickRequestId(requestId);
    setStatus("Picking element… Esc to cancel");
  };

  const runAction = async (action, selector, mode = "") => {
    const normalizedAction = String(action || "").trim();
    const normalizedSelector = String(selector || "").trim();
    if (!normalizedAction || !normalizedSelector) return;
    const value = normalizedAction === "volume" ? 0.5 : undefined;
    const result = executeSelectorControl(
      normalizedAction,
      normalizedSelector,
      value,
      document,
      String(mode || "").trim()
    );
    if (result?.ok) {
      setStatus(`Executed: ${normalizedAction}`);
      return;
    }
    setStatus(String(result?.message || `Failed: ${normalizedAction}`));
  };

  return (
    <Theme
      appearance="dark"
      accentColor="teal"
      grayColor="slate"
      radius="medium"
      scaling="95%"
      panelBackground="solid"
      hasBackground={false}
    >
      <Card className="np-overlay-window" ref={cardRef}>
        <Flex className="np-overlay-header" align="center" justify="start" onPointerDown={onHeaderPointerDown}>
          <Text size="4" weight="bold">
            Wrapper source
          </Text>
        </Flex>

        <Grid columns="2" className="np-overlay-grid">
          <WrapperRuleEditorFields
            draft={draft}
            onDraftChange={setDraft}
            sourceOptions={sourceOptions}
            showAutoPrimary
            showIgnoreBulkMute
            onRunAction={runAction}
            ignoreBulkMute={ignoreBulkMute}
            onIgnoreBulkMuteChange={(checked) => setIgnoreBulkMute(checked === true)}
            ignoreBulkMuteLabel="Ignore global mute/unmute for this source"
            childSourcesFieldFull={false}
            multiSelectPopoverClassName="np-overlay-multi-popover"
            onTogglePick={togglePick}
            pickAction={pickAction}
            pathRegexTemplate={canApplyPathRegexTemplate ? currentPathRegexTemplate : ""}
            canApplyPathRegexTemplate={canApplyPathRegexTemplate}
            onApplyPathRegexTemplate={(template) =>
              setDraft((prev) => ({
                ...prev,
                pathRegex: String(template || "").trim(),
              }))
            }
            labels={{
              enabled: "Enabled",
              autoPrimary: "Allow auto-set as primary",
              host: "Host",
              pathRegex: "Path regex",
              pathRegexApplyTitle: "Use current path regex",
              label: "Label",
              childSources: "Child sources",
              controlSelectors: "Control selectors",
              volumeModeTitle: "Volume mode",
              volumeModeLabel: (mode) => {
                if (mode === "click") return "Click";
                if (mode === "press") return "Press";
                if (mode === "drag") return "Drag";
                if (mode === "range") return "Range";
                if (mode === "noui") return "noUi";
                return "Auto";
              },
              runActionTitle: "Run action",
              pickActionTitle: "Pick selector",
              actionLabel: (action) => action,
            }}
            volumeModeOptions={WRAPPER_VOLUME_CONTROL_MODES}
            classNames={{
              field: "np-overlay-field",
              fieldFull: "np-overlay-field np-overlay-field--full",
              controlsWrap: "",
              selectorsList: "np-overlay-selectors",
              selectorInput: "np-overlay-selector-input",
              selectorMode: "np-overlay-selector-mode",
              selectorModePopover: "np-overlay-selector-mode-popover",
              icon: "np-overlay-control-icon",
            }}
          />
          <label className="np-overlay-field np-overlay-field--full">
            <Text size="1" color="gray">Short video filter (sec, 0 = off)</Text>
            <TextField.Root
              type="number"
              min={SOURCE_MIN_DURATION_SEC_MIN}
              max={SOURCE_MIN_DURATION_SEC_MAX}
              step={1}
              value={String(
                normalizeSourceMinDurationSec(
                  sourceMinDurationSec,
                  SOURCE_MIN_DURATION_SEC_DISABLED
                )
              )}
              onInput={(event) => {
                setSourceMinDurationSec(
                  normalizeSourceMinDurationSec(
                    event.currentTarget.value,
                    SOURCE_MIN_DURATION_SEC_DISABLED
                  )
                );
              }}
            />
          </label>
        </Grid>

        <Flex className="np-overlay-actions" align="center" justify="end" gap="2">
          <Button variant="surface" color="gray" disabled={busy} onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={busy} onClick={() => void handleSave()}>
            Save
          </Button>
        </Flex>

        <Text size="1" color="gray" className="np-overlay-status">
          {status}
        </Text>
      </Card>
    </Theme>
  );
}

export function createWrapperRuleOverlay({
  windowRef = window,
  documentRef = document,
  locationRef = location,
  adapter = null,
  pickerController = null,
} = {}) {
  let root = null;
  let mode = "create";

  const sourceOptions = PROVIDERS
    .map((provider) => ({
      value: String(provider.id || "").trim().toLowerCase(),
      label: provider.label || provider.id,
    }))
    .filter((option) => option.value);
  const allowedSourceIds = new Set(sourceOptions.map((option) => option.value));

  function sanitizeChildSourceIds(ids) {
    const out = [];
    for (const sourceId of normalizeChildSourceIds(ids)) {
      if (!sourceId) continue;
      if (isWrapperSourceId(sourceId)) continue;
      if (!allowedSourceIds.has(sourceId)) continue;
      if (out.includes(sourceId)) continue;
      out.push(sourceId);
    }
    return out;
  }

  function close() {
    if (!root) return;
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  async function upsertDraftStorage(draft) {
    const normalizedDraft = normalizeDraft(
      {
        ...draft,
        childSourceIds: sanitizeChildSourceIds(draft?.childSourceIds || []),
      },
      draft?.id
    );
    const ruleId = resolveDraftRuleId(mode, normalizedDraft.id);
    await runtimeMessage({
      type: MSG.POPUP_WRAPPER_DRAFT_UPSERT,
      urlKey: normalizePopupTabUrl(locationRef.href || ""),
      ruleId,
      mode,
      draft: normalizedDraft,
    });
  }

  async function loadDraftFromStorage(fallbackDraft, fallbackAutoPrimary = true) {
    const ruleId = resolveDraftRuleId(mode, fallbackDraft.id);
    const response = await runtimeMessage({
      type: MSG.POPUP_WRAPPER_DRAFT_GET,
      urlKey: normalizePopupTabUrl(locationRef.href || ""),
      ruleId,
    });
    if (response?.ok && response.entry?.draft) {
      return normalizeDraft(
        {
          ...response.entry.draft,
          autoPrimary:
            response?.entry && typeof response.entry.autoPrimary === "boolean"
              ? response.entry.autoPrimary
              : fallbackAutoPrimary !== false,
          childSourceIds: sanitizeChildSourceIds(response.entry?.draft?.childSourceIds || []),
        },
        fallbackDraft.id
      );
    }
    return normalizeDraft(
      {
        ...fallbackDraft,
        autoPrimary: fallbackAutoPrimary !== false,
      },
      fallbackDraft.id
    );
  }

  async function clearDraftStorage(ruleId) {
    await runtimeMessage({
      type: MSG.POPUP_WRAPPER_DRAFT_CLEAR,
      urlKey: normalizePopupTabUrl(locationRef.href || ""),
      ruleId: resolveDraftRuleId(mode, ruleId),
    });
  }

  async function saveRule(draft, _mode, extra = {}) {
    const normalizedDraft = normalizeDraft(
      {
        ...draft,
        childSourceIds: sanitizeChildSourceIds(draft?.childSourceIds || []),
      },
      draft?.id || createRuleId()
    );

    if (!normalizedDraft.host) {
      return { ok: false, message: "Host is required" };
    }
    if (!(normalizedDraft.childSourceIds || []).length) {
      return { ok: false, message: "Select at least one child source" };
    }

    const settingsResp = await runtimeMessage({ type: MSG.SETTINGS_GET });
    if (!settingsResp?.ok) {
      return { ok: false, message: `Settings error: ${String(settingsResp?.message || "unknown")}` };
    }

    const rules = normalizeWrapperRules(settingsResp.settings?.wrapperRules || []);
    const exists = rules.some((rule) => rule.id === normalizedDraft.id);
    const ruleDraft = {
      ...normalizedDraft,
    };
    delete ruleDraft.autoPrimary;
    const nextRules = exists
      ? rules.map((rule) => (rule.id === normalizedDraft.id ? ruleDraft : rule))
      : [...rules, ruleDraft];
    const nextAutoPickMap = {
      ...(settingsResp.settings?.primarySourceAutoPickMap || {}),
    };
    const nextSourceBulkMuteIgnoreMap = {
      ...(settingsResp.settings?.sourceBulkMuteIgnoreMap || {}),
    };
    const nextSourceMinDurationSecMap = {
      ...(settingsResp.settings?.sourceMinDurationSecMap || {}),
    };
    const wrapperSourceId = makeWrapperSourceId(normalizedDraft.id);
    if (wrapperSourceId) {
      nextAutoPickMap[wrapperSourceId] = normalizedDraft.autoPrimary !== false;
      nextSourceBulkMuteIgnoreMap[wrapperSourceId] = extra?.ignoreBulkMute === true;
      nextSourceMinDurationSecMap[wrapperSourceId] = normalizeSourceMinDurationSec(
        extra?.sourceMinDurationSec,
        SOURCE_MIN_DURATION_SEC_DISABLED
      );
    }

    const saveResp = await runtimeMessage({
      type: MSG.SETTINGS_SET,
      patch: {
        wrapperRules: nextRules,
        primarySourceAutoPickMap: nextAutoPickMap,
        sourceBulkMuteIgnoreMap: nextSourceBulkMuteIgnoreMap,
        sourceMinDurationSecMap: nextSourceMinDurationSecMap,
      },
    });
    if (!saveResp?.ok) {
      return { ok: false, message: `Save failed: ${String(saveResp?.message || "unknown")}` };
    }

    await clearDraftStorage(normalizedDraft.id);
    if (mode === "create") {
      await clearDraftStorage(POPUP_WRAPPER_DRAFT_CREATE_RULE_ID);
    }

    return { ok: true };
  }

  async function open(params = {}) {
    ensureStyles(documentRef);
    close();

    mode = params?.mode === "edit" ? "edit" : "create";
    const ruleId = String(params?.ruleId || "").trim();

    const settingsResp = await runtimeMessage({ type: MSG.SETTINGS_GET });
    if (!settingsResp?.ok) {
      return { ok: false, message: settingsResp?.message || "Settings unavailable" };
    }

    const rules = normalizeWrapperRules(settingsResp.settings?.wrapperRules || []);
    const existingRule = mode === "edit" ? rules.find((rule) => rule.id === ruleId) : null;
    const existingSourceId = existingRule ? makeWrapperSourceId(existingRule.id) : "";
    const fallbackAutoPrimary =
      !existingSourceId || (settingsResp.settings?.primarySourceAutoPickMap || {})[existingSourceId] !== false;
    const baseDraft = existingRule
      ? existingRule
      : buildDefaultDraft({
          locationRef,
          documentRef,
          adapter,
          seedChildSourceIds: params?.seedChildSourceIds || [],
        });
    const fallbackDraft = normalizeDraft(
      {
        ...baseDraft,
        autoPrimary: fallbackAutoPrimary,
      },
      existingRule?.id || baseDraft?.id
    );
    fallbackDraft.childSourceIds = sanitizeChildSourceIds(fallbackDraft.childSourceIds || []);
    const fallbackSourceId = existingSourceId || makeWrapperSourceId(fallbackDraft.id);
    const initialIgnoreBulkMute = resolveSourceBulkMuteIgnore(
      settingsResp.settings,
      fallbackSourceId
    );
    const initialSourceMinDurationSec = resolveSourceMinDurationSec(
      settingsResp.settings,
      fallbackSourceId
    );
    let initialDraft = await loadDraftFromStorage(fallbackDraft, fallbackAutoPrimary);
    const initialChildSourceIds = sanitizeChildSourceIds(initialDraft.childSourceIds || []);
    if (initialChildSourceIds.length !== (initialDraft.childSourceIds || []).length) {
      initialDraft = normalizeDraft(
        {
          ...initialDraft,
          childSourceIds: initialChildSourceIds,
        },
        fallbackDraft.id
      );
    }
    if (mode === "create" && !(initialDraft.childSourceIds || []).length && (fallbackDraft.childSourceIds || []).length) {
      initialDraft = normalizeDraft(
        {
          ...initialDraft,
          childSourceIds: fallbackDraft.childSourceIds,
        },
        fallbackDraft.id
      );
    }

    root = documentRef.createElement("div");
    root.id = ROOT_ID;
    documentRef.documentElement.appendChild(root);

    render(
      <WrapperRuleOverlayApp
        initialDraft={initialDraft}
        initialIgnoreBulkMute={initialIgnoreBulkMute}
        initialSourceMinDurationSec={initialSourceMinDurationSec}
        mode={mode}
        sourceOptions={sourceOptions}
        pickerController={pickerController}
        currentPageHost={normalizeHost(locationRef.href || "")}
        currentPathRegexTemplate={makePathRegexTemplate(locationRef.href || "")}
        onSave={saveRule}
        onDraftUpsert={upsertDraftStorage}
        onClose={close}
      />,
      root
    );

    return { ok: true };
  }

  return {
    open,
    close,
    isOpen: () => Boolean(root),
  };
}
