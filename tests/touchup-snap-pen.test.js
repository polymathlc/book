/* The touch-up editor's ✨ hold-to-snap and 🖊️ pen select — the SHIPPED functions cut out of cer-touchup.js and
   run against stubs, with the real shape-snap.js. Every failure here is quiet in
   the app: a path that closes into the wrong polygon still looks like a
   selection, and a snap that forgets to restore the picture first stacks the
   shape on top of the freehand wobble it was meant to replace. */
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, make } from './shape-snap-fixtures.mjs';

const app = fs.readFileSync(new URL('../cer-touchup.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../shape-snap.js', import.meta.url), 'utf8');
function cut(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing shipped section: ${start}`);
  return app.slice(a, b);
}
const SNAP_PEN = cut('const ANNOT_SNAP_TOOLS', '// ---- SELECTION (rectangle / lasso)');
const SNAP45 = cut('function _annotSnap45(s, p)', '// Lock to the horizontal or vertical axis');
// The REAL pointer handlers too, so the order of my hooks inside them is under test.
const HANDLERS = cut('function _annotDown(e) {', 'function _annotPlaceText(p) {');

/* A fresh world per test: the real code, a recording canvas, controllable time. */
function world({ withLib = true, fakeHold = false } = {}) {
  const calls = [], toasts = [], frames = [];
  const ctx2d = new Proxy({}, {
    get: (_, k) => (k === 'canvas' ? null : (...a) => { calls.push([k, ...a]); }),
    set: (_, k, v) => { calls.push(['set', k, v]); return true; }
  });
  const holds = [];
  const sandbox = {
    console, Math, JSON, Object, Array, Number, String, Date, Infinity, NaN, isFinite,
    performance: { now: () => sandbox._now },
    _now: 1000,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    showToast: (m) => toasts.push(m),
    _annotDisplayScale: () => 1,
    _annotSelSyncBar: () => { sandbox._synced = (sandbox._synced || 0) + 1; },
    _annotPlotLine: (c, ...a) => calls.push(['plot', ...a]),
    _annotPaintCompose: () => calls.push(['compose']),
    _annotResetCompose: () => calls.push(['resetCompose']),
    _annotPt: (e) => ({ x: e.x, y: e.y, clientX: e.clientX ?? e.x, clientY: e.clientY ?? e.y }),
    document: { getElementById: () => sandbox._canvasEl },
    _canvasEl: { id: 'annotCanvas' },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (withLib) {
    vm.runInContext(lib, sandbox);
    if (fakeHold) {
      const real = sandbox.ShapeSnap.createHold;
      sandbox.ShapeSnap.createHold = (o) => { const h = { opts: o, cancelled: false, moves: [], start(x, y) { this.started = [x, y]; }, move(x, y) { this.moves.push([x, y]); }, cancel() { this.cancelled = true; }, held() { return false; } }; holds.push(h); return h; };
      sandbox._realCreateHold = real;
    }
  }
  Object.assign(sandbox, {
    _annotSyncControls: () => {}, _annotUpdateBrushRing: () => {}, _annotBrushLine: () => calls.push(['brushLine']),
    _annotPushHistory: () => { sandbox._annot.history.push({ img: 'BEFORE', w: sandbox._annot.canvas.width, h: sandbox._annot.canvas.height }); }
  });
  vm.runInContext(SNAP45 + '\n' + SNAP_PEN + '\n' + HANDLERS, sandbox);
  const call = (name, ...args) => { sandbox.__args = args; return vm.runInContext(`${name}(...__args)`, sandbox); };
  return { sb: sandbox, calls, toasts, frames, holds, run: (code) => vm.runInContext(code, sandbox), call };
}
/* Objects built inside the vm have another realm's prototypes, which strict
   deep-equality refuses: compare plain copies. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const ev = (x, y, extra = {}) => ({ x, y, clientX: x, clientY: y, shiftKey: false, altKey: false, target: null, ...extra });
const newEditor = (w, over = {}) => { w.sb._annot = { tool: 'penselect', drawing: false, sel: null, selPts: null, pen: null, history: [], size: 4, color: '#e23c3c', canvas: { width: 400, height: 300 }, ctx: new Proxy({}, { get: (_, k) => (...a) => w.calls.push([k, ...a]), set: (_, k, v) => { w.calls.push(['set', k, v]); return true; } }), ...over }; return w.sb._annot; };
const click = (w, x, y, extra) => { w.call('_annotPenDown', ev(x, y, extra), { x, y }); if (w.sb._annot.pen) w.sb._annot.pen.drag = null; w.sb._annot.drawing = false; };

/* ---------------- 🖊️ pen select ---------------- */
test('corner anchors close into the same polygon as a lasso, and replace the selection', () => {
  const w = world(); const a = newEditor(w);
  a.sel = { pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] };       // an earlier selection
  [[50, 50], [200, 50], [200, 150], [50, 150]].forEach(([x, y]) => click(w, x, y));
  assert.equal(a.sel, null, 'starting a new path drops the old selection');
  assert.equal(a.pen.anchors.length, 4);
  click(w, 52, 51);                                                          // back on the first anchor (within the 9px grab)
  assert.deepEqual(plain(a.sel.pts.map((p) => [p.x, p.y])), [[50, 50], [200, 50], [200, 150], [50, 150]]);
  assert.equal(a.pen, null, 'the path is consumed');
  assert.equal(a.drawing, false);
  assert.ok(w.toasts.some((t) => /selected/i.test(t)));
});
test('click-and-drag pulls symmetric handles, and a curved path flattens to many points', () => {
  const w = world(); const a = newEditor(w);
  w.call('_annotPenDown', ev(100, 100), { x: 100, y: 100 });
  w.call('_annotPenDrag', ev(160, 40));                    // drag out of the anchor
  w.run('_annot.pen.drag = null; _annot.drawing = false');
  const an = a.pen.anchors[0];
  assert.deepEqual(plain(an.hout), { x: 160, y: 40 });
  assert.deepEqual(plain(an.hin), { x: 40, y: 160 }, 'the other handle mirrors through the anchor');
  click(w, 300, 100); click(w, 200, 260);
  click(w, 100, 100);                                                        // close on the first anchor
  assert.ok(a.sel && a.sel.pts.length > 12, `curved sides are subdivided (${a.sel && a.sel.pts.length})`);
});
test('a plain click leaves a corner anchor — no handles — and the drag slop ignores a wobble', () => {
  const w = world(); const a = newEditor(w);
  w.call('_annotPenDown', ev(100, 100), { x: 100, y: 100 });
  w.call('_annotPenDrag', ev(102, 101));                   // 2px: inside the 4px slop
  assert.equal(a.pen.anchors[0].hout, undefined);
  assert.equal(a.pen.anchors[0].hin, undefined);
});
test('fewer than three anchors cannot close; Enter says so and keeps the path', () => {
  const w = world(); const a = newEditor(w);
  click(w, 10, 10); click(w, 80, 10);
  w.run('_annotPenClose()');
  assert.equal(a.pen.anchors.length, 2);
  assert.equal(a.sel, null);
  assert.ok(w.toasts.some((t) => /three/i.test(t)));
});
test('three collinear points enclose nothing: refused, and the path is dropped', () => {
  const w = world(); const a = newEditor(w);
  click(w, 10, 10); click(w, 80, 10); click(w, 150, 10);
  w.run('_annotPenClose()');
  assert.equal(a.sel, null);
  assert.equal(a.pen, null);
  assert.ok(w.toasts.some((t) => /no area/i.test(t)));
});
test('Backspace takes back the last anchor and the last one cancels the path', () => {
  const w = world(); const a = newEditor(w);
  click(w, 10, 10); click(w, 80, 10); click(w, 80, 90);
  w.run('_annotPenRemoveLast()');
  assert.equal(a.pen.anchors.length, 2);
  w.run('_annotPenRemoveLast()'); w.run('_annotPenRemoveLast()');
  assert.equal(a.pen, null);
  assert.equal(w.run('_annotPenActive()'), false);
});
test('Esc cancels the path and says whether anything was open', () => {
  const w = world(); const a = newEditor(w);
  assert.equal(w.run('_annotPenCancel()'), undefined, 'nothing to cancel');
  click(w, 10, 10); click(w, 90, 10);
  assert.equal(w.run('_annotPenCancel()'), 2);
  assert.equal(a.pen, null);
});
test('grabbing an existing anchor drags it (and its handles) instead of adding one', () => {
  const w = world(); const a = newEditor(w);
  w.call('_annotPenDown', ev(100, 100), { x: 100, y: 100 });
  w.call('_annotPenDrag', ev(150, 100));
  w.run('_annot.pen.drag = null; _annot.drawing = false');
  click(w, 300, 100); click(w, 300, 250);
  const before = a.pen.anchors.length;
  w.call('_annotPenDown', ev(300, 101), { x: 300, y: 101 });      // on anchor 1
  assert.equal(a.pen.anchors.length, before, 'no duplicate anchor');
  assert.equal(a.pen.drag.kind, 'move');
  w.call('_annotPenDrag', ev(330, 131));
  assert.deepEqual(plain([a.pen.anchors[1].x, a.pen.anchors[1].y]), [330, 130]);
  // dragging a handle of the smooth anchor keeps the pair in line unless Alt is held
  w.run('_annot.pen.drag = null');
  w.call('_annotPenDown', ev(150, 100), { x: 150, y: 100 });      // its out-handle
  w.call('_annotPenDrag', ev(160, 140));
  const an = a.pen.anchors[0];
  assert.deepEqual(plain(an.hout), { x: 160, y: 140 });
  assert.deepEqual(plain(an.hin), { x: 40, y: 60 });
});
test('Alt breaks the symmetry for one handle only', () => {
  const w = world(); const a = newEditor(w);
  w.call('_annotPenDown', ev(100, 100), { x: 100, y: 100 });
  w.call('_annotPenDrag', ev(150, 100));
  w.run('_annot.pen.drag = null; _annot.drawing = false');
  w.call('_annotPenDown', ev(150, 100, { altKey: true }), { x: 150, y: 100 });
  w.call('_annotPenDrag', ev(170, 160));
  assert.deepEqual(plain(a.pen.anchors[0].hout), { x: 170, y: 160 });
  assert.deepEqual(plain(a.pen.anchors[0].hin), { x: 50, y: 100 }, 'the other handle stays put');
});
test('a double-click ends an open path, like Photoshop', () => {
  const w = world(); const a = newEditor(w);
  click(w, 50, 50); click(w, 250, 50); click(w, 150, 200);
  w.sb._now += 120;
  w.call('_annotPenDown', ev(150, 201), { x: 150, y: 201 });    // again on the last point, quickly
  assert.ok(a.sel, 'closed by the double-click');
  assert.equal(a.sel.pts.length, 3, 'the double-click did not add a duplicate point');
});
test('a slow second click is just another anchor', () => {
  const w = world(); const a = newEditor(w);
  click(w, 50, 50); click(w, 250, 50); click(w, 150, 200);
  w.sb._now += 900;
  w.call('_annotPenDown', ev(150, 201), { x: 150, y: 201 });
  assert.equal(a.sel, null);
});
test('Shift locks a new anchor to 45° from the previous one', () => {
  const w = world(); const a = newEditor(w);
  click(w, 100, 100);
  click(w, 200, 112, { shiftKey: true });
  const p = a.pen.anchors[1];
  assert.ok(Math.abs(p.y - 100) < 1e-6, `snapped level: ${p.x},${p.y}`);
});
test('the hover cue only lights near the first anchor, and only once there are three', () => {
  const w = world(); const a = newEditor(w);
  click(w, 50, 50); click(w, 250, 50);
  w.call('_annotPenHover', ev(50, 52, { target: w.sb._canvasEl }));
  assert.equal(a.pen.closeHot, false, 'two anchors cannot close');
  click(w, 150, 200);
  w.call('_annotPenHover', ev(52, 52, { target: w.sb._canvasEl }));
  assert.equal(a.pen.closeHot, true);
  w.call('_annotPenHover', ev(150, 150, { target: w.sb._canvasEl }));
  assert.equal(a.pen.closeHot, false);
  w.call('_annotPenHover', ev(52, 52, { target: {} }));
  assert.equal(a.pen.closeHot, false, 'over a label or toolbar it ignores the pointer');
});
test('grab radius is in SCREEN pixels: zooming in does not make anchors easier to hit by accident', () => {
  const w = world(); const a = newEditor(w);
  w.sb._annotDisplayScale = () => 4;                                         // 400% zoom: 1 screen px = 0.25 image px
  click(w, 50, 50); click(w, 250, 50); click(w, 150, 200);
  w.call('_annotPenDown', ev(50, 54), { x: 50, y: 54 });        // 4 image px = 16 screen px away
  assert.equal(a.sel, null, 'too far to count as the first anchor at this zoom');
  assert.equal(a.pen.anchors.length, 4);
});
test('drawing the preview never throws and leaves the shared context as it found it', () => {
  const w = world(); const a = newEditor(w);
  click(w, 50, 50); click(w, 250, 50);
  const rec = [];
  const sctx = new Proxy({}, { get: (_, k) => (...x) => rec.push(k), set: () => true });
  w.sb._sctx = sctx;
  w.run('_annotPenDraw(_sctx, _annot.pen, 1)');
  assert.equal(rec[0], 'save');
  assert.equal(rec[rec.length - 1], 'restore');
});

/* ---------------- ✨ hold to snap: paint ---------------- */
function paintWorld(strokeBuilder, size = 220) {
  const w = world({ fakeHold: true });
  const a = newEditor(w, { tool: 'paint', drawing: true, history: [{ img: 'BEFORE', w: 400, h: 300 }], shiftSeg: null });
  const pts = strokeBuilder(rng(5), size);
  w.call('_annotSnapBegin', ev(pts[0].x, pts[0].y), pts[0]);
  a.snapPts = pts.map((p) => ({ x: p.x, y: p.y }));
  a.last = pts[pts.length - 1];
  return { w, a, pts };
}
test('a held straight stroke goes back to the picture as it was, then paints ONE straight segment', () => {
  const { w, a, pts } = paintWorld((r, s) => make.line(r, s, 12));
  assert.equal(w.holds.length, 1, 'a hold was started');
  w.holds[0].opts.onHold();
  assert.ok(a.snapDesc && a.snapDesc.kind === 'line');
  const put = w.calls.findIndex((c) => c[0] === 'putImageData');
  assert.equal(w.calls[put][1], 'BEFORE', 'restored from the history step pushed at pointer-down');
  const strokeAt = w.calls.findIndex((c, i) => i > put && c[0] === 'stroke');
  assert.ok(strokeAt > put, 'the shape is painted AFTER the restore');
  const lines = w.calls.filter((c, i) => i > put && c[0] === 'lineTo');
  assert.equal(lines.length, 1, 'a line is one segment');
  assert.deepEqual(plain(a.last), { x: lines[0][1], y: lines[0][2] }, 'the Shift-click anchor continues from the snapped end');
  assert.ok(w.toasts.some((t) => /straight line/i.test(t)));
});
test('a held circle repaints as a closed smooth outline, with the brush settings', () => {
  const { w, a } = paintWorld((r, s) => make.circle(r, s));
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc.kind, 'circle');
  const widths = w.calls.filter((c) => c[0] === 'set' && c[1] === 'lineWidth').map((c) => c[2]);
  assert.ok(widths.includes(4), 'uses the brush size');
  assert.ok(w.calls.filter((c) => c[0] === 'lineTo').length >= 80);
  assert.ok(w.calls.some((c) => c[0] === 'compose'), 'paint mode set the way the freehand stroke did');
  assert.ok(w.calls.some((c) => c[0] === 'resetCompose'), '…and put back, so nothing is stranded in destination-out');
});
test('a 1px brush plots crisp pixels along the shape instead of stroking it', () => {
  const { w, a } = paintWorld((r, s) => make.rect(r, s, s * 0.6, 0));
  a.size = 1;
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc.kind, 'rect');
  assert.equal(w.calls.filter((c) => c[0] === 'plot').length, 4);
  assert.equal(w.calls.filter((c) => c[0] === 'stroke').length, 0);
});
test('after the snap the pointer adjusts the shape, repainting at most once per frame', () => {
  const { w, a } = paintWorld((r, s) => make.circle(r, s));
  w.holds[0].opts.onHold();
  const r0 = a.snapDesc.r, c = a.snapDesc.c;
  const puts0 = w.calls.filter((x) => x[0] === 'putImageData').length;
  w.call('_annotSnapAdjust', { x: c.x + r0 * 2, y: c.y });
  w.call('_annotSnapAdjust', { x: c.x + r0 * 3, y: c.y });
  assert.ok(Math.abs(a.snapDesc.r - r0 * 3) < 1e-6);
  assert.equal(w.frames.length, 1, 'two moves, one scheduled repaint');
  w.frames[0]();
  assert.equal(w.calls.filter((x) => x[0] === 'putImageData').length, puts0 + 1);
});
test('a stroke that is not a clean shape is left as freehand ink — nothing is restored or painted', () => {
  const { w, a } = paintWorld((r, s) => make.zigzag(r, s));
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc, null);
  assert.equal(w.calls.filter((c) => c[0] === 'putImageData').length, 0);
  assert.equal(w.toasts.length, 0);
});
test('no clean "before" picture (history gone or resized) means no snap, never a corrupted picture', () => {
  const { w, a } = paintWorld((r, s) => make.line(r, s, 12));
  a.history = [];
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc, null);
  const { w: w2, a: a2 } = paintWorld((r, s) => make.line(r, s, 12));
  a2.history = [{ img: 'X', w: 10, h: 10 }];
  w2.holds[0].opts.onHold();
  assert.equal(a2.snapDesc, null, 'history entry of another size is not a valid "before"');
});
test('a Shift-locked segment is never snapped', () => {
  const { w, a } = paintWorld((r, s) => make.line(r, s, 12));
  a.shiftSeg = { start: { x: 0, y: 0 }, snap: 'x' };
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc, null);
});
test('releasing the pointer ends the watch: no hold, no pending repaint', () => {
  const { w, a } = paintWorld((r, s) => make.circle(r, s));
  w.holds[0].opts.onHold();
  w.call('_annotSnapAdjust', { x: 1, y: 1 });
  w.run('_annotSnapEnd()');
  assert.equal(w.holds[0].cancelled, true);
  assert.equal(a.snapHold, null);
  assert.equal(a.snapPts, null);
  assert.equal(a.snapDesc, null);
});
test('only Paint and Lasso watch for a hold — Erase, Clone and the rest never snap', () => {
  for (const tool of ['erase', 'clone', 'history', 'fill', 'line', 'select', 'move']) {
    const w = world({ fakeHold: true });
    newEditor(w, { tool, drawing: true });
    w.call('_annotSnapBegin', ev(5, 5), { x: 5, y: 5 });
    assert.equal(w.holds.length, 0, tool);
  }
});
test('the hold fires only while a stroke is actually being drawn', () => {
  const { w, a } = paintWorld((r, s) => make.line(r, s, 12));
  a.drawing = false;
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc, null);
});
test('without shape-snap.js the tools stay plain ink and the pen says why', () => {
  const w = world({ withLib: false });
  const a = newEditor(w, { tool: 'paint', drawing: true, history: [{ img: 'B', w: 400, h: 300 }] });
  w.call('_annotSnapBegin', ev(5, 5), { x: 5, y: 5 });
  assert.ok(!a.snapHold, 'no hold without the library');
  w.run('_annotSnapFire()');                                                  // must not throw
  w.call('_annotSnapAdjust', { x: 1, y: 1 });
  a.tool = 'penselect';
  w.call('_annotPenDown', ev(5, 5), { x: 5, y: 5 });
  assert.ok(w.toasts.some((t) => /shape-snap/i.test(t)));
  assert.equal(a.pen, null);
});

/* ---------------- ✨ hold to snap: lasso ---------------- */
test('a held lasso loop becomes a clean closed outline that finalises as the selection', () => {
  const w = world({ fakeHold: true });
  const a = newEditor(w, { tool: 'lasso', drawing: true });
  const pts = make.circle(rng(9), 200);
  a.selPts = pts.map((p) => ({ x: p.x, y: p.y }));
  w.call('_annotSnapBegin', ev(pts[0].x, pts[0].y), pts[0]);
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc.kind, 'circle');
  assert.ok(a.selPts.length >= 80);
  assert.deepEqual(plain(a.selPts[0]), plain(a.selPts[a.selPts.length - 1]), 'a closed outline');
  const c = a.snapDesc.c;
  w.call('_annotSnapAdjust', { x: c.x + 250, y: c.y });
  assert.ok(a.snapDesc.r > 240, 'dragging resizes the outline');
  assert.equal(w.frames.length, 0, 'no pixel repaint for a selection outline');
});
test('a held lasso that is only a line selects nothing: it stays as drawn', () => {
  const w = world({ fakeHold: true });
  const a = newEditor(w, { tool: 'lasso', drawing: true });
  const pts = make.line(rng(2), 200, 20);
  a.selPts = pts.map((p) => ({ x: p.x, y: p.y }));
  const before = JSON.stringify(a.selPts);
  w.call('_annotSnapBegin', ev(pts[0].x, pts[0].y), pts[0]);
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc, null);
  assert.equal(JSON.stringify(a.selPts), before);
});

/* ---------------- the REAL pointer handlers, end to end ---------------- */
const pe = (x, y, extra = {}) => ({ x, y, clientX: x, clientY: y, shiftKey: false, altKey: false, preventDefault() {}, target: null, ...extra });
function drive(w, tool, stroke, { size = 4 } = {}) {
  const a = newEditor(w, { tool, size, drawing: false, history: [], anchor: null });
  w.call('_annotDown', pe(stroke[0].x, stroke[0].y));
  for (const q of stroke.slice(1)) w.call('_annotMove', pe(q.x, q.y));
  return a;
}
test('Paint, end to end: down → moves → hold → snap → drag → up leaves one clean shape', () => {
  const w = world({ fakeHold: true });
  const stroke = make.circle(rng(12), 180);
  const a = drive(w, 'paint', stroke);
  assert.equal(w.holds.length, 1, 'pointer-down started watching');
  assert.ok(a.snapPts.length >= stroke.length - 1, 'every freehand move was recorded for the recogniser');
  assert.ok(w.holds[0].moves.length >= stroke.length - 1, 'every move was reported to the hold timer');
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc.kind, 'circle');
  const lines0 = w.calls.filter((c) => c[0] === 'lineTo').length;
  w.call('_annotMove', pe(stroke[0].x + 300, stroke[0].y));            // keep dragging: adjusts, draws no more ink
  assert.equal(w.calls.filter((c) => c[0] === 'lineTo').length, lines0, 'no freehand segment was added after the snap');
  assert.equal(w.frames.length, 1);
  w.call('_annotUp');
  assert.equal(a.drawing, false);
  assert.equal(w.holds[0].cancelled, true, 'lifting stops the watch');
  assert.equal(a.snapDesc, null);
  assert.equal(a.history.length, 1, 'ONE undo step for the whole stroke');
});
test('Paint, end to end: a quick stroke with no hold is plain freehand ink, byte for byte', () => {
  const w = world({ fakeHold: true });
  const stroke = make.circle(rng(12), 180);
  const a = drive(w, 'paint', stroke);
  const lines = w.calls.filter((c) => c[0] === 'lineTo').length;
  assert.equal(lines, stroke.length - 1, 'one segment per move, as before');
  w.call('_annotUp');
  assert.equal(w.calls.filter((c) => c[0] === 'putImageData').length, 0);
  assert.equal(a.snapDesc, null);
});
test('Paint, end to end: Erase is never snapped even if the stroke is a perfect circle', () => {
  const w = world({ fakeHold: true });
  const a = drive(w, 'erase', make.circle(rng(12), 180));
  assert.equal(w.holds.length, 0);
  assert.equal(a.snapPts, undefined);
});
test('Paint, end to end: shift-click straight segments and the hold do not fight', () => {
  const w = world({ fakeHold: true });
  const a = newEditor(w, { tool: 'paint', drawing: false, history: [], anchor: { x: 10, y: 10 } });
  w.call('_annotDown', pe(200, 100, { shiftKey: true }));            // click-then-Shift-click straight line
  assert.equal(w.holds.length, 0, 'the straight join is already a straight line: nothing to snap');
  w.call('_annotUp');
  assert.equal(a.drawing, false);
});
test('Lasso, end to end: a held loop finalises as the clean outline, and selects it', () => {
  const w = world({ fakeHold: true });
  const stroke = make.ellipse(rng(14), 220, 0.5, 20);
  const a = drive(w, 'lasso', stroke);
  assert.equal(w.holds.length, 1);
  w.holds[0].opts.onHold();
  assert.equal(a.snapDesc.kind, 'ellipse');
  w.call('_annotUp');
  assert.ok(a.sel && a.sel.pts.length >= 80, 'the selection is the snapped outline');
  assert.equal(a.selPts, null);
  const ys = a.sel.pts.map((p) => p.y), xs = a.sel.pts.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 150);
});
test('Lasso, end to end: a loop that is not held keeps every freehand point', () => {
  const w = world({ fakeHold: true });
  const stroke = make.ellipse(rng(14), 220, 0.5, 20);
  const a = drive(w, 'lasso', stroke);
  w.call('_annotUp');
  assert.equal(a.sel.pts.length, stroke.length, 'the freehand outline is exactly what was drawn');
});
test('Pen select, end to end through the real handlers: click, click, click, close on the first', () => {
  const w = world();
  const a = newEditor(w, { tool: 'penselect', drawing: false });
  for (const [x, y] of [[40, 40], [220, 50], [200, 180]]) {
    w.sb._now += 600;                                                 // slower than a double-click
    w.call('_annotDown', pe(x, y));
    assert.equal(a.drawing, true, 'a drag is in progress while the button is down');
    w.call('_annotUp');
    assert.equal(a.drawing, false);
  }
  assert.equal(a.pen.anchors.length, 3);
  w.sb._now += 600;
  w.call('_annotDown', pe(41, 41));                                   // the first anchor again
  assert.ok(a.sel && a.sel.pts.length === 3);
  assert.equal(a.pen, null);
  w.call('_annotUp');
  assert.ok(a.sel, 'the matching pointer-up does not undo the selection');
});
test('Pen select, end to end: a click-drag through _annotMove pulls out handles', () => {
  const w = world();
  const a = newEditor(w, { tool: 'penselect', drawing: false });
  w.call('_annotDown', pe(100, 100));
  w.call('_annotMove', pe(140, 70));
  w.call('_annotUp');
  assert.deepEqual(plain(a.pen.anchors[0].hout), { x: 140, y: 70 });
  assert.equal(a.pen.drag, null);
  assert.equal(a.drawing, false);
});
