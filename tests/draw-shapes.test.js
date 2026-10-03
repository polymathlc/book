/* The page-level Draw tool's pure half: what a finished stroke becomes. The
   recogniser is the REAL shape-snap.js, so these also pin that its descriptors
   (circle, ellipse, rect, line…) are what core.js expects. Every failure here is
   quiet in the app — a snapped circle that came out as a "path" still looks like
   a circle, but has lost its handles, its corner radius and its inspector. */
import test from "node:test";
import assert from "node:assert/strict";
import "../shape-snap.js";
import {
  CONTENT_W,
  CONTENT_H,
  blockFromStroke,
  cleanDrawingPoints,
  drawingPathData,
  makeBlock,
  pathBlockFields,
  simplifyPoints,
  validateProject,
  blankProject,
} from "../core.js";
import { rng, make } from "./shape-snap-fixtures.mjs";

const ShapeSnap = globalThis.ShapeSnap;
const style = { stroke: "#1f2933", strokeWidth: 3 };
const place = (pts, dx, dy) => {
  const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x - x0 + dx, y: p.y - y0 + dy }));
};
const snap = (pts) => {
  const desc = ShapeSnap.recognize(pts, { unit: 1 });
  return blockFromStroke(desc, pts, style, ShapeSnap.toPoints);
};

test("a held circle becomes the editor's own circle block, centred where it was drawn", () => {
  const pts = place(make.circle(rng(1), 160), 200, 150);
  const b = snap(pts);
  assert.equal(b.kind, "circle");
  assert.ok(Math.abs(b.w - b.height) < 1e-6, "round");
  const cx = b.x + b.w / 2, cy = b.y + b.height / 2;
  assert.ok(Math.abs(cx - 280) < 12 && Math.abs(cy - 230) < 12, `centre ${cx},${cy}`);
  assert.equal(b.fill, "none");
  assert.equal(b.floating, true);
});

test("a held ellipse and a level-sided rectangle become ellipse and rectangle blocks", () => {
  const e = snap(place(make.ellipse(rng(2), 240, 0.45, 0), 100, 100));
  assert.equal(e.kind, "ellipse");
  assert.ok(e.w > e.height * 1.6);
  const r = snap(place(make.rect(rng(3), 260, 140, 0), 80, 80));
  assert.equal(r.kind, "rectangle");
  assert.ok(Math.abs(r.w - 260) < 20 && Math.abs(r.height - 140) < 20, `${r.w}×${r.height}`);
});

test("a level held line becomes a thin line block; a tilted one is a path so its slope survives", () => {
  const level = snap(place(make.line(rng(4), 300, 0), 60, 200));
  assert.equal(level.kind, "line");
  assert.equal(level.height, 24, "a line block is a 24px strip");
  assert.ok(level.w > 280);
  const tilted = snap(place(make.line(rng(5), 280, 120), 60, 60));
  assert.equal(tilted.kind, "path");
  assert.equal(tilted.closed, false);
  assert.equal(tilted.points.length, 2);
  const [a, b] = tilted.points;
  assert.ok(Math.abs(a[1] - b[1]) > 0.1, "the slope is kept in the box");
});

test("triangles, polygons and arcs are paths that keep their corners (no smoothing)", () => {
  const tri = snap(place(make.regular(rng(6), 3, 200, 10), 100, 100));
  assert.equal(tri.kind, "path");
  assert.equal(tri.closed, true);
  assert.equal(tri.smooth, false);
  assert.equal(tri.points.length, 4, "three corners and the point that closes it");
  const d = drawingPathData(tri);
  assert.ok(!/C/.test(d), "straight segments only: " + d);
  assert.ok(/Z$/.test(d));
  const arc = snap(place(make.arc(rng(7), 160, 200), 100, 100));
  assert.equal(arc.kind, "path");
});

test("an unsnapped stroke is smoothed freehand ink, simplified of pen jitter", () => {
  const pts = place(make.wave(rng(8), 320, 40), 40, 100);
  const b = blockFromStroke(null, pts, style, ShapeSnap.toPoints);
  assert.equal(b.kind, "path");
  assert.equal(b.smooth, true);
  assert.equal(b.closed, false);
  assert.ok(b.points.length >= 3 && b.points.length < pts.length, `${b.points.length} of ${pts.length}`);
  assert.match(drawingPathData(b), /C/, "drawn as a curve");
});

test("a stroke with fewer than two real points makes no block at all", () => {
  assert.equal(blockFromStroke(null, [{ x: 5, y: 5 }], style, ShapeSnap.toPoints), null);
  assert.equal(blockFromStroke(null, [{ x: 5, y: 5 }, { x: 5, y: 5 }], style, ShapeSnap.toPoints), null);
});

test("everything is clamped to the content area, even when the hand strayed off the page", () => {
  const pts = [{ x: -50, y: 20 }, { x: 80, y: 40 }, { x: CONTENT_W + 90, y: CONTENT_H + 70 }];
  const b = blockFromStroke(null, pts, style, ShapeSnap.toPoints);
  for (const [x, y] of b.points) {
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
  }
  assert.ok(b.x >= -12 && b.x + b.w <= CONTENT_W + 12, "box stays within a stroke's width of the page");
  assert.ok(b.y + b.height <= CONTENT_H + 12);
});

test("path points are fractions of the box, so resizing scales the drawing", () => {
  const fields = pathBlockFields([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 260 }], { closed: true });
  assert.ok(fields.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  const small = drawingPathData({ ...fields, w: 100, height: 80 });
  const big = drawingPathData({ ...fields, w: 200, height: 160 });
  assert.notEqual(small, big);
  const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.deepEqual(nums(big), nums(small).map((n) => Math.round(n * 2 * 100) / 100));
});

test("a perfectly level or upright stroke still has a box to be selected by", () => {
  const f = pathBlockFields([{ x: 50, y: 80 }, { x: 250, y: 80 }]);
  assert.ok(f.height >= 8, `height ${f.height}`);
  const g = pathBlockFields([{ x: 80, y: 50 }, { x: 80, y: 250 }]);
  assert.ok(g.w >= 8, `width ${g.w}`);
});

test("cleanDrawingPoints drops junk, clamps to 0..1 and bounds the count", () => {
  assert.deepEqual(cleanDrawingPoints(null), []);
  assert.deepEqual(cleanDrawingPoints([[0.5, 0.5], "x", [NaN, 1], [2, -1], [1]]), [[0.5, 0.5], [1, 0]]);
  const many = Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5]);
  assert.equal(cleanDrawingPoints(many).length, 1200);
});

test("simplifyPoints keeps the corners of a polyline and drops collinear ones", () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0.2 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 100, y: 120 }];
  const out = simplifyPoints(pts, 1);
  assert.deepEqual(out.map((p) => [p.x, p.y]), [[0, 0], [100, 0], [100, 120]]);
});

test("a path block survives validateProject; a bad one becomes a plain rectangle, never invisible", () => {
  const good = makeBlock("shape", pathBlockFields([{ x: 10, y: 10 }, { x: 90, y: 40 }, { x: 30, y: 80 }], { closed: true }));
  const bad = makeBlock("shape", { kind: "path", points: [[0.1, 0.1]] });
  const project = blankProject();
  project.pages[0].blocks.push(good, bad);
  const out = validateProject(JSON.parse(JSON.stringify(project)));
  const [g, b] = out.pages[0].blocks;
  assert.equal(g.kind, "path");
  assert.equal(g.closed, true);
  assert.equal(g.points.length, good.points.length);
  assert.equal(b.kind, "rectangle");
});
