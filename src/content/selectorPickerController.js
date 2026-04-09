const PICKER_STYLE_ID = "__np_selector_picker_style";
const PICKER_TOOLTIP_ID = "__np_selector_picker_tooltip";
const PICKER_HIGHLIGHT_CLASS = "__np_selector_picker_highlight";
const PICKER_INTERNAL_CLASS_PREFIX = "__np_selector_picker_";
const PICKER_STACK_MIN_LEVEL = 1;
const PICKER_STACK_MAX_LEVEL = 9;
const PICKER_SHADOW_SEPARATOR = " >>> ";

function escapeSelector(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(raw);
  return raw.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function isUniqueSelector(selector, doc) {
  const normalized = String(selector || "").trim();
  if (!normalized) return false;
  try {
    return doc.querySelectorAll(normalized).length === 1;
  } catch (_) {
    return false;
  }
}

function classWeight(name) {
  const value = String(name || "").trim();
  if (!value) return -1000;

  let score = value.length;
  if (/-/.test(value)) score += 8;
  if (/[a-z]-[a-z]/.test(value)) score += 2;
  if (/^(se-button|se-icon-button|md-dark-theme|layout-row|flex)$/.test(value)) score -= 24;
  if (/^(md-|ng-)/.test(value)) score -= 10;
  return score;
}

function isPickerInternalClass(name) {
  const value = String(name || "").trim();
  if (!value) return false;
  return value === PICKER_HIGHLIGHT_CLASS || value.startsWith(PICKER_INTERNAL_CLASS_PREFIX);
}

function isPickerInternalElement(element) {
  if (!(element instanceof Element)) return false;
  const elementId = String(element.id || "").trim();
  if (elementId === PICKER_STYLE_ID || elementId === PICKER_TOOLTIP_ID) return true;
  return [...(element.classList || [])].some((name) => isPickerInternalClass(name));
}

function isShadowRootNode(node) {
  if (!node) return false;
  if (typeof ShadowRoot === "function") return node instanceof ShadowRoot;
  return String(node?.toString?.() || "") === "[object ShadowRoot]";
}

function normalizePickerStackLevel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PICKER_STACK_MIN_LEVEL;
  return Math.max(PICKER_STACK_MIN_LEVEL, Math.min(PICKER_STACK_MAX_LEVEL, Math.round(parsed)));
}

function resolveStackLevelFromKeyEvent(event) {
  const key = String(event?.key || "").trim();
  if (/^[1-9]$/.test(key)) return Number(key);

  const code = String(event?.code || "").trim();
  const match = code.match(/^(?:Digit|Numpad)([1-9])$/);
  if (match) return Number(match[1]);
  return 0;
}

function elementsFromPointSafe(root, x, y) {
  if (root && typeof root.elementsFromPoint === "function") {
    try {
      return [...(root.elementsFromPoint(x, y) || [])];
    } catch (_) {
      return [];
    }
  }
  if (root && typeof root.elementFromPoint === "function") {
    try {
      const node = root.elementFromPoint(x, y);
      return node ? [node] : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function resolveElementStackDeep(root, x, y, state = null) {
  const localState =
    state ||
    ({
      seenRoots: new Set(),
      maxDepth: 8,
    });
  if (!root || localState.seenRoots.has(root)) return [];
  localState.seenRoots.add(root);

  const direct = elementsFromPointSafe(root, x, y);
  if (!direct.length) return [];
  const out = [];

  for (const node of direct) {
    if (!(node instanceof Element)) continue;
    const shadowRoot = node.shadowRoot || null;
    if (shadowRoot && localState.maxDepth > 0) {
      const nestedState = {
        ...localState,
        maxDepth: localState.maxDepth - 1,
      };
      const nested = resolveElementStackDeep(shadowRoot, x, y, nestedState);
      if (nested.length) out.push(...nested);
    }
    out.push(node);
  }

  const unique = [];
  const seenNodes = new Set();
  for (const node of out) {
    if (seenNodes.has(node)) continue;
    seenNodes.add(node);
    unique.push(node);
  }
  return unique;
}

function resolveElementFromStack(doc, x, y, level = PICKER_STACK_MIN_LEVEL) {
  const resolvedLevel = normalizePickerStackLevel(level);
  const stackRaw = resolveElementStackDeep(doc, x, y);
  const stack = [...(stackRaw || [])].filter((node) => node instanceof Element && !isPickerInternalElement(node));
  if (!stack.length) return null;
  const index = Math.min(stack.length - 1, resolvedLevel - 1);
  return {
    element: stack[index],
    level: index + 1,
    total: stack.length,
  };
}

function selectorClassesOf(element) {
  if (!(element instanceof Element)) return [];
  return [
    ...new Set(
      [...(element.classList || [])]
        .map((name) => String(name || "").trim())
        .filter((name) => Boolean(name) && !isPickerInternalClass(name))
    ),
  ]
    .sort((a, b) => classWeight(b) - classWeight(a));
}

function buildClassSelector(element, doc, maxClasses = 3) {
  const classes = selectorClassesOf(element);
  const tag = String(element?.tagName || "").toLowerCase();
  if (!tag || !classes.length) return "";

  const cap = Math.min(maxClasses, classes.length);
  for (let count = 1; count <= cap; count += 1) {
    const selector = `${tag}.${classes.slice(0, count).map((name) => escapeSelector(name)).join(".")}`;
    if (isUniqueSelector(selector, doc)) return selector;
  }

  return `${tag}.${classes.slice(0, cap).map((name) => escapeSelector(name)).join(".")}`;
}

function buildSelectorWithinRoot(element, doc) {
  if (!(element instanceof Element)) return "";

  const elementId = String(element.id || "").trim();
  if (elementId) {
    const selector = `#${escapeSelector(elementId)}`;
    if (isUniqueSelector(selector, doc)) return selector;
  }

  const dataTestId = String(element.getAttribute("data-testid") || "").trim();
  if (dataTestId) {
    const selector = `[data-testid="${dataTestId.replace(/"/g, '\\"')}"]`;
    if (isUniqueSelector(selector, doc)) return selector;
  }

  const classSelector = buildClassSelector(element, doc, 3);
  if (classSelector) {
    if (isUniqueSelector(classSelector, doc)) return classSelector;
  }

  const path = [];
  let node = element;
  let depth = 0;
  while (node && node instanceof Element && depth < 6) {
    const parent = node.parentElement;
    let segment = node.tagName.toLowerCase();
    const nodeId = String(node.id || "").trim();
    if (nodeId) {
      segment = `#${escapeSelector(nodeId)}`;
      path.unshift(segment);
      const joined = path.join(" > ");
      if (isUniqueSelector(joined, doc)) return joined;
      break;
    }

    const nodeClasses = selectorClassesOf(node).slice(0, 3);
    if (nodeClasses.length) {
      segment += `.${nodeClasses.map((name) => escapeSelector(name)).join(".")}`;
    } else {
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter(
            (child) => child.tagName.toLowerCase() === node.tagName.toLowerCase()
          )
        : [];
      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1;
        segment += `:nth-of-type(${index})`;
      }
    }

    path.unshift(segment);
    let joined = path.join(" > ");
    if (isUniqueSelector(joined, doc)) return joined;

    // Classes alone are often shared by previous/next controls; pin exact sibling position.
    if (parent) {
      const siblingsByTag = [...parent.children].filter(
        (child) => child.tagName.toLowerCase() === node.tagName.toLowerCase()
      );
      if (siblingsByTag.length > 1) {
        const index = siblingsByTag.indexOf(node) + 1;
        if (index > 0) {
          path[0] = `${segment}:nth-of-type(${index})`;
          joined = path.join(" > ");
          if (isUniqueSelector(joined, doc)) return joined;
        }
      }
    }

    node = parent;
    depth += 1;
  }

  return path.join(" > ");
}

function buildBestSelector(element, doc) {
  if (!(element instanceof Element)) return "";

  const rootNode = element.getRootNode?.() || doc;
  if (isShadowRootNode(rootNode)) {
    const inner = buildSelectorWithinRoot(element, rootNode);
    const host = rootNode.host instanceof Element ? rootNode.host : null;
    const hostSelector = host ? buildBestSelector(host, doc) : "";
    if (hostSelector && inner) return `${hostSelector}${PICKER_SHADOW_SEPARATOR}${inner}`;
    return inner || hostSelector;
  }

  return buildSelectorWithinRoot(element, doc);
}

function describeClasses(element) {
  if (!(element instanceof Element)) return "";
  const classes = [...(element.classList || [])]
    .map((name) => String(name || "").trim())
    .filter((name) => Boolean(name) && !isPickerInternalClass(name))
    .slice(0, 4);
  return classes.map((name) => `.${name}`).join("");
}

function ensurePickerStyles(doc) {
  if (doc.getElementById(PICKER_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = PICKER_STYLE_ID;
  style.textContent = `
    .${PICKER_HIGHLIGHT_CLASS} {
      outline: 2px solid #00d4ff !important;
      outline-offset: 1px !important;
      cursor: crosshair !important;
    }
    #${PICKER_TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      max-width: min(620px, calc(100vw - 20px));
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(10, 14, 24, 0.92);
      color: #c7f7ff;
      font: 12px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(0, 212, 255, 0.35);
      display: none;
    }
  `;
  doc.documentElement.appendChild(style);
}

function getTooltip(doc) {
  let tooltip = doc.getElementById(PICKER_TOOLTIP_ID);
  if (tooltip) return tooltip;
  tooltip = doc.createElement("div");
  tooltip.id = PICKER_TOOLTIP_ID;
  doc.documentElement.appendChild(tooltip);
  return tooltip;
}

export function createSelectorPickerController({
  windowRef = window,
  documentRef = document,
  emitResult,
} = {}) {
  const state = {
    active: false,
    requestId: "",
    hovered: null,
    teardown: null,
    onResult: null,
    emitBackground: true,
  };

  const setHovered = (element) => {
    if (state.hovered === element) return;
    if (state.hovered?.classList) state.hovered.classList.remove(PICKER_HIGHLIGHT_CLASS);
    state.hovered = element instanceof Element ? element : null;
    if (state.hovered?.classList) state.hovered.classList.add(PICKER_HIGHLIGHT_CLASS);
  };

  const destroy = () => {
    if (typeof state.teardown === "function") state.teardown();
    state.teardown = null;
    state.active = false;
    state.requestId = "";
    state.onResult = null;
    state.emitBackground = true;
    setHovered(null);
  };

  const safeEmitBackground = (payload) => {
    if (typeof emitResult !== "function") return;
    try {
      emitResult(payload);
    } catch (_) {
      // no-op
    }
  };

  const emitPickerResult = (payload) => {
    if (typeof state.onResult === "function") {
      try {
        state.onResult(payload);
      } catch (_) {
        // no-op
      }
    }
    if (state.emitBackground !== false) {
      safeEmitBackground(payload);
    }
  };

  const cancel = (requestId = "") => {
    if (!state.active) return { ok: true };
    const requestedId = String(requestId || "").trim();
    const activeId = String(state.requestId || "").trim();
    if (requestedId && activeId && requestedId !== activeId) {
      return { ok: false, message: "picker request mismatch" };
    }
    emitPickerResult({
      requestId: activeId,
      ok: false,
      selector: "",
      message: "canceled",
    });
    destroy();
    return { ok: true };
  };

  const start = (requestId, options = {}) => {
    if (windowRef.top !== windowRef) {
      return { ok: false, message: "picker available only in top frame" };
    }

    const requestOptions = options && typeof options === "object" ? options : {};

    destroy();
    ensurePickerStyles(documentRef);
    state.onResult = typeof requestOptions.onResult === "function" ? requestOptions.onResult : null;
    state.emitBackground = requestOptions.emitBackground !== false;

    const tooltip = getTooltip(documentRef);
    tooltip.style.display = "block";
    tooltip.textContent = "Выберите элемент… [1-9 слой, Esc отмена]";
    let selectionDone = false;
    let stackLevel = PICKER_STACK_MIN_LEVEL;
    let lastPointer = null;

    const updateTooltipPosition = (event) => {
      const x = Number(event?.clientX) || 0;
      const y = Number(event?.clientY) || 0;
      const margin = 14;
      const maxX = Math.max(margin, windowRef.innerWidth - tooltip.offsetWidth - margin);
      const maxY = Math.max(margin, windowRef.innerHeight - tooltip.offsetHeight - margin);
      tooltip.style.left = `${Math.min(maxX, x + 16)}px`;
      tooltip.style.top = `${Math.min(maxY, y + 16)}px`;
    };

    const blockEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };

    const onPointerMove = (event) => {
      const pointerX = Number(event?.clientX) || 0;
      const pointerY = Number(event?.clientY) || 0;
      lastPointer = { x: pointerX, y: pointerY };
      const resolved = resolveElementFromStack(documentRef, pointerX, pointerY, stackLevel);
      const target = resolved?.element || null;
      if (!(target instanceof Element)) return;
      setHovered(target);
      const selector = buildBestSelector(target, documentRef) || "(selector unavailable)";
      const classes = describeClasses(target);
      const stackMeta = resolved ? ` [${resolved.level}/${resolved.total}]` : "";
      tooltip.textContent = `${classes ? `${selector} [${classes}]` : selector}${stackMeta}`;
      updateTooltipPosition(event);
    };

    const onSelect = (event) => {
      blockEvent(event);
      if (typeof event.button === "number" && event.button !== 0) return;
      if (selectionDone) return;
      selectionDone = true;
      const pointerX = Number(event?.clientX) || 0;
      const pointerY = Number(event?.clientY) || 0;
      const target =
        resolveElementFromStack(documentRef, pointerX, pointerY, stackLevel)?.element || event.target;
      if (!(target instanceof Element)) {
        emitPickerResult({
          requestId,
          ok: false,
          selector: "",
          message: "selector unavailable",
        });
        windowRef.setTimeout(() => destroy(), 0);
        return;
      }
      const selector = buildBestSelector(target, documentRef);
      emitPickerResult({
        requestId,
        ok: Boolean(selector),
        selector,
        message: selector ? "" : "selector unavailable",
      });
      // Keep blockers active for current click cycle to avoid triggering page controls.
      windowRef.setTimeout(() => destroy(), 0);
    };

    const onClickBlock = (event) => {
      blockEvent(event);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        blockEvent(event);
        emitPickerResult({
          requestId,
          ok: false,
          selector: "",
          message: "canceled",
        });
        destroy();
        return;
      }

      const requestedLevel = resolveStackLevelFromKeyEvent(event);
      if (!requestedLevel) return;
      blockEvent(event);
      stackLevel = normalizePickerStackLevel(requestedLevel);
      if (!lastPointer) {
        tooltip.textContent = `Выберите элемент… [слой ${stackLevel}/9, Esc отмена]`;
        return;
      }

      const resolved = resolveElementFromStack(documentRef, lastPointer.x, lastPointer.y, stackLevel);
      const target = resolved?.element || null;
      setHovered(target);
      if (!(target instanceof Element)) {
        tooltip.textContent = `Выберите элемент… [слой ${stackLevel}/9, Esc отмена]`;
        return;
      }
      const selector = buildBestSelector(target, documentRef) || "(selector unavailable)";
      const classes = describeClasses(target);
      const stackMeta = resolved ? ` [${resolved.level}/${resolved.total}]` : "";
      tooltip.textContent = `${classes ? `${selector} [${classes}]` : selector}${stackMeta}`;
    };

    const onBlur = () => {
      emitPickerResult({
        requestId,
        ok: false,
        selector: "",
        message: "canceled",
      });
      destroy();
    };

    documentRef.addEventListener("pointermove", onPointerMove, true);
    documentRef.addEventListener("pointerdown", onClickBlock, true);
    documentRef.addEventListener("pointerup", onSelect, true);
    documentRef.addEventListener("mousedown", onClickBlock, true);
    documentRef.addEventListener("mouseup", onClickBlock, true);
    documentRef.addEventListener("click", onClickBlock, true);
    documentRef.addEventListener("contextmenu", onClickBlock, true);
    documentRef.addEventListener("keydown", onKeyDown, true);
    windowRef.addEventListener("blur", onBlur, true);

    state.active = true;
    state.requestId = String(requestId || "");
    state.teardown = () => {
      documentRef.removeEventListener("pointermove", onPointerMove, true);
      documentRef.removeEventListener("pointerdown", onClickBlock, true);
      documentRef.removeEventListener("pointerup", onSelect, true);
      documentRef.removeEventListener("mousedown", onClickBlock, true);
      documentRef.removeEventListener("mouseup", onClickBlock, true);
      documentRef.removeEventListener("click", onClickBlock, true);
      documentRef.removeEventListener("contextmenu", onClickBlock, true);
      documentRef.removeEventListener("keydown", onKeyDown, true);
      windowRef.removeEventListener("blur", onBlur, true);
      tooltip.style.display = "none";
      tooltip.textContent = "";
    };

    return { ok: true };
  };

  return {
    start,
    cancel,
    destroy,
  };
}

export const __selectorPickerInternals = {
  normalizePickerStackLevel,
  resolveStackLevelFromKeyEvent,
  resolveElementStackDeep,
  resolveElementFromStack,
};
