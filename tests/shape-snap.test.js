/* ShapeSnap: recognition quality over randomised hand-drawn strokes, plus the
   behaviour each app relies on (angle snapping, adjust-while-dragging, pen path
   flattening, hold detection). This file is byte-identical in book, cer and
   anskey — they share shape-snap.js and must share its tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import '../shape-snap.js';
import { rng, make } from './shape-snap-fixtures.mjs';

const S = globalThis.ShapeSnap;
const deg = (r) => (r * 180) / Math.PI;
const SIZES = [40, 120, 320, 700];
const SEEDS = 24;

/* Fraction of random strokes for which `ok` holds. */
function rate(build, ok, sizes = SIZES) {
  let hit = 0, total = 0;
  const misses = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const size of sizes) {
      const r = rng(seed * 7919 + size);
      const d = S.recognize(build(r, size), { unit: 1 });
      total++;
      if (ok(d, size)) hit++;
      else { const k = d ? d.kind : 'null'; misses[k] = (misses[k] || 0) + 1; }
    }
  }
  return { rate: hit / total, misses };
}
function expectRate(name, build, ok, min = 0.95, sizes) {
  test(`recognises ${name} (≥ ${Math.round(min * 100)}% of hand-drawn strokes)`, () => {
    const out = rate(build, ok, sizes);
    assert.ok(out.rate >= min, `${name}: ${(out.rate * 100).toFixed(1)}% — misses ${JSON.stringify(out.misses)}`);
  });
}

/* ---------- straight lines ---------- */
expectRate('a straight line at any angle', (r, s) => make.line(r, s, r.range(-180, 180)), (d) => d && d.kind === 'line');
expectRate('a nearly-level line and levels it exactly', (r, s) => make.line(r, s, r.range(-3, 3)), (d) => d && d.kind === 'line' && Math.abs(d.a.y - d.b.y) < 1e-6);
expectRate('a nearly-upright line and plumbs it exactly', (r, s) => make.line(r, s, 90 + r.range(-3, 3)), (d) => d && d.kind === 'line' && Math.abs(d.a.x - d.b.x) < 1e-6);

/* ---------- circles and ellipses ---------- */
expectRate('a circle, with overshoot or a small gap', (r, s) => make.circle(r, s, r() > 0.5), (d) => d && d.kind === 'circle');
expectRate('an axis-aligned ellipse', (r, s) => make.ellipse(r, s, 0.6, r.range(-3, 3)), (d) => d && d.kind === 'ellipse' && d.rot === 0);
expectRate('a tilted ellipse and keeps its tilt', (r, s) => make.ellipse(r, s, 0.5, 35), (d) => d && d.kind === 'ellipse' && Math.abs(Math.abs(deg(d.rot)) - 35) < 8);
expectRate('a thin ellipse at any angle', (r, s) => make.ellipse(r, s, 0.3, r.range(-90, 90)), (d) => d && d.kind === 'ellipse', 0.93);

/* ---------- rectangles, squares, polygons ---------- */
expectRate('a rectangle', (r, s) => make.rect(r, s, s / 1.6, 0), (d) => d && d.kind === 'rect' && !d.square && d.rot === 0);
expectRate('a tilted rectangle and keeps its tilt', (r, s) => make.rect(r, s, s / 1.7, 25), (d) => d && d.kind === 'rect' && Math.abs(deg(d.rot) - 25) < 8);
expectRate('a long thin rectangle at any angle', (r, s) => make.rect(r, s, s / 3, r.range(-90, 90)), (d) => d && d.kind === 'rect');
expectRate('a square', (r, s) => make.rect(r, s, s, r.range(-3, 3)), (d) => d && d.kind === 'rect' && d.square);
expectRate('a diamond as a square turned 45°', (r, s) => make.rect(r, s, s, 45), (d) => d && d.kind === 'rect' && d.square);
expectRate('a rectangle with rounded corners', (r, s) => make.rect(r, s, s / 1.5, 0, 0.05), (d) => d && d.kind === 'rect');
expectRate('a triangle', (r, s) => make.polygon(r, [{ x: 150, y: 100 }, { x: 150 + s * 0.55, y: 100 + s * 0.9 }, { x: 150 - s * 0.45, y: 100 + s * 0.85 }], s), (d) => d && d.kind === 'poly' && d.pts.length === 3);
expectRate('a right triangle', (r, s) => make.polygon(r, [{ x: 100, y: 100 }, { x: 100, y: 100 + s }, { x: 100 + s * 1.3, y: 100 + s }], s), (d) => d && d.kind === 'poly' && d.pts.length === 3);
expectRate('an equilateral triangle at any rotation', (r, s) => make.regular(r, 3, s, r.range(0, 120)), (d) => d && d.kind === 'poly' && d.pts.length === 3);
expectRate('a pentagon', (r, s) => make.regular(r, 5, s, r.range(0, 72)), (d) => d && d.kind === 'poly' && d.pts.length === 5);
expectRate('a hexagon', (r, s) => make.regular(r, 6, s, r.range(0, 60)), (d) => d && d.kind === 'poly' && d.pts.length === 6);

/* ---------- open curves ---------- */
expectRate('a shallow arc', (r, s) => make.arc(r, s, 100), (d) => d && d.kind === 'arc');
expectRate('a deep arc', (r, s) => make.arc(r, s, 250), (d) => d && d.kind === 'arc');
expectRate('an S-curve as a smooth curve, not as corners', (r, s) => make.curve(r, s), (d) => d && d.kind === 'curve');
expectRate('an L as a corner', (r, s) => make.polyline(r, [{ x: 100, y: 100 }, { x: 100, y: 100 + s }, { x: 100 + s * 0.8, y: 100 + s }], s), (d) => d && d.kind === 'polyline');
expectRate('a V as a corner', (r, s) => make.polyline(r, [{ x: 100, y: 100 }, { x: 100 + s * 0.4, y: 100 + s }, { x: 100 + s * 0.8, y: 100 }], s), (d) => d && d.kind === 'polyline');

/* ---------- things that must be LEFT ALONE ---------- */
expectRate('a zig-zag is left as ink', (r, s) => make.zigzag(r, s), (d) => d === null, 0.97);
expectRate('a wave is left as ink', (r, s) => make.wave(r, s), (d) => d === null, 0.97);
expectRate('a scribble is mostly left as ink', (r, s) => make.scribble(r, s), (d) => d === null, 0.85);

test('a dot, a tick and a handful of points are left as ink', () => {
  assert.equal(S.recognize([]), null);
  assert.equal(S.recognize(null), null);
  assert.equal(S.recognize([{ x: 1, y: 1 }]), null);
  assert.equal(S.recognize([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null);
  const dot = Array.from({ length: 30 }, (_, i) => ({ x: 50 + Math.cos(i) * 1.5, y: 50 + Math.sin(i) * 1.5 }));
  assert.equal(S.recognize(dot), null, 'a tiny blob is a dot, not a circle');
  const same = Array.from({ length: 20 }, () => ({ x: 7, y: 7 }));
  assert.equal(S.recognize(same), null);
});
test('non-finite and malformed points never throw or leak NaN', () => {
  const pts = [{ x: 0, y: 0 }, { x: NaN, y: 4 }, null, { x: 10, y: Infinity }, { x: 50, y: 1 }, { x: 100, y: 0 }, { x: 150, y: -1 }, { x: 200, y: 0 }];
  const d = S.recognize(pts);
  assert.ok(d && d.kind === 'line');
  for (const p of S.toPoints(d)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
test('recognize never mutates its input', () => {
  const r = rng(11);
  const pts = make.circle(r, 200);
  const copy = JSON.parse(JSON.stringify(pts));
  S.recognize(pts);
  assert.deepEqual(pts, copy);
});

/* ---------- geometry of the result ---------- */
test('a circle comes back centred on and as large as the drawn one', () => {
  const R = 100, c = { x: 300, y: 250 };
  const pts = [];
  for (let i = 0; i <= 150; i++) { const t = (i / 150) * Math.PI * 2; pts.push({ x: c.x + R * Math.cos(t) + Math.sin(i * 3) * 1.2, y: c.y + R * Math.sin(t) + Math.cos(i * 2) * 1.2 }); }
  const d = S.recognize(pts);
  assert.equal(d.kind, 'circle');
  assert.ok(Math.hypot(d.c.x - c.x, d.c.y - c.y) < 3);
  assert.ok(Math.abs(d.r - R) < 3);
});
test('a rectangle keeps its size and centre', () => {
  const r = rng(5);
  const pts = make.rect(r, 260, 150, 0);
  const d = S.recognize(pts);
  assert.equal(d.kind, 'rect');
  assert.ok(Math.abs(d.w - 260) < 14 && Math.abs(d.h - 150) < 14, `${d.w} × ${d.h}`);
});
test('a right triangle is made exactly right-angled', () => {
  const pts = make.polygon(rng(3), [{ x: 100, y: 100 }, { x: 100, y: 300 }, { x: 330, y: 300 }], 300);
  const d = S.recognize(pts);
  assert.equal(d.kind, 'poly');
  const [a, b, c] = d.pts;
  const dots = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, w]) => ((q.x - p.x) * (w.x - p.x) + (q.y - p.y) * (w.y - p.y)));
  assert.ok(dots.some((v) => Math.abs(v) < 1e-6), 'one corner is exactly 90°');
});
test('a nearly regular hexagon is made regular', () => {
  const d = S.recognize(make.regular(rng(2), 6, 260, 3));
  assert.equal(d.kind, 'poly');
  assert.equal(d.regular, true);
  const sides = d.pts.map((p, i) => Math.hypot(p.x - d.pts[(i + 1) % 6].x, p.y - d.pts[(i + 1) % 6].y));
  assert.ok(Math.max(...sides) - Math.min(...sides) < 1e-6);
});
test('a gently bowed line stays an arc rather than being flattened', () => {
  const d = S.recognize(make.arc(rng(8), 300, 70));
  assert.equal(d.kind, 'arc');
});
test('level / plumb / 45° snapping is applied to lines, and only when close', () => {
  const near = S.snapLineAngle({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 200, y: 6 } });
  assert.equal(near.b.y - near.a.y, 0);
  const diag = S.snapLineAngle({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 200, y: 195 } });
  assert.ok(Math.abs(diag.b.x - diag.a.x - (diag.b.y - diag.a.y)) < 1e-9, '45° exactly');
  const off = S.snapLineAngle({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 200, y: 60 } });
  assert.ok(Math.abs(off.b.y - off.a.y - 60) < 1e-9, '17° is left alone');
  const len = Math.hypot(near.b.x - near.a.x, near.b.y - near.a.y);
  assert.ok(Math.abs(len - Math.hypot(200, 6)) < 1e-9, 'length is preserved');
});
test('the stroke is recognised the same at any zoom (unit-scaled floors)', () => {
  const base = make.line(rng(4), 100, 20);
  const big = base.map((p) => ({ x: p.x * 8, y: p.y * 8 }));
  assert.equal(S.recognize(base, { unit: 1 }).kind, 'line');
  assert.equal(S.recognize(big, { unit: 8 }).kind, 'line');
  const tiny = [];
  for (let i = 0; i <= 30; i++) tiny.push({ x: i * 0.2, y: Math.sin(i) * 0.02 });
  assert.equal(S.recognize(tiny, { unit: 1 }), null, 'a 6px stroke is a dash, not a line');
  assert.equal(S.recognize(tiny.map((p) => ({ x: p.x * 0.05, y: p.y * 0.05 })), { unit: 0.01 }).kind, 'line', 'but the same at fine zoom is');
});

/* ---------- toPoints ---------- */
test('toPoints: closed shapes close, lines are two points, everything is finite', () => {
  const r = rng(21);
  const cases = [
    [make.line(r, 200, 10), 'line', false], [make.circle(r, 200), 'circle', true], [make.ellipse(r, 240, 0.5, 20), 'ellipse', true],
    [make.rect(r, 240, 130, 12), 'rect', true], [make.regular(r, 3, 220, 10), 'poly', true],
    [make.arc(r, 220, 120), 'arc', false], [make.curve(r, 260), 'curve', false]
  ];
  for (const [pts, kind, closed] of cases) {
    const d = S.recognize(pts);
    assert.equal(d && d.kind, kind);
    const out = S.toPoints(d);
    assert.ok(out.length >= 2);
    out.forEach((p) => assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)));
    if (kind === 'line') assert.equal(out.length, 2);
    if (closed) assert.deepEqual(out[0], out[out.length - 1], `${kind} closes`);
    else assert.notDeepEqual(out[0], out[out.length - 1]);
  }
});
test('snapStroke bundles the descriptor and the points; label names the shape', () => {
  const s = S.snapStroke(make.rect(rng(9), 220, 220, 0));
  assert.equal(s.closed, true);
  assert.equal(S.label(s.desc), 'Square');
  assert.equal(S.label(S.recognize(make.regular(rng(9), 3, 220, 0))), 'Triangle');
  assert.equal(S.label(S.recognize(make.circle(rng(9), 220))), 'Circle');
  assert.equal(S.label(S.recognize(make.line(rng(9), 220, 30))), 'Straight line');
  assert.equal(S.label(null), '');
});

/* ---------- keep dragging to adjust ---------- */
test('drag: a line end follows the pen and the start stays', () => {
  const d = S.recognize(make.line(rng(1), 200, 30));
  const n = S.drag(d, { x: d.a.x + 300, y: d.a.y + 77 });
  assert.deepEqual(n.a, d.a);
  assert.ok(Math.abs(Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) - Math.hypot(300, 77)) < 1e-6);
  const level = S.drag(d, { x: d.a.x + 250, y: d.a.y + 4 });
  assert.equal(level.b.y, level.a.y, 'dragging near level snaps level');
  assert.notEqual(n, d, 'drag returns a new descriptor');
});
test('drag: a circle follows the pen as its radius; an ellipse scales', () => {
  const c = S.recognize(make.circle(rng(2), 160));
  assert.ok(Math.abs(S.drag(c, { x: c.c.x + 120, y: c.c.y }).r - 120) < 1e-9);
  assert.ok(S.drag(c, { x: c.c.x, y: c.c.y }).r >= 3, 'never collapses to nothing');
  const e = S.recognize(make.ellipse(rng(2), 260, 0.5, 20));
  const bigger = S.drag(e, { x: e.c.x + e.d0 * 2, y: e.c.y });
  assert.ok(Math.abs(bigger.rx / e.rx - 2) < 1e-6 && Math.abs(bigger.ry / e.ry - 2) < 1e-6);
});
test('drag: a polygon corner follows the pen — the one nearest where it snapped', () => {
  const pts = make.regular(rng(3), 3, 240, 0);
  const last = pts[pts.length - 1];
  const d = S.recognize(pts, { last });
  const target = { x: 999, y: 999 };
  const n = S.drag(d, target);
  assert.equal(n.pts.filter((p) => p.x === 999 && p.y === 999).length, 1);
  assert.equal(n.pts[d.handle].x, 999);
  assert.equal(d.pts.some((p) => p.x === 999), false, 'original untouched');
});
test('drag: a rectangle resizes about the opposite corner, and a square stays square', () => {
  const rectD = S.recognize(make.rect(rng(6), 240, 120, 0), { last: { x: 1e6, y: 1e6 } });
  const corners = S.rectCorners(rectD);
  const opp = corners[(rectD.handle + 2) % 4];
  const to = { x: opp.x + (rectD.handle === 0 || rectD.handle === 3 ? -400 : 400), y: opp.y + (rectD.handle < 2 ? -300 : 300) };
  const n = S.drag(rectD, to);
  const nc = S.rectCorners(n);
  assert.ok(Math.hypot(nc[(rectD.handle + 2) % 4].x - opp.x, nc[(rectD.handle + 2) % 4].y - opp.y) < 1e-6, 'opposite corner is fixed');
  assert.ok(Math.abs(n.w - 400) < 1e-6 && Math.abs(n.h - 300) < 1e-6);
  const sq = S.recognize(make.rect(rng(6), 200, 200, 0));
  const ns = S.drag(sq, { x: sq.c.x + 500, y: sq.c.y + 220 });
  assert.ok(Math.abs(ns.w - ns.h) < 1e-9, 'a square stays square');
});
test('drag: an arc extends round its centre; a curve end moves with its handle', () => {
  const arc = S.recognize(make.arc(rng(7), 260, 120));
  const end = { x: arc.c.x + arc.r * Math.cos(arc.a0 + arc.sweep + 0.5), y: arc.c.y + arc.r * Math.sin(arc.a0 + arc.sweep + 0.5) };
  const longer = S.drag(arc, end);
  assert.ok(Math.abs(Math.abs(longer.sweep) - Math.abs(arc.sweep) - 0.5) < 1e-6);
  const cv = S.recognize(make.curve(rng(7), 260));
  const moved = S.drag(cv, { x: cv.p[3].x + 40, y: cv.p[3].y + 10 });
  assert.deepEqual(moved.p[0], cv.p[0]);
  assert.ok(Math.abs(moved.p[2].x - cv.p[2].x - 40) < 1e-9);
});

/* ---------- pen path ---------- */
test('flattenAnchors: corner anchors give a polygon, smooth anchors give a curve', () => {
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.deepEqual(S.flattenAnchors(corners, true), corners);
  assert.equal(S.flattenAnchors(corners, false).length, 3);
  const a = S.setSmoothHandles({ x: 0, y: 0 }, { x: 40, y: -60 });
  assert.deepEqual(a.hin, { x: -40, y: 60 }, 'the handles are mirrored through the anchor');
  const b = S.setSmoothHandles({ x: 100, y: 0 }, { x: 140, y: 60 });
  const curve = S.flattenAnchors([a, b], false, 0.2);
  assert.ok(curve.length > 8, 'subdivided into many segments');
  assert.deepEqual(curve[0], { x: 0, y: 0 });
  assert.deepEqual(curve[curve.length - 1], { x: 100, y: 0 });
  const dev = Math.max(...curve.map((p) => Math.abs(p.y)));
  assert.ok(dev > 10, 'it really bulges away from the chord');
});
test('flattenAnchors: a closed path has no duplicated closing point, and tolerance matters', () => {
  const a = S.setSmoothHandles({ x: 0, y: 0 }, { x: 0, y: -55 });
  const b = S.setSmoothHandles({ x: 100, y: 0 }, { x: 0, y: 55 });
  const loose = S.flattenAnchors([a, b], true, 4), tight = S.flattenAnchors([a, b], true, 0.05);
  assert.ok(tight.length > loose.length);
  assert.notDeepEqual(tight[0], tight[tight.length - 1]);
  assert.ok(S.polygonArea(tight) > 1000);
});
test('pointInPolygon and polygonArea', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(S.pointInPolygon({ x: 5, y: 5 }, sq), true);
  assert.equal(S.pointInPolygon({ x: 15, y: 5 }, sq), false);
  assert.equal(S.polygonArea(sq), 100);
  const concave = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 3 }, { x: 0, y: 10 }];
  assert.equal(S.pointInPolygon({ x: 5, y: 8 }, concave), false, 'the notch is outside');
});
test('hitAnchors prefers handles over anchors when both are in reach, then the nearest', () => {
  const a = S.setSmoothHandles({ x: 50, y: 50 }, { x: 80, y: 50 });
  const anchors = [a, { x: 200, y: 200 }];
  assert.deepEqual(S.hitAnchors(anchors, { x: 81, y: 51 }, 8), { i: 0, part: 'hout' });
  assert.deepEqual(S.hitAnchors(anchors, { x: 49, y: 51 }, 8), { i: 0, part: 'anchor' });
  assert.deepEqual(S.hitAnchors(anchors, { x: 202, y: 198 }, 8), { i: 1, part: 'anchor' });
  assert.equal(S.hitAnchors(anchors, { x: 130, y: 130 }, 8), null);
});

/* ---------- hold detection ---------- */
function fakeClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const i = ++id; timers.set(i, { at: now + ms, fn }); return i; },
    clearTimeout(i) { timers.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, t] of [...timers]) if (t.at <= now) { timers.delete(i); t.fn(); }
    },
    pending: () => timers.size
  };
}
test('createHold fires once after the pen rests, and re-arms on real movement', () => {
  const clock = fakeClock();
  let fired = 0;
  const hold = S.createHold({ ms: 500, jitter: 6, onHold: () => fired++, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  hold.start(10, 10);
  clock.advance(400); hold.move(12, 11);               // inside the jitter radius: the clock keeps running
  clock.advance(150);
  assert.equal(fired, 1);
  assert.equal(hold.held(), true);
  clock.advance(2000);
  assert.equal(fired, 1, 'fires once');
  const again = S.createHold({ ms: 500, jitter: 6, onHold: () => fired++, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  again.start(0, 0);
  clock.advance(450); again.move(40, 0);                // a real move restarts the wait
  clock.advance(450);
  assert.equal(fired, 1);
  clock.advance(100);
  assert.equal(fired, 2);
});
test('createHold: cancel stops it, and nothing is left pending', () => {
  const clock = fakeClock();
  let fired = 0;
  const hold = S.createHold({ ms: 300, onHold: () => fired++, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  hold.start(0, 0);
  hold.cancel();
  clock.advance(1000);
  assert.equal(fired, 0);
  assert.equal(clock.pending(), 0);
  hold.move(500, 500);                                   // a late move after cancel is ignored
  assert.equal(clock.pending(), 0);
});
test('shipped hold defaults match the documented feel', () => {
  assert.equal(S.T.HOLD_MS, 550);
  assert.equal(S.T.HOLD_JITTER_PX, 7);
});
