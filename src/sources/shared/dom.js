export function textOf(node) {
  return (node?.innerText || node?.textContent || "").trim();
}

export function attrOf(node, attr) {
  return (node?.getAttribute?.(attr) || "").trim();
}

export function q(selector, root = document) {
  return root.querySelector(selector);
}

export function qAll(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function isVisible(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const style = window.getComputedStyle(node);
  if (!style) return true;
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isUsableCoverUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return false;
  if (/^data:image\/gif\b/i.test(url)) return false;
  if (/^data:/i.test(url)) return false;
  return true;
}

export function firstNonEmptySrc(nodes) {
  for (const node of nodes || []) {
    if (!node) continue;

    const currentSrc = String(node.currentSrc || "").trim();
    if (isUsableCoverUrl(currentSrc)) return currentSrc;

    const src = String(node.getAttribute?.("src") || "").trim();
    if (isUsableCoverUrl(src)) return src;

    const style = String(node.getAttribute?.("style") || "");
    const match = style.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
    if (isUsableCoverUrl(match?.[2])) return String(match[2]).trim();
  }

  return "";
}
