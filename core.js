import {
  cleanFormat,
  normaliseRuns,
  validColour,
  resizeCells,
  cleanShortcuts,
  DEFAULT_SHORTCUTS,
} from "./formatting.js";
export const PX_PER_MM = 96 / 25.4;
export const PAGE_W = 210 * PX_PER_MM;
export const PAGE_H = 297 * PX_PER_MM;
export const CONTENT_W = 186 * PX_PER_MM;
export const CONTENT_H = 273 * PX_PER_MM - 37 - 16 * PX_PER_MM;
export const CONTENT_X = 12 * PX_PER_MM;
export const CONTENT_Y = CONTENT_X + 37;
export const uid = () => "b_" + crypto.randomUUID();
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export const clone = (value) => structuredClone(value);
export function blankProject() {
  return {
    version: 1,
    id: uid(),
    title: "PSLE Mathematics",
    level: "Primary 6",
    subject: "Mathematics",
    firstPage: 1,
    fontSize: 16,
    snap: true,
    stackFractions: true,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    aiGuidance: "",
    pages: [{ id: uid(), blocks: [] }],
  };
}
export function makeBlock(type, fields = {}) {
  const defaults = {
    text: { text: "", style: "body", align: "left", part: "" },
    habit: { number: "01", title: "Look for a pattern", lineSpacing: 1.35 },
    image: {
      src: "",
      originalSrc: "",
      name: "Image",
      naturalWidth: 0,
      naturalHeight: 0,
      w: 300,
      x: 0,
      y: 0,
      floating: true,
      caption: "",
    },
    working: { height: 180, ruled: false, label: "SHOW YOUR WORKING" },
    answer: {
      text: "Answer",
      value: "",
      part: "",
      showLine: true,
      align: "left",
    },
    shape: {
      kind: "rounded",
      fill: "#edf6f6",
      stroke: "#239ba5",
      strokeWidth: 2,
      radius: 16,
      w: 240,
      height: 100,
      x: 40,
      y: 80,
      floating: true,
    },
    table: {
      rows: 3,
      cols: 3,
      cells: resizeCells([], 3, 3),
      headerRow: true,
      borderColor: "#8ba4ac",
      borderWidth: 1,
      rowHeight: 36,
      cellPadding: 8,
      w: CONTENT_W,
      align: "left",
    },
    divider: {},
  };
  return { id: uid(), type, ...defaults[type], ...fields };
}
// Repeated elements keep one source, including its original image bytes.
// They appear from the source's manual page onward; ordinary blocks remain
// independently editable on the page that owns them.
export function repeatSources(project, pageId) {
  const repeated = new Map();
  for (const page of project.pages) {
    for (const b of page.blocks) if (b.repeatOnPages) repeated.set(b.id, b);
    if (page.id === pageId) return [...repeated.values()];
  }
  return [];
}
export function pageBlocks(project, pageId) {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return [];
  const hidden = new Set(
      (page.repeatSuppressed || [])
        .filter((r) => r.sheetIndex === 0)
        .map((r) => r.sourceId),
    ),
    ownIds = new Set(page.blocks.map((b) => b.id));
  return [
    ...page.blocks.filter((b) => !hidden.has(b.id)),
    ...repeatSources(project, pageId).filter(
      (b) =>
        b.repeatMode !== "independent" &&
        !ownIds.has(b.id) &&
        !hidden.has(b.id),
    ),
  ];
}
export function independentCopy(
  source,
  { blank = false, sheetIndex = 0 } = {},
) {
  const copy = {
    ...clone(source),
    id: uid(),
    repeatOnPages: false,
    repeatedFrom: source.id,
    sheetIndex,
  };
  if (blank) {
    if (copy.type === "text") {
      copy.text = "";
      copy.runs = [];
    }
    if (copy.type === "answer") {
      copy.value = "";
      copy.runs = [];
    }
    if (copy.type === "habit") {
      copy.title = "";
      copy.titleRuns = [];
    }
    if (copy.type === "table")
      for (const row of copy.cells)
        for (const cell of row) {
          cell.text = "";
          cell.runs = [];
        }
    if (copy.type === "image") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${copy.naturalWidth}" height="${copy.naturalHeight}" viewBox="0 0 ${copy.naturalWidth} ${copy.naturalHeight}"></svg>`;
      copy.src = copy.originalSrc = "data:image/svg+xml;base64," + btoa(svg);
      copy.originalWidth = copy.naturalWidth;
      copy.originalHeight = copy.naturalHeight;
      copy.caption = "";
      copy.name = "Question image placeholder";
      copy.templatePlaceholder = true;
    }
  }
  return copy;
}
export function flowBands(rectangles, gap = 14) {
  const occupied = rectangles
    .map((r) => ({
      start: clamp(r.y - gap, 0, CONTENT_H),
      end: clamp(r.y + r.h + gap, 0, CONTENT_H),
    }))
    .sort((a, b) => a.start - b.start);
  const bands = [];
  let end = 0;
  for (const r of occupied) {
    if (r.start > end) bands.push({ y: end, height: r.start - end });
    end = Math.max(end, r.end);
  }
  if (end < CONTENT_H) bands.push({ y: end, height: CONTENT_H - end });
  return bands;
}
export function isImageData(src) {
  return (
    typeof src === "string" &&
    /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(
      src,
    )
  );
}
export function validateSvg(text) {
  if (
    /<(?:script|foreignObject|iframe|object|embed|audio|video)\b|\bon\w+\s*=|<!ENTITY|<!DOCTYPE|@import|url\(\s*['"]?(?!#)/i.test(
      text,
    )
  )
    throw new Error(
      "SVG must be a self-contained image without scripts or external resources.",
    );
  for (const m of text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi))
    if (
      !m[1].startsWith("#") &&
      !/^data:image\/(png|jpeg|webp|gif);base64,/.test(m[1])
    )
      throw new Error("SVG contains an external resource.");
  if (!/<svg\b/i.test(text)) throw new Error("Invalid SVG image.");
  return text;
}
export function validateProject(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.pages) ||
    input.pages.length < 1 ||
    input.pages.length > 100
  )
    throw new Error(
      "Choose a Book Studio project file (version 1, up to 100 pages).",
    );
  const out = blankProject();
  const str = (v, max = 100) => String(v ?? "").slice(0, max);
  const num = (v, lo, hi, def) =>
    Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : def;
  for (const k of ["title", "level", "subject"]) out[k] = str(input[k]);
  out.fontSize = num(input.fontSize, 13, 20, 16);
  out.firstPage = Math.round(num(input.firstPage, 1, 9999, 1));
  out.snap = input.snap !== false;
  out.stackFractions = input.stackFractions !== false;
  out.shortcuts = cleanShortcuts(input.shortcuts);
  out.aiGuidance = str(input.aiGuidance, 10000);
  if (typeof input.id === "string" && /^[\w-]{1,80}$/.test(input.id))
    out.id = input.id;
  const ids = new Set(),
    pageIds = new Set();
  let total = 0;
  out.pages = input.pages.map((p) => {
    if (
      !Array.isArray(p.blocks) ||
      p.blocks.length > 300 ||
      (total += p.blocks.length) > 1500
    )
      throw new Error("Project has too many elements.");
    return {
      id:
        typeof p.id === "string" &&
        /^[\w-]{1,80}$/.test(p.id) &&
        !pageIds.has(p.id)
          ? (pageIds.add(p.id), p.id)
          : uid(),
      repeatSuppressed: Array.isArray(p.repeatSuppressed)
        ? p.repeatSuppressed
            .slice(0, 3000)
            .filter(
              (r) =>
                r &&
                /^[\w-]{1,80}$/.test(r.sourceId) &&
                Number.isInteger(r.sheetIndex) &&
                r.sheetIndex >= 0 &&
                r.sheetIndex <= 1000,
            )
            .map((r) => ({ sourceId: r.sourceId, sheetIndex: r.sheetIndex }))
        : [],
      blocks: p.blocks.map((b) => {
        if (
          ![
            "text",
            "habit",
            "image",
            "working",
            "answer",
            "divider",
            "shape",
            "table",
          ].includes(b.type)
        )
          throw new Error("Unknown element in project.");
        const v = makeBlock(b.type);
        v.id =
          typeof b.id === "string" &&
          /^[\w-]{1,80}$/.test(b.id) &&
          !ids.has(b.id)
            ? b.id
            : uid();
        ids.add(v.id);
        for (const k of [
          "text",
          "value",
          "title",
          "number",
          "caption",
          "name",
          "label",
        ])
          if (k in b)
            v[k] = str(b[k], ["text", "value"].includes(k) ? 100000 : 500);
        v.part = str(b.part, 12).replace(/[()]/g, "");
        Object.assign(v, cleanFormat(b));
        v.lineSpacing = num(
          b.lineSpacing,
          0.8,
          4,
          b.type === "habit" ? 1.35 : 1.6,
        );
        if (b.type === "text" || b.type === "answer")
          v.runs = normaliseRuns(
            b.type === "answer" ? v.value : v.text,
            b.runs,
          );
        if (b.type === "habit")
          for (const key of ["title", "number"])
            v[key + "Runs"] = normaliseRuns(v[key], b[key + "Runs"]);
        v.showLine = b.showLine !== false;
        v.repeatOnPages = !!b.repeatOnPages;
        v.repeatKeepClear = b.repeatKeepClear !== false;
        v.repeatMode =
          b.repeatMode === "independent" ? "independent" : "shared";
        if (
          typeof b.repeatedFrom === "string" &&
          /^[\w-]{1,80}$/.test(b.repeatedFrom)
        )
          v.repeatedFrom = b.repeatedFrom;
        if (Number.isInteger(b.sheetIndex))
          v.sheetIndex = Math.round(clamp(b.sheetIndex, 0, 1000));
        v.templatePlaceholder = !!b.templatePlaceholder;
        v.floating = !!b.floating || v.repeatOnPages;
        v.x = num(b.x, 0, CONTENT_W, 0);
        v.y = num(b.y, 0, CONTENT_H, 0);
        v.w = num(b.w, 40, CONTENT_W, 300);
        v.rotation = num(b.rotation, -180, 180, 0);
        v.locked = !!b.locked;
        v.style = ["body", "prompt", "heading"].includes(b.style)
          ? b.style
          : "body";
        v.align = ["left", "center", "right", "justify"].includes(b.align)
          ? b.align
          : "left";
        v.height = num(b.height, 20, CONTENT_H, 180);
        if (["text", "answer"].includes(b.type) && b.boxHeight !== undefined)
          v.boxHeight = num(b.boxHeight, 0, CONTENT_H, 0);
        v.ruled = !!b.ruled;
        if (b.type === "shape") {
          v.kind = [
            "rectangle",
            "rounded",
            "circle",
            "ellipse",
            "line",
            "path",
          ].includes(b.kind)
            ? b.kind
            : "rounded";
          if (v.kind === "path") {
            // A drawing: points are fractions (0..1) of the block's own box, so
            // it resizes like any shape. Anything that is not a usable path
            // falls back to a plain rectangle rather than an invisible block.
            v.points = cleanDrawingPoints(b.points);
            v.closed = !!b.closed;
            v.smooth = !!b.smooth;
            if (v.points.length < 2) v.kind = "rectangle";
          }
          v.fill = b.fill === "none" ? "none" : validColour(b.fill, "#edf6f6");
          v.stroke = validColour(b.stroke, "#239ba5");
          v.strokeWidth = num(b.strokeWidth, 0, 24, 2);
          v.radius = num(b.radius, 0, 200, 16);
          if (v.kind === b.kind) {
            // Draw creates native shapes and paths below the general 40x20
            // element minimum. Their box is part of the geometry: enlarging it
            // stretches normalized points and moves the visible stroke.
            // Allow padding for the maximum supported 24px stroke at page
            // edges. Changing stroke width later does not change the box.
            // offsetWidth/offsetHeight round the browser's content dimensions.
            const padY = v.kind === "path" ? 36 : 12,
              padX = v.kind === "line" ? 0 : padY;
            v.x = num(b.x, -padX, Math.ceil(CONTENT_W), 0);
            v.y = num(b.y, -padY, Math.ceil(CONTENT_H), 0);
            // Missing/nonpositive dimensions and unusable paths retain the
            // ordinary element defaults; positive sizes stay finite and bounded.
            if (Number(b.w) > 0)
              v.w = num(b.w, 1, Math.ceil(CONTENT_W) + padX * 2, 300);
            if (Number(b.height) > 0)
              v.height = num(b.height, 1, Math.ceil(CONTENT_H) + padY * 2, 180);
          }
          if (v.kind === "circle")
            v.height = v.w;
        }
        if (b.type === "table") {
          v.rows = Math.round(num(b.rows, 1, 50, 3));
          v.cols = Math.round(num(b.cols, 1, 12, 3));
          v.cells = resizeCells(b.cells, v.rows, v.cols);
          v.headerRow = b.headerRow !== false;
          v.borderColor = validColour(b.borderColor, "#8ba4ac");
          v.borderWidth = num(b.borderWidth, 0, 12, 1);
          v.rowHeight = num(b.rowHeight, 16, 180, 36);
          v.cellPadding = num(b.cellPadding, 0, 30, 8);
        }
        if (b.type === "image") {
          if (!isImageData(b.src) || b.src.length > 45000000)
            throw new Error("Project contains an invalid or oversized image.");
          if (b.src.startsWith("data:image/svg+xml"))
            validateSvg(atob(b.src.split(",")[1]));
          v.src = b.src;
          v.originalSrc = isImageData(b.originalSrc) ? b.originalSrc : b.src;
          if (v.originalSrc.startsWith("data:image/svg+xml"))
            validateSvg(atob(v.originalSrc.split(",")[1]));
          v.naturalWidth = num(b.naturalWidth, 1, 100000, 1);
          v.naturalHeight = num(b.naturalHeight, 1, 100000, 1);
          v.originalWidth = num(b.originalWidth, 1, 100000, v.naturalWidth);
          v.originalHeight = num(b.originalHeight, 1, 100000, v.naturalHeight);
        }
        return v;
      }),
    };
  });
  return out;
}
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    const tokens = paragraph.match(/\S+\s*|\s+/g) || [];
    for (const token of tokens) {
      if (measure(line + token) <= maxWidth) {
        line += token;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (measure(token) <= maxWidth) {
        line = token.trimStart();
        continue;
      }
      for (const c of token) {
        if (line && measure(line + c) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += c;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function snapPosition(x, y, w, h, others, enabled = true) {
  const guides = [];
  let nx = x,
    ny = y;
  if (!enabled)
    return {
      x: clamp(x, 0, CONTENT_W - w),
      y: clamp(y, 0, CONTENT_H - h),
      guides,
    };
  const axes = [
    ["x", x, w, CONTENT_W],
    ["y", y, h, CONTENT_H],
  ];
  for (const [axis, pos, size, limit] of axes) {
    const targets = [0, limit / 2, limit];
    for (const r of others)
      targets.push(
        r[axis],
        r[axis] + r[axis === "x" ? "w" : "h"] / 2,
        r[axis] + r[axis === "x" ? "w" : "h"],
      );
    let best = 6,
      adjust = null,
      target = null;
    for (const offset of [0, size / 2, size])
      for (const t of targets) {
        const d = t - (pos + offset);
        if (Math.abs(d) < best) {
          best = Math.abs(d);
          adjust = d;
          target = t;
        }
      }
    const value = adjust === null ? Math.round(pos / 8) * 8 : pos + adjust;
    if (axis === "x") nx = clamp(value, 0, Math.max(0, limit - size));
    else ny = clamp(value, 0, Math.max(0, limit - size));
    if (target !== null) guides.push({ axis, value: target });
  }
  return { x: nx, y: ny, guides };
}
export function dotDiagram(sides = 6, perEdge = 5) {
  sides = Math.round(clamp(sides, 3, 12));
  perEdge = Math.round(clamp(perEdge, 2, 20));
  const points = [];
  const vertices = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / sides;
    return [180 + 135 * Math.cos(a), 165 + 135 * Math.sin(a)];
  });
  for (let i = 0; i < sides; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % sides];
    for (let j = 0; j < perEdge - 1; j++) {
      const t = j / (perEdge - 1);
      points.push([a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t]);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="330" viewBox="0 0 360 330"><rect width="360" height="330" fill="white"/>${points.map(([x, y]) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="4" fill="#203c44"/>`).join("")}</svg>`;
  return {
    src: "data:image/svg+xml;base64," + btoa(svg),
    width: 360,
    height: 330,
    count: points.length,
  };
}
export function buildPdf(pages) {
  // The page images are lossless RGB streams. No JPEG step: fine diagrams and type stay crisp.
  const encoder = new TextEncoder(),
    parts = [],
    offsets = [0];
  let length = 0;
  const add = (v) => {
    const bytes = typeof v === "string" ? encoder.encode(v) : v;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id, head, stream) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${head}`);
    if (stream) {
      add(`\nstream\n`);
      add(stream);
      add("\nendstream");
    }
    add("\nendobj\n");
  };
  add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((page, i) => {
    const p = 3 + i * 3,
      c = p + 1,
      img = p + 2;
    const content = encoder.encode(
      `q\n595.2756 0 0 841.8898 0 0 cm\n/Im0 Do\nQ`,
    );
    object(
      p,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2756 841.8898] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${c} 0 R >>`,
    );
    object(c, `<< /Length ${content.length} >>`, content);
    object(
      img,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${page.bytes.length} >>`,
      page.bytes,
    );
  });
  const xref = length;
  const count = pages.length * 3 + 3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++)
    add(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/* ================= Drawings (the freehand Draw tool) ================= */

export const DRAW_MAX_POINTS = 1200;
/* Points are stored as fractions of the block's box: [[0.1, 0.5], …]. */
export function cleanDrawingPoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([clamp(x, 0, 1), clamp(y, 0, 1)].map((n) => Math.round(n * 1e4) / 1e4));
    if (out.length >= DRAW_MAX_POINTS) break;
  }
  return out;
}

/* The SVG path data for a "path" shape in its own box. Straight segments by
   default (a snapped triangle must keep its corners); `smooth` runs a
   Catmull-Rom curve through the points for freehand ink. */
export function drawingPathData(b) {
  const pts = cleanDrawingPoints(b.points).map(([x, y]) => [x * b.w, y * b.height]);
  if (pts.length < 2) return "";
  const f = (n) => Math.round(n * 100) / 100;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  if (b.smooth && pts.length > 2) {
    const at = (i) => pts[clamp(i, 0, pts.length - 1)];
    const wrap = b.closed ? (i) => pts[(i + pts.length) % pts.length] : at;
    const last = b.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const p0 = wrap(i - 1), p1 = wrap(i), p2 = wrap(i + 1), p3 = wrap(i + 2);
      d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
  } else {
    for (let i = 1; i < pts.length; i++) d += ` L${f(pts[i][0])} ${f(pts[i][1])}`;
  }
  return b.closed ? d + " Z" : d;
}

/* Ramer–Douglas–Peucker: the freehand stroke without the pen-jitter points. */
export function simplifyPoints(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop();
    let worst = 0, at = -1;
    const dx = pts[z].x - pts[a].x, dy = pts[z].y - pts[a].y, len = Math.hypot(dx, dy);
    for (let i = a + 1; i < z; i++) {
      const d = len < 1e-9
        ? Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y)
        : Math.abs((pts[i].x - pts[a].x) * dy - (pts[i].y - pts[a].y) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (at >= 0 && worst > eps) { keep[at] = true; stack.push([a, at], [at, z]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* A "path" block's fields from a polyline in CONTENT pixels. The box is the
   points' bounding box plus room for the line itself, so a perfectly straight
   or level stroke still has a box to be selected and resized by. */
export function pathBlockFields(points, { closed = false, smooth = false, stroke = "#1f2933", strokeWidth = 3, fill = "none" } = {}) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = Math.max(strokeWidth * 1.5, 4);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, height = Math.max(...ys) - Math.min(...ys) + pad * 2;
  return {
    kind: "path", fill, stroke, strokeWidth, closed, smooth,
    points: cleanDrawingPoints(points.map((p) => [(p.x - x0) / w, (p.y - y0) / height])),
    x: x0, y: y0, w, height, floating: true,
  };
}

/* What a finished Draw-tool stroke becomes. A held stroke that snapped to a
   shape the editor already has — circle, ellipse, rectangle, level line — turns
   into THAT shape, so it keeps its handles, corner radius and inspector. Every
   other snapped shape (triangle, polygon, arc, curve, anything tilted) is a
   "path". An unsnapped stroke is freehand ink. `desc` is a ShapeSnap descriptor
   (or null) and `toPoints` is ShapeSnap.toPoints, passed in so this stays pure.
   Everything is clamped to the content area. */
export function blockFromStroke(desc, rawPoints, style = {}, toPoints = null, bounds = { w: CONTENT_W, h: CONTENT_H }) {
  const sw = clamp(Number(style.strokeWidth) || 3, 0.5, 24);
  const base = { stroke: style.stroke || "#1f2933", strokeWidth: sw, fill: "none", floating: true };
  const fit = (p) => ({ x: clamp(p.x, 0, bounds.w), y: clamp(p.y, 0, bounds.h) });
  const box = (cx, cy, w, h) => ({ x: cx - w / 2 - sw / 2, y: cy - h / 2 - sw / 2, w: w + sw, height: h + sw });
  if (desc) {
    const level = (a, b) => Math.abs(a.y - b.y) < 1e-6;
    if (desc.kind === "circle" && desc.r >= 4) return { ...base, kind: "circle", ...box(desc.c.x, desc.c.y, desc.r * 2, desc.r * 2) };
    if (desc.kind === "ellipse" && !desc.rot) return { ...base, kind: "ellipse", ...box(desc.c.x, desc.c.y, desc.rx * 2, desc.ry * 2) };
    if (desc.kind === "rect" && !desc.rot) return { ...base, kind: "rectangle", ...box(desc.c.x, desc.c.y, desc.w, desc.h) };
    if (desc.kind === "line" && level(desc.a, desc.b)) {
      const a = fit(desc.a), b = fit(desc.b);
      return { ...base, kind: "line", x: Math.min(a.x, b.x), y: a.y - 12, w: Math.max(Math.abs(a.x - b.x), 1), height: 24 };
    }
    const pts = (toPoints ? toPoints(desc) : []).map(fit);
    if (pts.length >= 2) return pathBlockFields(pts, { ...base, closed: !!desc.closed, smooth: false });
  }
  const pts = simplifyPoints(rawPoints.map(fit), 0.7);
  // A tap, or a pen that never really moved, is not a drawing.
  const span = Math.hypot(
    Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
    Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
  );
  if (pts.length < 2 || !(span >= 2)) return null;
  return pathBlockFields(pts, { ...base, closed: false, smooth: true });
}
