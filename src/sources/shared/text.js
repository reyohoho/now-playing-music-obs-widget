export function stripCommonPrefix(text) {
  return String(text || "").replace(/^[^:]+:\s*/, "").trim();
}

export function stripYouTubeSuffix(text) {
  return String(text || "")
    .replace(/\s+-\s+YouTube(?:\s+Music)?$/i, "")
    .trim();
}

export function collapseSpaces(text) {
  return String(text || "")
    .replace(/[\u00A0\u202F\u2007]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
