// Portable formatting data. Projects never contain executable HTML.
export const FONTS = [
  "Arial",
  "Century Gothic",
  "Roboto",
  "Helvetica",
  "Calibri",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Times New Roman",
];
export const FONT_STACKS = {
  "Century Gothic": '"Century Gothic", "Apple Gothic", Arial, sans-serif',
  Roboto: "Roboto, Arial, sans-serif",
  Helvetica: "Helvetica, Arial, sans-serif",
  Calibri: 'Calibri, "Segoe UI", Arial, sans-serif',
  Georgia: "Georgia, serif",
  "Times New Roman": '"Times New Roman", Times, serif',
};
export const fontStack = (font) =>
  FONT_STACKS[font] || `"${FONTS.includes(font) ? font : "Arial"}", sans-serif`;
export const validColour = (value, fallback = "#203c44") =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback;
export function cleanFormat(value = {}) {
  const out = {};
  if (FONTS.includes(value.fontFamily)) out.fontFamily = value.fontFamily;
  if (
    Number.isFinite(Number(value.fontSize)) &&
    value.fontSize !== null &&
    value.fontSize !== ""
  )
    out.fontSize = Math.max(8, Math.min(128, Number(value.fontSize)));
  if (/^#[0-9a-f]{6}$/i.test(value.color || ""))
    out.color = value.color.toLowerCase();
  for (const key of ["bold", "italic", "underline"])
    if (typeof value[key] === "boolean") out[key] = value[key];
  return out;
}
export function normaliseRuns(text, input) {
  text = String(text ?? "").slice(0, 100000);
  if (
    !Array.isArray(input) ||
    input.length > 10000 ||
    input.map((r) => String(r?.text ?? "")).join("") !== text
  )
    return text ? [{ text }] : [];
  return mergeRuns(
    input.map((r) => ({ text: String(r.text), ...cleanFormat(r) })),
  );
}
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const style = cleanFormat(r),
      last = out.at(-1);
    if (last && JSON.stringify(cleanFormat(last)) === JSON.stringify(style))
      last.text += r.text;
    else out.push({ text: r.text, ...style });
  }
  return out;
}
export function sliceRuns(runs, start, end = Infinity) {
  let offset = 0;
  return mergeRuns(
    runs.flatMap((r) => {
      const a = Math.max(0, start - offset),
        z = Math.min(r.text.length, end - offset);
      offset += r.text.length;
      return z > a ? [{ ...r, text: r.text.slice(a, z) }] : [];
    }),
  );
}
export function formatRuns(runs, start, end, format) {
  const middle = sliceRuns(runs, start, end).map((r) => ({
    ...r,
    ...cleanFormat(format),
  }));
  return mergeRuns([
    ...sliceRuns(runs, 0, start),
    ...middle,
    ...sliceRuns(runs, end),
  ]);
}
export function replaceRuns(runs, start, end, insertion) {
  return mergeRuns([
    ...sliceRuns(runs, 0, start),
    ...insertion,
    ...sliceRuns(runs, end),
  ]);
}
export function formatAt(runs, position, base = {}) {
  let offset = 0;
  for (const run of runs) {
    offset += run.text.length;
    if (position <= offset)
      return { ...cleanFormat(base), ...cleanFormat(run) };
  }
  return cleanFormat(base);
}
export function updateTextRuns(oldText, newText, runs, base = {}) {
  oldText = String(oldText || "");
  newText = String(newText || "");
  runs = normaliseRuns(oldText, runs);
  let start = 0,
    suffix = 0;
  while (
    start < Math.min(oldText.length, newText.length) &&
    oldText[start] === newText[start]
  )
    start++;
  while (
    suffix < Math.min(oldText.length - start, newText.length - start) &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  )
    suffix++;
  const text = newText.slice(start, newText.length - suffix);
  return replaceRuns(
    runs,
    start,
    oldText.length - suffix,
    text ? [{ text, ...formatAt(runs, start, base) }] : [],
  );
}
export function resizeCells(cells = [], rows = 3, cols = 3) {
  rows = Math.max(1, Math.min(50, Math.round(rows) || 3));
  cols = Math.max(1, Math.min(12, Math.round(cols) || 3));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const old = cells[r]?.[c] || {},
        text = String(old.text ?? "").slice(0, 10000);
      return {
        text,
        runs: normaliseRuns(text, old.runs),
        ...cleanFormat(old),
        lineSpacing: Number.isFinite(Number(old.lineSpacing))
          ? Math.max(0.8, Math.min(4, Number(old.lineSpacing)))
          : 1.6,
        align: ["left", "center", "right", "justify"].includes(old.align)
          ? old.align
          : "left",
        ...(old.fill ? { fill: validColour(old.fill, "#ffffff") } : {}),
      };
    }),
  );
}
export const SHORTCUT_ACTIONS = {
  text: "Insert text box",
  image: "Insert image",
  table: "Insert table",
  rectangle: "Insert rectangle",
  rounded: "Insert rounded rectangle",
  circle: "Insert circle",
  ellipse: "Insert ellipse",
  line: "Insert line",
  habit: "Insert Math Habit",
  answer: "Insert answer",
  questionPart: "Insert question part",
  answerPart: "Insert answer part",
};
export const DEFAULT_SHORTCUTS = {
  text: "Mod+Alt+X",
  image: "Mod+Alt+I",
  table: "Mod+Alt+T",
  rectangle: "",
  rounded: "Mod+Alt+R",
  circle: "Mod+Alt+C",
  ellipse: "",
  line: "Mod+Alt+L",
  habit: "Mod+Alt+H",
  answer: "Mod+Alt+A",
  questionPart: "",
  answerPart: "",
};
const RESERVED = new Set([
  "Mod+A",
  "Mod+B",
  "Mod+C",
  "Mod+D",
  "Mod+E",
  "Mod+F",
  "Mod+H",
  "Mod+I",
  "Mod+J",
  "Mod+K",
  "Mod+L",
  "Mod+N",
  "Mod+O",
  "Mod+P",
  "Mod+Q",
  "Mod+R",
  "Mod+S",
  "Mod+T",
  "Mod+U",
  "Mod+V",
  "Mod+W",
  "Mod+X",
  "Mod+Y",
  "Mod+Z",
  "Mod+Shift+C",
  "Mod+Shift+V",
  "Mod+Shift+Z",
  "Mod+Shift+T",
  "Mod+Shift+N",
  "Mod+Shift+W",
  "Mod+Alt+Delete",
]);
export function canonicalShortcut(value) {
  if (!value) return "";
  const tokens = String(value)
    .split("+")
    .map((s) => s.trim());
  const key = tokens.pop();
  if (!/^[a-z0-9]$/i.test(key || "") && !/^F(?:[1-9]|1[0-2])$/.test(key || ""))
    return null;
  if (
    tokens.some((t) => !["Mod", "Alt", "Shift"].includes(t)) ||
    new Set(tokens).size !== tokens.length
  )
    return null;
  if (!tokens.includes("Mod") && !tokens.includes("Alt") && !/^F\d+$/.test(key))
    return null;
  return [
    ...["Mod", "Alt", "Shift"].filter((t) => tokens.includes(t)),
    key.toUpperCase(),
  ].join("+");
}
export function shortcutFromEvent(e) {
  const key = /^Key[A-Z]$/.test(e.code || "")
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code || "")
      ? e.code.slice(5)
      : e.key.length === 1
        ? e.key.toUpperCase()
        : e.key;
  return canonicalShortcut(
    [
      ...(e.ctrlKey || e.metaKey ? ["Mod"] : []),
      ...(e.altKey ? ["Alt"] : []),
      ...(e.shiftKey ? ["Shift"] : []),
      key,
    ].join("+"),
  );
}
export function shortcutError(bindings) {
  const seen = new Set();
  for (const action of Object.keys(SHORTCUT_ACTIONS)) {
    const value = bindings[action];
    if (!value) continue;
    const canonical = canonicalShortcut(value);
    if (!canonical)
      return "Use Ctrl/⌘ or Alt with a letter or number, or a function key.";
    if (
      RESERVED.has(canonical) ||
      /^F(?:1|5|6|11|12)$/.test(canonical) ||
      canonical === "Alt+F4"
    )
      return `${canonical.replace("Mod", "Ctrl/⌘")} is reserved for editing or your browser.`;
    if (seen.has(canonical))
      return "Each shortcut must be assigned to only one action.";
    seen.add(canonical);
  }
  return "";
}
export function cleanShortcuts(input) {
  const bindings = { ...DEFAULT_SHORTCUTS };
  if (!input || typeof input !== "object") return bindings;
  for (const key of Object.keys(bindings))
    if (typeof input[key] === "string")
      bindings[key] = canonicalShortcut(input[key]) ?? bindings[key];
  return shortcutError(bindings) ? { ...DEFAULT_SHORTCUTS } : bindings;
}
