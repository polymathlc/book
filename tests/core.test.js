import test from "node:test";
import assert from "node:assert/strict";
import {
  blankProject,
  makeBlock,
  validateProject,
  validateSvg,
  dotDiagram,
  snapPosition,
  wrapText,
  CONTENT_W,
  CONTENT_H,
  pageBlocks,
  repeatSources,
  independentCopy,
  flowBands,
  buildPdf,
} from "../core.js";
test("multiple habits and original image bytes survive a project round-trip", () => {
  const p = blankProject(),
    d = dotDiagram();
  p.pages[0].blocks = [
    makeBlock("habit", { title: "Double counting" }),
    makeBlock("habit", { title: "Check shared parts" }),
    makeBlock("image", {
      src: d.src,
      originalSrc: d.src,
      naturalWidth: 360,
      naturalHeight: 330,
      x: 100,
      y: 200,
    }),
  ];
  const q = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.pages[0].blocks.filter((b) => b.type === "habit").length, 2);
  assert.equal(q.pages[0].blocks[2].src, d.src);
  assert.equal(q.pages[0].blocks[2].originalSrc, d.src);
});
test("24 distinct dots give the example a valid double-counting solution", () => {
  const d = dotDiagram(6, 5);
  assert.equal(d.count, 6 * 5 - 6);
  const circles = atob(d.src.split(",")[1]).match(/<circle/g);
  assert.equal(circles.length, 24);
});
test("alignment snaps matching edges and keeps a frame on the page", () => {
  let r = snapPosition(
    101,
    203,
    200,
    100,
    [{ x: 100, y: 200, w: 180, h: 80 }],
    true,
  );
  assert.equal(r.x, 100);
  assert.equal(r.y, 200);
  assert.equal(r.guides.length, 2);
  r = snapPosition(-25, CONTENT_H + 20, 200, 100, [], false);
  assert.equal(r.x, 0);
  assert.equal(r.y, CONTENT_H - 100);
});
test("long words wrap and explicit blank lines are preserved", () => {
  const lines = wrapText("abcdefghijk\n\nnext", 5, (t) => t.length);
  assert.deepEqual(lines, ["abcde", "fghij", "k", "", "next"]);
});
test("untrusted imports reject active SVG, malformed sources and unsupported versions", () => {
  assert.throws(() => validateSvg("<svg><script>alert(1)</script></svg>"));
  assert.throws(() =>
    validateSvg('<svg><image href="https://example.com/a.png"/></svg>'),
  );
  assert.throws(() => validateSvg('<svg onload="alert(1)"></svg>'));
  assert.throws(() => validateProject({ version: 8, pages: [] }));
  const p = blankProject();
  p.pages[0].blocks = [makeBlock("image", { src: "javascript:alert(1)" })];
  assert.throws(() => validateProject(p));
});
test("import repairs duplicate element IDs and clamps unsafe coordinates", () => {
  const p = blankProject(),
    a = makeBlock("habit");
  p.pages[0].blocks = [a, { ...a, x: 1e9, y: -100, w: 1e8 }];
  const q = validateProject(p);
  assert.notEqual(q.pages[0].blocks[0].id, q.pages[0].blocks[1].id);
  assert.equal(q.pages[0].blocks[1].w, CONTENT_W);
  assert.equal(q.pages[0].blocks[1].y, 0);
});
test("PDF has one A4 page per canvas and correct byte offsets", async () => {
  const pdf = buildPdf([
    {
      width: 1,
      height: 1,
      bytes: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]),
    },
    {
      width: 1,
      height: 1,
      bytes: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]),
    },
  ]);
  const bytes = new Uint8Array(await pdf.arrayBuffer()),
    text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Count 2/);
  assert.equal(
    (text.match(/\/MediaBox \[0 0 595.2756 841.8898\]/g) || []).length,
    2,
  );
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(start, start + 4)), "xref");
});
test("page templates begin at the source page and independent content stays separate", () => {
  const p = blankProject(),
    banner = makeBlock("habit", {
      repeatOnPages: true,
      floating: true,
      x: 20,
      y: 40,
      w: 500,
    });
  const question = makeBlock("text", {
    repeatOnPages: true,
    repeatMode: "independent",
    floating: true,
    text: "Original question",
    fontFamily: "Roboto",
    color: "#21536a",
    boxHeight: 80,
    w: 400,
    x: 30,
    y: 120,
  });
  p.pages = [
    { id: "before", blocks: [] },
    { id: "source", blocks: [banner, question] },
    { id: "future", blocks: [] },
  ];
  assert.deepEqual(repeatSources(p, "before"), []);
  assert.deepEqual(
    pageBlocks(p, "future").map((b) => b.id),
    [banner.id],
  );
  const copy = independentCopy(question, { blank: true });
  p.pages[2].blocks.push(copy);
  copy.text = "Different question";
  assert.equal(question.text, "Original question");
  assert.equal(copy.x, question.x);
  assert.equal(copy.y, question.y);
  assert.equal(copy.fontFamily, question.fontFamily);
  assert.equal(copy.boxHeight, question.boxHeight);
  assert.notEqual(copy.id, question.id);
  const detached = independentCopy(banner, { sheetIndex: 1 });
  p.pages[2].blocks.push(detached);
  p.pages[2].repeatSuppressed = [{ sourceId: banner.id, sheetIndex: 1 }];
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.pages[1].blocks[1].repeatMode, "independent");
  assert.equal(restored.pages[2].blocks[0].text, "Different question");
  assert.equal(restored.pages[2].blocks[1].sheetIndex, 1);
  assert.deepEqual(
    restored.pages[2].repeatSuppressed,
    p.pages[2].repeatSuppressed,
  );
});
test("blank independent images preserve frame ratio while full copies preserve source bytes", () => {
  const d = dotDiagram(),
    source = makeBlock("image", {
      src: d.src,
      originalSrc: d.src,
      naturalWidth: d.width,
      naturalHeight: d.height,
      w: 300,
      x: 25,
      y: 80,
    });
  const full = independentCopy(source),
    blank = independentCopy(source, { blank: true });
  assert.equal(full.src, d.src);
  assert.equal(full.originalSrc, d.src);
  assert.notEqual(blank.src, d.src);
  assert.equal(blank.templatePlaceholder, true);
  assert.equal(
    blank.naturalWidth / blank.naturalHeight,
    source.naturalWidth / source.naturalHeight,
  );
  assert.ok(!atob(blank.src.split(",")[1]).includes("<circle"));
});
test("flowing questions have clear vertical bands around overlapping page templates", () => {
  assert.deepEqual(flowBands([]), [{ y: 0, height: CONTENT_H }]);
  const bands = flowBands([
    { y: 0, h: 40 },
    { y: 30, h: 50 },
    { y: 200, h: 80 },
  ]);
  assert.deepEqual(bands, [
    { y: 94, height: 92 },
    { y: 294, height: CONTENT_H - 294 },
  ]);
});
