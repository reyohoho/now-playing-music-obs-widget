import { attrOf, isVisible, qAll } from "@/sources/shared/dom";
const SHADOW_SELECTOR_SEPARATOR = ">>>";
const VOLUME_CONTROL_MODES = new Set(["auto", "click", "press", "drag", "range", "noui"]);

function isDisabled(node) {
  if (!node) return true;
  if ("disabled" in node && node.disabled) return true;
  return String(attrOf(node, "aria-disabled") || "").toLowerCase().trim() === "true";
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeOrientation(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "vertical" || normalized === "horizontal") return normalized;
  return "";
}

function normalizeVolumeControlMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (VOLUME_CONTROL_MODES.has(normalized)) return normalized;
  return "auto";
}

function normalizeSelectors(selectors) {
  if (Array.isArray(selectors)) return selectors.filter(Boolean);
  if (!selectors) return [];
  return [selectors];
}

function splitShadowSelector(selector) {
  const value = String(selector || "").trim();
  if (!value.includes(SHADOW_SELECTOR_SEPARATOR)) return [];
  return value
    .split(SHADOW_SELECTOR_SEPARATOR)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function querySelectorAllSafe(root, selector) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  try {
    return [...root.querySelectorAll(selector)];
  } catch (_) {
    return [];
  }
}

function resolveSelectorNodes(selector, doc = document) {
  const chain = splitShadowSelector(selector);
  if (!chain.length) return qAll(selector, doc);

  let roots = [doc];
  for (let idx = 0; idx < chain.length; idx += 1) {
    const segment = chain[idx];
    const isLast = idx === chain.length - 1;
    const next = [];

    for (const root of roots) {
      const nodes = querySelectorAllSafe(root, segment);
      if (!nodes.length) continue;
      if (isLast) {
        next.push(...nodes);
        continue;
      }
      for (const node of nodes) {
        const nestedRoot = node?.shadowRoot || node;
        if (nestedRoot) next.push(nestedRoot);
      }
    }

    if (!next.length) return [];
    roots = [...new Set(next)];
  }

  return roots.filter((node) => node && (node.nodeType === 1 || typeof node.nodeType === "undefined"));
}

function pickClickable(selectors, doc = document) {
  for (const selector of normalizeSelectors(selectors)) {
    const nodes = resolveSelectorNodes(selector, doc);
    if (!nodes.length) continue;

    const enabled = nodes.filter((node) => !isDisabled(node));
    if (!enabled.length) continue;

    return enabled.find((node) => isVisible(node)) || enabled[0];
  }
  return null;
}

function normalizeClassName(node) {
  return String(node?.className || "").trim();
}

function hasNoUiClass(node) {
  const className = normalizeClassName(node);
  return className.includes("noUi-");
}

function isRangeInput(node) {
  if (!node || String(node?.tagName || "").toLowerCase() !== "input") return false;
  return String(node?.type || "").toLowerCase() === "range";
}

function isSliderRole(node) {
  const role = String(node?.getAttribute?.("role") || "")
    .toLowerCase()
    .trim();
  return role === "slider" || role === "progressbar";
}

function nodeRange(node) {
  const minRaw = Number(node?.getAttribute?.("aria-valuemin") ?? node?.min);
  const maxRaw = Number(node?.getAttribute?.("aria-valuemax") ?? node?.max);
  const currentRaw = Number(node?.getAttribute?.("aria-valuenow") ?? node?.value);

  const min = Number.isFinite(minRaw) ? minRaw : 0;
  let max = Number.isFinite(maxRaw) ? maxRaw : Number.NaN;
  if (!Number.isFinite(max) || max <= min) {
    max = Number.isFinite(currentRaw) && currentRaw > 1 ? 100 : 1;
  }

  return { min, max };
}

function resolveSliderOrientation(node, fallback = "") {
  const fallbackOrientation = normalizeOrientation(fallback);
  if (fallbackOrientation) return fallbackOrientation;
  if (!node) return "horizontal";

  const ariaOrientation = normalizeOrientation(node.getAttribute?.("aria-orientation"));
  if (ariaOrientation) return ariaOrientation;

  const dataOrientation = normalizeOrientation(node.getAttribute?.("data-orientation"));
  if (dataOrientation) return dataOrientation;

  const className = normalizeClassName(node).toLowerCase();
  if (className.includes("vertical")) return "vertical";
  if (className.includes("horizontal")) return "horizontal";

  const rect = node.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    if (rect.height > rect.width * 1.2) return "vertical";
  }

  return "horizontal";
}

function resolveVolumeClickPoint(node, ratio, orientation = "") {
  if (!node) return null;
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const clampedRatio = clamp01(ratio);
  const resolvedOrientation = resolveSliderOrientation(node, orientation);
  if (resolvedOrientation === "vertical") {
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom - rect.height * clampedRatio,
      orientation: resolvedOrientation,
    };
  }

  return {
    clientX: rect.left + rect.width * clampedRatio,
    clientY: rect.top + rect.height / 2,
    orientation: resolvedOrientation,
  };
}

function resolveSliderDragBase(node) {
  if (!node) return null;
  const handleRect = node.getBoundingClientRect?.();
  if (!handleRect || handleRect.width <= 0 || handleRect.height <= 0) return null;

  let current = node.parentElement || null;
  let depth = 0;
  while (current && depth < 8) {
    const rect = current.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      const horizontalCandidate =
        rect.width >= handleRect.width * 1.3 &&
        rect.height <= Math.max(handleRect.height * 0.75, 24);
      const verticalCandidate =
        rect.height >= handleRect.height * 1.3 &&
        rect.width <= Math.max(handleRect.width * 0.75, 24);
      if (horizontalCandidate || verticalCandidate) return current;
    }

    current = current.parentElement || null;
    depth += 1;
  }

  return null;
}

function dispatchMouse(target, type, init, doc) {
  const ownerDoc = doc || target?.ownerDocument || document;
  const win = ownerDoc?.defaultView || window;
  target.dispatchEvent(new win.MouseEvent(type, init));
}

function dispatchPointer(target, type, init, doc) {
  const ownerDoc = doc || target?.ownerDocument || document;
  const win = ownerDoc?.defaultView || window;
  if (typeof win.PointerEvent !== "function") return;
  target.dispatchEvent(
    new win.PointerEvent(type, {
      ...init,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    })
  );
}

function pressAtRatio(node, ratio, doc = document, orientation = "", emitClick = false) {
  const point = resolveVolumeClickPoint(node, ratio, orientation);
  if (!point) return false;
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.clientX,
    clientY: point.clientY,
  };

  dispatchPointer(node, "pointerdown", init, doc);
  dispatchMouse(node, "mousedown", { ...init, buttons: 1 }, doc);
  dispatchPointer(node, "pointerup", init, doc);
  dispatchMouse(node, "mouseup", { ...init, buttons: 0 }, doc);
  if (emitClick) {
    dispatchMouse(node, "click", { ...init, buttons: 0 }, doc);
  }
  return true;
}

function clickAtRatio(node, ratio, doc = document, orientation = "") {
  const ok = pressAtRatio(node, ratio, doc, orientation, false);
  if (!ok) return false;
  const point = resolveVolumeClickPoint(node, ratio, orientation);
  if (!point) return false;
  dispatchMouse(
    node,
    "click",
    {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.clientX,
      clientY: point.clientY,
      buttons: 0,
    },
    doc
  );
  return true;
}

function dragHandleToRatio(handle, base, ratio, doc = document, orientation = "") {
  if (!handle || !base) return false;
  const baseRect = base.getBoundingClientRect?.();
  const handleRect = handle.getBoundingClientRect?.();
  if (!baseRect || baseRect.width <= 0 || baseRect.height <= 0) return false;
  if (!handleRect || handleRect.width <= 0 || handleRect.height <= 0) return false;

  const startX = handleRect.left + handleRect.width / 2;
  const startY = handleRect.top + handleRect.height / 2;
  const resolvedOrientation = resolveSliderOrientation(base, orientation);
  const clampedRatio = clamp01(ratio);
  const targetX =
    resolvedOrientation === "vertical" ? baseRect.left + baseRect.width / 2 : baseRect.left + baseRect.width * clampedRatio;
  const targetY =
    resolvedOrientation === "vertical"
      ? baseRect.bottom - baseRect.height * clampedRatio
      : baseRect.top + baseRect.height / 2;
  const start = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: startX,
    clientY: startY,
  };
  const move = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: targetX,
    clientY: targetY,
  };

  dispatchPointer(handle, "pointerdown", start, doc);
  dispatchMouse(handle, "mousedown", { ...start, buttons: 1 }, doc);
  dispatchPointer(doc, "pointermove", move, doc);
  dispatchMouse(doc, "mousemove", { ...move, buttons: 1 }, doc);
  dispatchPointer(doc, "pointerup", move, doc);
  dispatchMouse(doc, "mouseup", { ...move, buttons: 0 }, doc);
  return true;
}

function setRangeInputValue(node, ratio) {
  if (!isRangeInput(node)) return false;
  const { min, max } = nodeRange(node);
  const nextValue = min + (max - min) * clamp01(ratio);
  if (!Number.isFinite(nextValue)) return false;

  try {
    node.value = String(nextValue);
  } catch (_) {
    return false;
  }

  const ownerDoc = node.ownerDocument || document;
  const win = ownerDoc?.defaultView || window;
  node.dispatchEvent(new win.Event("input", { bubbles: true, composed: true }));
  node.dispatchEvent(new win.Event("change", { bubbles: true, composed: true }));
  return true;
}

function readSliderRatio(node) {
  if (!node) return Number.NaN;
  const { min, max } = nodeRange(node);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return Number.NaN;

  const currentRaw = Number(node?.getAttribute?.("aria-valuenow") ?? node?.value);
  if (!Number.isFinite(currentRaw)) return Number.NaN;
  return clamp01((currentRaw - min) / (max - min));
}

function isSliderAdjustmentEffective(beforeRatio, afterRatio, targetRatio) {
  const target = clamp01(targetRatio);
  const before = Number.isFinite(beforeRatio) ? clamp01(beforeRatio) : Number.NaN;
  const after = Number.isFinite(afterRatio) ? clamp01(afterRatio) : Number.NaN;

  if (!Number.isFinite(before) && !Number.isFinite(after)) return false;
  if (Number.isFinite(after) && Math.abs(after - target) <= 0.08) return true;
  if (Number.isFinite(before) && Math.abs(before - target) <= 0.02) return true;
  if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) >= 0.01) return true;
  return false;
}

function resolveVolumeTargetNode(node) {
  if (!node) return null;

  if (isRangeInput(node) || isSliderRole(node) || hasNoUiClass(node)) return node;

  const descendants = qAll(
    'input[type="range"], [role="slider"], [role="progressbar"], .noUi-handle, .noUi-origin, .noUi-base, .noUi-target',
    node
  );
  if (descendants.length) {
    return descendants.find((item) => isVisible(item)) || descendants[0];
  }

  return node.closest?.(".noUi-target, .noUi-handle, .noUi-origin, .noUi-base") || node;
}

function setNoUiValue(target, ratio, doc = document) {
  if (!target) return false;
  const root =
    (String(target?.className || "").includes("noUi-target")
      ? target
      : target.closest?.(".noUi-target")) || null;
  if (!root) return false;

  const base = root.querySelector?.(".noUi-base") || root;
  const handle =
    (String(target?.className || "").includes("noUi-handle")
      ? target
      : root.querySelector?.(".noUi-handle-lower, .noUi-handle")) || null;

  const orientation = resolveSliderOrientation(root);
  if (handle && dragHandleToRatio(handle, base, ratio, doc, orientation)) return true;
  return clickAtRatio(base, ratio, doc, orientation);
}

function setSliderLikeValue(node, ratio, doc = document, mode = "auto") {
  const target = resolveVolumeTargetNode(node);
  if (!target) return false;
  const normalizedMode = normalizeVolumeControlMode(mode);
  const orientation = resolveSliderOrientation(target);

  if (normalizedMode === "range") {
    return setRangeInputValue(target, ratio);
  }

  if (normalizedMode === "noui") {
    return setNoUiValue(target, ratio, doc);
  }

  if (isSliderRole(target)) {
    const dragBase = resolveSliderDragBase(target);
    const base = dragBase || target;
    const baseOrientation = resolveSliderOrientation(base, orientation);
    const beforeRatio = readSliderRatio(target);

    if (normalizedMode === "click") {
      if (clickAtRatio(base, ratio, doc, baseOrientation)) return true;
      if (base !== target) return clickAtRatio(target, ratio, doc, orientation);
      return false;
    }

    if (normalizedMode === "press") {
      if (pressAtRatio(base, ratio, doc, baseOrientation, false)) return true;
      if (base !== target) return pressAtRatio(target, ratio, doc, orientation, false);
      return false;
    }

    if (normalizedMode === "drag") {
      if (!dragBase) return false;
      return dragHandleToRatio(target, dragBase, ratio, doc, baseOrientation);
    }

    if (pressAtRatio(base, ratio, doc, baseOrientation, false)) {
      const afterBasePressRatio = readSliderRatio(target);
      if (isSliderAdjustmentEffective(beforeRatio, afterBasePressRatio, ratio)) return true;
    }

    if (clickAtRatio(base, ratio, doc, baseOrientation)) {
      const afterBaseClickRatio = readSliderRatio(target);
      if (isSliderAdjustmentEffective(beforeRatio, afterBaseClickRatio, ratio)) return true;
    }

    if (base !== target && pressAtRatio(target, ratio, doc, orientation, false)) {
      const afterTargetPressRatio = readSliderRatio(target);
      if (isSliderAdjustmentEffective(beforeRatio, afterTargetPressRatio, ratio)) return true;
    }

    if (base !== target && clickAtRatio(target, ratio, doc, orientation)) {
      const afterTargetClickRatio = readSliderRatio(target);
      if (isSliderAdjustmentEffective(beforeRatio, afterTargetClickRatio, ratio)) return true;
    }

    if (dragBase && dragHandleToRatio(target, dragBase, ratio, doc, baseOrientation)) {
      const afterDragRatio = readSliderRatio(target);
      if (isSliderAdjustmentEffective(beforeRatio, afterDragRatio, ratio)) return true;
    }
  } else if (normalizedMode === "click" || normalizedMode === "auto") {
    if (clickAtRatio(target, ratio, doc, orientation)) return true;
  } else if (normalizedMode === "press") {
    if (pressAtRatio(target, ratio, doc, orientation, false)) return true;
  } else if (normalizedMode === "drag") {
    return false;
  }

  if (normalizedMode !== "auto") {
    return false;
  }

  if (hasNoUiClass(target) || target.closest?.(".noUi-target")) {
    if (setNoUiValue(target, ratio, doc)) return true;
  }

  if (setRangeInputValue(target, ratio)) return true;

  if (isSliderRole(target)) return clickAtRatio(target, ratio, doc, orientation);
  if (hasNoUiClass(target)) return clickAtRatio(target, ratio, doc, orientation);

  return false;
}

function clickNode(node) {
  if (!node) return false;
  const rect = node.getBoundingClientRect?.();
  const hasRect = rect && rect.width > 0 && rect.height > 0;
  const clientX = hasRect ? rect.left + rect.width / 2 : 0;
  const clientY = hasRect ? rect.top + rect.height / 2 : 0;
  const init = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

  if (typeof PointerEvent !== "undefined") {
    node.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...init,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      })
    );
  }

  node.dispatchEvent(new MouseEvent("mousedown", { ...init, button: 0, buttons: 1 }));
  node.dispatchEvent(new MouseEvent("mouseup", { ...init, button: 0, buttons: 0 }));
  node.dispatchEvent(new MouseEvent("click", { ...init, button: 0, buttons: 0 }));
  return true;
}

export function clickBySelectors(selectors, doc = document) {
  return clickNode(pickClickable(selectors, doc));
}

export function executeSelectorControl(action, selectors, value, doc = document, mode = "") {
  const target = pickClickable(selectors, doc);
  if (!target) {
    return { ok: false, message: "selector control not found" };
  }

  const normalizedAction = String(action || "").trim().toLowerCase();
  if (normalizedAction === "volume") {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return { ok: false, message: "invalid volume value" };
    const normalizedMode = normalizeVolumeControlMode(mode);
    const ok = setSliderLikeValue(target, ratio, doc, normalizedMode);
    if (!ok) return { ok: false, message: "selector volume control unavailable" };
    return {
      ok: true,
      path:
        normalizedMode === "auto"
          ? "wrapper-selector-volume"
          : `wrapper-selector-volume:${normalizedMode}`,
    };
  }

  const ok = clickNode(target);
  if (!ok) return { ok: false, message: "selector control not found" };
  return { ok: true, path: "wrapper-selector-click" };
}

export const __selectorControlInternals = {
  splitShadowSelector,
  resolveSelectorNodes,
  resolveVolumeTargetNode,
  resolveSliderDragBase,
  resolveSliderOrientation,
  resolveVolumeClickPoint,
  readSliderRatio,
  isSliderAdjustmentEffective,
  normalizeVolumeControlMode,
};
