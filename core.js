export const PX_PER_MM = 96 / 25.4;
export const PAGE_W = 210 * PX_PER_MM;
export const PAGE_H = 297 * PX_PER_MM;
export const CONTENT_W = 186 * PX_PER_MM;
export const CONTENT_H = 273 * PX_PER_MM - 37 - 16 * PX_PER_MM;
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
    title: "PSLE Mathematics",
    level: "Primary 6",
    subject: "Mathematics",
    firstPage: 1,
    fontSize: 16,
    snap: true,
    pages: [{ id: uid(), blocks: [] }],
  };
}
export function makeBlock(type, fields = {}) {
  const defaults = {
    text: { text: "", style: "body", align: "left" },
    habit: { number: "01", title: "Look for a pattern" },
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
    answer: { text: "Answer" },
    divider: {},
  };
  return { id: uid(), type, ...defaults[type], ...fields };
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
  const ids = new Set();
  let total = 0;
  out.pages = input.pages.map((p) => {
    if (
      !Array.isArray(p.blocks) ||
      p.blocks.length > 300 ||
      (total += p.blocks.length) > 1500
    )
      throw new Error("Project has too many elements.");
    return {
      id: uid(),
      blocks: p.blocks.map((b) => {
        if (
          !["text", "habit", "image", "working", "answer", "divider"].includes(
            b.type,
          )
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
        for (const k of ["text", "title", "number", "caption", "name", "label"])
          if (k in b) v[k] = str(b[k], k === "text" ? 100000 : 500);
        v.floating = !!b.floating;
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
        v.ruled = !!b.ruled;
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
