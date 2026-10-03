/* CER manual touch-up toolkit, adapted from polymathlc/cer. See CER_TOUCHUP.md. */
(() => {
let bookApply = null;
const showToast = (message) => window.dispatchEvent(new CustomEvent('book-toast', {detail: message}));
const _loadImageEl = src => new Promise((resolve, reject) => { const img = new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('Image could not be loaded')); img.src=src; });
const PAPER_WHITE_MIN = 200;
// How much of the picture the near-white background has to be. A bright patch
// in a photograph is not a page.
const PAPER_BG_MIN = 0.30;
// How far below the measured white point still counts as background. The weave
// is only a few units deep and a grey scan a couple of dozen; a deliberate pale
// grey fill in a diagram sits well below this and is kept.
const PAPER_TEX_DEPTH = 20;
// …and how far from grey a background pixel may drift. A pale wash of real
// colour — the blue of water in a beaker — is part of the drawing, whatever
// its brightness.
const PAPER_TEX_CHROMA = 22;
// The picture must have line work to be worth protecting: below this there is
// no drawing here, so there is nothing this pass can be said to be cleaning.
const PAPER_INK_MIN = 0.004;
// Ink is what must survive the pass untouched. Nothing at or below this
// brightness is ever written to, by construction — the assertion is in the
// harness, because "the pass ate the diagram" is the one failure that would
// look like a beautifully clean picture.
const PAPER_INK_MAX = 128;

// Where the paper's white sits. The 98th percentile rather than the maximum:
// one stray blown-out pixel must not set the white point for the whole page,
// and with a background covering most of the picture the 98th percentile lands
// squarely in it. Transparent pixels are not paper and are left out entirely.
function _paperWhitePoint(px) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const l = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    hist[l]++; n++;
  }
  if (!n) return { white: 0, n: 0 };
  const want = n * 0.98;
  let seen = 0, white = 255;
  for (let l = 0; l < 256; l++) { seen += hist[l]; if (seen >= want) { white = l; break; } }
  return { white, n, hist };
}

// The pass itself, over a raw RGBA buffer, in place. Returns a report; the
// caller decides what to say about it. `ok:false` means NOTHING was written —
// a refusal is all-or-nothing on purpose, because a picture that has been
// half-cleaned is worse than one that was left alone.
function _paperCleanPixels(px, w, h) {
  const { white, n, hist } = _paperWhitePoint(px);
  if (!n) return { ok: false, reason: 'empty', white: 0, changed: 0 };
  if (white < PAPER_WHITE_MIN) return { ok: false, reason: 'no-white', white, changed: 0 };

  const floor = white - PAPER_TEX_DEPTH;
  let bg = 0, ink = 0;
  for (let l = 0; l < 256; l++) { if (l >= floor) bg += hist[l]; else if (l <= PAPER_INK_MAX) ink += hist[l]; }
  if (bg / n < PAPER_BG_MIN) return { ok: false, reason: 'not-paper', white, changed: 0 };
  if (ink / n < PAPER_INK_MIN) return { ok: false, reason: 'no-ink', white, changed: 0 };

  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;                       // a hole stays a hole
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = (r * 299 + g * 587 + b * 114) / 1000 | 0;
    if (l < floor) continue;                           // the drawing
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma > PAPER_TEX_CHROMA) continue;           // a pale wash of real colour
    if (r === 255 && g === 255 && b === 255) continue; // already paper
    px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
    changed++;
  }
  return { ok: true, reason: 'cleaned', white, changed, bg: bg / n, ink: ink / n };
}

(function injectAnnotStyles() {
  const css = `
  .annot-tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:center; margin-bottom:12px; }
  .annot-tool { padding:6px 12px; border:1.5px solid var(--border,#e3e6e4); background:#fff; border-radius:8px; cursor:pointer; font-size:0.82rem; }
  .annot-tool:hover { border-color:var(--primary,#0b6b4f); }
  .annot-tool.active { border-color:var(--primary,#0b6b4f); background:var(--primary-light,#e8f3ec); color:var(--primary,#0b6b4f); font-weight:700; }
  /* The paint bucket shows what it will pour: the strip along its base (and the
     drip) are the exact colour currently chosen, updated live with the picker. */
  .annot-bucket { width:17px; height:18px; vertical-align:-4px; margin-right:2px; overflow:visible; }
  .annot-bucket-paint { fill:var(--annot-paint,#e23c3c); stroke:rgba(0,0,0,0.28); stroke-width:0.7; }
  .annot-tools kbd, .hint kbd { font-family:'Space Mono',monospace; font-size:0.72em; padding:1px 5px; border:1px solid var(--border,#e3e6e4);
    border-bottom-width:2px; border-radius:4px; background:var(--surface,#fff); white-space:nowrap; }
  #annotStage.moving #annotCanvas { cursor:move; }
  #annotStage { position:relative; display:block; margin:0 auto; width:86vw; max-width:1080px; height:56vh; overflow:hidden; line-height:0; background:#eef0ee; border:1px solid var(--border,#e3e6e4); border-radius:6px; touch-action:none; }
  /* The canvas keeps its alpha, so a sprite that has already had its background
     removed is edited transparent. This grey check behind it is how you can SEE
     which parts are empty — a card-art slot is often a cut-out. It is only ever
     visible where the picture is transparent, so an ordinary opaque question
     image looks exactly as it always did. (This is the editor's own backdrop,
     not something painted into a picture — the chequerboard an image model
     paints is a different thing entirely, and still banned in prompts.) */
  #annotCanvas { position:absolute; top:0; left:0; transform-origin:0 0; touch-action:none; cursor:crosshair; image-rendering:auto;
    background-color:#fbfbfb;
    background-image:linear-gradient(45deg,#dfe2df 25%,transparent 25%,transparent 75%,#dfe2df 75%),linear-gradient(45deg,#dfe2df 25%,transparent 25%,transparent 75%,#dfe2df 75%);
    background-size:16px 16px; background-position:0 0,8px 8px; }
  #annotSelCanvas { position:absolute; top:0; left:0; transform-origin:0 0; pointer-events:none; z-index:4; }
  #annotCanvas.pixelated { image-rendering:pixelated; image-rendering:crisp-edges; }
  #annotStage.panning, #annotStage.panning #annotCanvas { cursor:grabbing; }
  #annotStage.canpan #annotCanvas { cursor:grab; }
  .annot-textbox { position:absolute; z-index:5; }
  /* With the Move tool active the whole label is a drag target, not just its
     handle — that is what "move" means, and hunting for a 6px tab is not it. */
  .annot-textbox.movable .annot-textbox-input { cursor:move; }
  .annot-textbox-input { border:1px dashed var(--primary,#0b6b4f); background:rgba(255,255,255,0.92); border-radius:4px; outline:none; font-family:'DM Sans',sans-serif; font-weight:600; padding:1px 4px; line-height:1.3; min-width:60px; color:inherit; }
  .annot-textbox-handle { position:absolute; top:-19px; left:-1px; cursor:move; user-select:none; touch-action:none; background:var(--primary,#0b6b4f); color:#fff; font-size:11px; line-height:1; padding:3px 6px; border-radius:4px 4px 0 0; white-space:nowrap; }
  #annotCloneSrc { position:absolute; z-index:6; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; border:2px solid #2d6ca8; background:rgba(37,99,235,0.18); box-shadow:0 0 0 1px rgba(255,255,255,0.8); pointer-events:none; }
  #annotCloneSrc::before, #annotCloneSrc::after { content:''; position:absolute; background:#2d6ca8; }
  #annotCloneSrc::before { left:6px; top:1px; width:2px; height:12px; }
  #annotCloneSrc::after { top:6px; left:1px; height:2px; width:12px; }
  /* The brush cursor: a ring the exact size of the mark about to be made, at
     the current zoom. Black ring inside a white one, so it stays visible on a
     white page and on black card art alike. */
  #annotBrushRing { position:absolute; z-index:7; box-sizing:border-box; border-radius:50%; pointer-events:none; display:none;
    border:1px solid rgba(0,0,0,0.9); box-shadow:0 0 0 1px rgba(255,255,255,0.9), inset 0 0 0 1px rgba(255,255,255,0.9); }
  /* Under a few screen pixels a circle is just a blob — draw a crosshair, the
     way every paint program does for a tiny brush. */
  #annotBrushRing.tiny { border-color:transparent; box-shadow:none; }
  #annotBrushRing.tiny::before, #annotBrushRing.tiny::after { content:''; position:absolute; background:rgba(0,0,0,0.85); box-shadow:0 0 0 1px rgba(255,255,255,0.9); }
  #annotBrushRing.tiny::before { left:50%; top:50%; width:1px; height:11px; margin:-5.5px 0 0 -0.5px; }
  #annotBrushRing.tiny::after { left:50%; top:50%; height:1px; width:11px; margin:-0.5px 0 0 -5.5px; }
  /* Clone stamp: the ring is FILLED with the pixels that would be stamped, so
     the mark is aimed by looking at it rather than by counting across from the
     source pin. The ring goes white-on-black while it is showing a picture —
     a black hairline over arbitrary artwork is the one thing that disappears. */
  #annotBrushRing.peeking { border-color:rgba(255,255,255,0.95); box-shadow:0 0 0 1px rgba(0,0,0,0.85), 0 2px 10px rgba(0,0,0,0.35); }
  #annotClonePeek { position:absolute; inset:0; width:100%; height:100%; border-radius:50%; display:none; pointer-events:none; }
  #annotBrushRing.peeking #annotClonePeek { display:block; }
  #annotClonePeek.pixelated { image-rendering:pixelated; image-rendering:crisp-edges; }
  #annotBrushHud { position:absolute; z-index:8; pointer-events:none; opacity:0; transition:opacity 0.16s ease; transform:translateX(-50%);
    background:rgba(17,20,18,0.88); color:#fff; font-family:'DM Sans',sans-serif; font-size:11px; font-weight:700; line-height:1;
    padding:5px 8px; border-radius:6px; white-space:nowrap; font-variant-numeric:tabular-nums; }
  #annotBrushHud.show { opacity:1; }`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

let _annot = null;

function _annotOpenSrc(srcP, target, title) {
  srcP.then(_loadImageEl).then(img => {
    const canvas = document.getElementById('annotCanvas');
    // Keep the working canvas — and the ten full-frame undo snapshots behind
    // it — sane. A question's diagram never needs more; the 🎨 Photo Editor is
    // handed real photographs and the point of it is the file you take away,
    // so it gets a bigger ceiling and SAYS when it had to use it. A download
    // that is quietly smaller than what went in is the one thing a picture
    // editor must never do without saying so.
    const cap = target.standalone ? ANNOT_MAX_PX_STANDALONE : ANNOT_MAX_PX;
    const wasW = img.naturalWidth || 1, wasH = img.naturalHeight || 1;
    if (wasW * wasH > 24000000 || Math.max(wasW, wasH) > 16384) throw new Error('This image is too large for touch-up. The original is kept unchanged.');
    const scale = 1;
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const selCanvas = document.getElementById('annotSelCanvas');
    if (selCanvas) { selCanvas.width = canvas.width; selCanvas.height = canvas.height; }
    // The picture exactly as it was opened, kept for the history brush to paint
    // back from. It is never written to, so "the original" stays the original
    // however many edits are stacked on top.
    const orig = document.createElement('canvas');
    orig.width = canvas.width; orig.height = canvas.height;
    orig.getContext('2d').drawImage(canvas, 0, 0);
    _annot = { blockId: target.blockId || null, artSlot: target.artSlot || null,
      // Where ✓ Apply writes it back to. Adding a destination is a field here
      // and a branch in applyAnnotTool — never a second editor.
      akQuestion: !!target.akQuestion, akBlockId: target.akBlockId || null, standalone: !!target.standalone,
      // WHAT ERASE LEAVES BEHIND. A scanned question is paper, so erasing a
      // word means painting it white. A piece of game art stands on nothing, so
      // erasing means erasing — real transparency, not a white patch. The
      // default follows what is being edited; the toolbar button flips it.
      // A scanned question is paper, so erasing a word means painting it
      // white. Game art and anything in the Photo Editor stand on nothing, and
      // the file that leaves is a PNG, so there erasing means erasing.
      eraseTo: (target.artSlot || target.standalone) ? 'clear' : 'white',
      canvas, ctx, tool: 'erase', color: '#e23c3c', size: 6, tol: 32, drawing: false, history: [], start: null, snap: null,
      zoom: 1, fit: 1, panX: 0, panY: 0, space: false, panning: false, cloneSrc: null, cloneSnap: null, cloneOff: null,
      anchor: null, sel: null, selPts: null, selCanvas, aiFillBusy: false, origSnap: orig, float: null, xform: null, xfStart: null,
      // Where the pointer is, in STAGE coordinates, and how long the size badge
      // stays up after a change — see the brush cursor below.
      ptr: null, ptrIn: false, hudUntil: 0, hudTimer: null };
    _annotSelSyncBar();
    _annotAiBarInit();
    if (!_annotAntsRunning) _annotAntsLoop();
    _annotSyncControls();
    _annotBindSliderWheel();
    _annotSetTool('erase');
    _annotSyncEraseTo();
    const head = document.querySelector('#annotOverlay .overlay-head h3');
    if (head) head.textContent = title || '✏️ Touch up &amp; label';
    document.getElementById('annotOverlay').classList.add('show');
    // Fit the image after the overlay is visible so the stage has real dimensions.
    requestAnimationFrame(() => { annotZoomFit(); });
    _annotBindZoomListeners();
    if (scale < 1) {
      showToast('This picture was scaled to ' + canvas.width + '×' + canvas.height +
        ' to edit (it came in at ' + wasW + '×' + wasH + ') — anything you save will be that size', 'info');
    }
  }).catch(e => { console.warn('open annot', e); showToast(e.message || 'Could not open touch-up for this image', 'error'); });
}
// Does the eraser CUT rather than paint white?
function annotEraseClears() { return !!(_annot && _annot.eraseTo === 'clear'); }
function annotToggleEraseTo() {
  if (!_annot) return;
  _annot.eraseTo = annotEraseClears() ? 'white' : 'clear';
  _annotSyncEraseTo();
  showToast(annotEraseClears()
    ? '🩹 Erase now cuts the picture away — transparent, not white'
    : '🩹 Erase now paints white, for erasing words off paper', 'info');
}
function _annotSyncEraseTo() {
  const b = document.getElementById('annotEraseTo');
  if (!b) return;
  const clear = annotEraseClears();
  b.innerHTML = clear ? '▨ Erase to: <b>transparent</b>' : '⬜ Erase to: <b>white</b>';
  b.classList.toggle('on', clear);
  b.title = clear
    ? 'Erase, the paint bucket and Delete all cut the picture away to nothing — the right thing for card art, sprites and effect frames, which stand on a transparent background. Click to paint white instead.'
    : 'Erase and the paint bucket paint WHITE — the right thing for rubbing a word off a scanned question. Click to cut the picture away to transparent instead.';
}
// Put the canvas into the right mode for the tool about to draw, and set the
// colour. `destination-out` is what turns a brush stroke into a real hole
// instead of a white one; _annotUp puts the mode back.
function _annotPaintCompose(ctx) {
  const clear = _annot.tool === 'erase' && annotEraseClears();
  ctx.strokeStyle = clear ? '#000000' : (_annot.tool === 'erase' ? '#ffffff' : _annot.color);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalCompositeOperation = clear ? 'destination-out' : 'source-over';
  return clear;
}
function _annotResetCompose() {
  if (_annot && _annot.ctx) _annot.ctx.globalCompositeOperation = 'source-over';
}
function _annotSyncControls() {
  const col = document.getElementById('annotColor'), sz = document.getElementById('annotSize'), tl = document.getElementById('annotTol');
  const _sizeWas = _annot ? _annot.size : 0;
  if (_annot) {
    if (col) _annot.color = col.value || _annot.color;
    if (sz) _annot.size = parseInt(sz.value, 10) || _annot.size;
    if (tl) { const t = parseInt(tl.value, 10); _annot.tol = isNaN(t) ? _annot.tol : t; }
    const lbl = document.getElementById('annotSizeVal');
    if (lbl) lbl.innerHTML = _annot.size + '&nbsp;px';
    const tlbl = document.getElementById('annotTolVal');
    if (tlbl) tlbl.textContent = _annot.tol;
    // Every route to the size — the slider, the wheel, [ and ] — lands here, so
    // this is the one place that has to say what it did on the picture itself.
    if (_annot.size !== _sizeWas) _annotBrushFlash(); else _annotUpdateBrushRing();
  }
  // The bucket icon always shows the colour it would pour, open tool or not.
  const bucket = document.querySelector('.annot-tool[data-atool="fill"]');
  if (bucket && col) bucket.style.setProperty('--annot-paint', col.value || '#e23c3c');
}
// Nudge the brush size from a key or the mouse wheel, keeping the slider,
// the label and _annot in step.
function _annotStepSize(delta) {
  const sz = document.getElementById('annotSize');
  if (!sz) return;
  const min = parseInt(sz.min, 10) || 1, max = parseInt(sz.max, 10) || 60;
  sz.value = String(Math.min(max, Math.max(min, (parseInt(sz.value, 10) || 1) + delta)));
  _annotSyncControls();
}
function _annotStepTol(delta) {
  const tl = document.getElementById('annotTol');
  if (!tl) return;
  const min = parseInt(tl.min, 10) || 0, max = parseInt(tl.max, 10) || 120;
  tl.value = String(Math.min(max, Math.max(min, (parseInt(tl.value, 10) || 0) + delta)));
  _annotSyncControls();
}
// Scroll over either slider to change it — the wheel is the natural gesture for
// a value you are adjusting by feel, and the page must not scroll underneath.
function _annotBindSliderWheel() {
  const xstep = field => d => { const x = _annot && _annot.xform; if (x) annotXformSet(field, (x[field] || 0) + d); };
  // The size boxes step in percent, so a wheel over them resizes by feel too.
  const sstep = field => d => {
    const x = _annot && _annot.xform; if (!x) return;
    const cur = Math.abs(field === 'sx' ? _annotXformSx(x) : _annotXformSy(x)) * 100;
    annotXformSetScale(field, cur + d);
  };
  [['annotSize', _annotStepSize, 1], ['annotTol', _annotStepTol, 4],
   ['annotXformAngle', xstep('angle'), 1], ['annotXformSkewX', xstep('skewX'), 1], ['annotXformSkewY', xstep('skewY'), 1],
   ['annotXformSxNum', sstep('sx'), 1], ['annotXformSyNum', sstep('sy'), 1]
  ].forEach(([id, step, mult]) => {
    const el = document.getElementById(id);
    if (!el || el._wheelBound) return;
    el._wheelBound = true;
    el.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      step((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? mult * 5 : mult));
    }, { passive: false });
  });
}
// ---- Zoom & pan (Photoshop-style): the canvas is transformed inside a fixed
// viewport; scroll zooms toward the cursor, Space/middle-drag pans. ----
const ANNOT_MAX_DISPLAY = 40;   // up to 40 screen px per image pixel — see individual pixels
function _annotDisplayScale() { return _annot ? _annot.fit * _annot.zoom : 1; }
function _annotUpdateTransform() {
  if (!_annot) return;
  const c = _annot.canvas, s = _annotDisplayScale();
  c.style.transform = 'translate(' + _annot.panX + 'px,' + _annot.panY + 'px) scale(' + s + ')';
  c.classList.toggle('pixelated', s >= 3);   // crisp pixels once magnified
  if (_annot.selCanvas) _annot.selCanvas.style.transform = c.style.transform;   // marching ants ride along
  const zl = document.getElementById('annotZoomVal');
  if (zl) zl.textContent = Math.round(s * 100) + '%';
  _annotUpdateCloneMarker();   // the source pin rides along with zoom / pan
  _annotUpdateBrushRing();     // ... and so does the brush ring: it is drawn at the zoomed size
}
// A small pin marking the clone-stamp source point, kept aligned under zoom/pan.
function _annotUpdateCloneMarker() {
  const st = document.getElementById('annotStage'); if (!st) return;
  let m = document.getElementById('annotCloneSrc');
  const show = _annot && _annot.tool === 'clone' && _annot.cloneSrc;
  if (!show) { if (m) m.style.display = 'none'; return; }
  if (!m) { m = document.createElement('div'); m.id = 'annotCloneSrc'; st.appendChild(m); }
  const s = _annotDisplayScale();
  m.style.display = 'block';
  m.style.left = (_annot.panX + _annot.cloneSrc.x * s) + 'px';
  m.style.top = (_annot.panY + _annot.cloneSrc.y * s) + 'px';
}
// ---- The brush cursor — what you are about to paint with, drawn on the picture
// -----------------------------------------------------------------------------
// A brush whose size you can only read as a number on a slider is a brush you
// are guessing with: "12 px" at 40% zoom is a quarter of the mark "12 px" makes
// at 400%. So every size-driven tool shows its real footprint under the pointer,
// at the current zoom, the way Photoshop does — erase, paint, clone, history and
// the line tool, whose thickness IS the brush size. The tools that take no size
// (fill, wand, select, lasso, move, the transforms, text) keep their own cursor
// and deliberately show no ring; a circle round a paint bucket would be a lie.
const ANNOT_RING_TOOLS = { erase: 1, paint: 1, clone: 1, history: 1, line: 1 };
const ANNOT_RING_TINY = 7;     // under this many screen px a circle is a blob: draw a crosshair instead
const ANNOT_HUD_MS = 1200;     // how long the "12 px" badge stays up after a size change
// The ring and its badge live in the STAGE, like the clone-source pin — not on
// the canvas, which is scaled and panned underneath them.
function _annotRingEls(make) {
  const st = document.getElementById('annotStage');
  if (!st) return null;
  let ring = document.getElementById('annotBrushRing'), hud = document.getElementById('annotBrushHud');
  if (!ring && make) {
    ring = document.createElement('div'); ring.id = 'annotBrushRing';
    // The clone preview lives INSIDE the ring, so it is positioned, sized and
    // hidden by exactly the code that already does all three for the ring.
    const pk = document.createElement('canvas'); pk.id = 'annotClonePeek'; ring.appendChild(pk);
    st.appendChild(ring);
  }
  if (!hud && make) { hud = document.createElement('div'); hud.id = 'annotBrushHud'; st.appendChild(hud); }
  return ring ? { st, ring, hud } : null;
}
function _annotBrushRingVisible() {
  if (!_annot || !ANNOT_RING_TOOLS[_annot.tool]) return false;
  if (_annot.space || _annot.panning) return false;                 // pan mode has its own hand cursor
  // Mid-stroke it stays up even if the drag has run off the edge; otherwise it
  // follows the pointer, or shows briefly while the size is being changed.
  return _annot.drawing || _annot.ptrIn || _annot.hudUntil > Date.now();
}
// Remember where the pointer is, in stage coordinates, and redraw the ring.
function _annotTrackPointer(e) {
  if (!_annot) return;
  const box = _annotStageBox();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  // A text label inside the stage is its own thing to click and drag, so the
  // brush cursor gets out of the way over it.
  const overLabel = !!(e.target && e.target.closest && e.target.closest('.annot-textbox'));
  _annot.ptr = { x, y };
  _annot.ptrIn = !overLabel && x >= 0 && y >= 0 && x <= box.width && y <= box.height;
  _annotUpdateBrushRing();
}
function _annotUpdateBrushRing() {
  const want = _annotBrushRingVisible();
  const els = _annotRingEls(want);
  if (!els) return;
  const ring = els.ring, hud = els.hud, st = els.st, c = document.getElementById('annotCanvas');
  // The system cursor is only ever hidden for a tool that HAS a ring — the
  // resize handles and the transform tools set their own cursor and must keep it.
  if (c && ANNOT_RING_TOOLS[_annot ? _annot.tool : '']) {
    c.style.cursor = (want && _annot.ptrIn) ? 'none' : (ANNOT_CURSORS[_annot.tool] || 'crosshair');
  }
  if (!want) {
    ring.style.display = 'none';
    ring.classList.remove('peeking');
    if (hud) hud.classList.remove('show');
    return;
  }
  const box = _annotStageBox();
  // While the pointer is away (a slider drag) the preview sits in the middle of
  // the view, so the size still shows on the picture rather than only on a label.
  const p = (_annot.ptrIn || _annot.drawing) && _annot.ptr ? _annot.ptr : { x: box.width / 2, y: box.height / 2 };
  const px = Math.max(1, Math.round(_annot.size));
  const d = px * _annotDisplayScale();
  ring.style.display = 'block';
  ring.classList.toggle('tiny', d < ANNOT_RING_TINY);
  ring.style.width = ring.style.height = Math.max(1, d) + 'px';
  ring.style.left = (p.x - d / 2) + 'px';
  ring.style.top = (p.y - d / 2) + 'px';
  _annotUpdateClonePeek(ring, d);
  if (hud) {
    const on = _annot.hudUntil > Date.now();
    hud.classList.toggle('show', on);
    if (on) {
      hud.textContent = px + ' px';
      hud.style.left = Math.min(box.width - 8, Math.max(8, p.x)) + 'px';
      hud.style.top = Math.min(box.height - 26, p.y + d / 2 + 12) + 'px';
    }
  }
}
// ---- The clone stamp's live preview ----------------------------------------
// The source pin says where the copy comes FROM and the ring says how big the
// mark will be. Neither says what the mark will BE, so lining a stamp up meant
// clicking and then looking at what landed — and undoing it when it was half a
// letter out. The ring is therefore filled with the patch that would be stamped
// this instant: a lens on the source, carried under the pointer, at the same
// zoom as everything else. That is what turns "cover this word with the paper
// beside it" into something you aim rather than guess at.
const ANNOT_PEEK_MIN = 14;    // under this many screen px there is nothing to see inside the ring

// Where the pixels under the brush would be copied FROM, right now. Mid-stroke
// the offset was locked in at pointer-down; before the first dab, starting the
// drag here is what would put the source point itself under the pointer — so
// the preview is centred on the source, which is exactly what would land.
function _annotClonePeekSrc() {
  if (!_annot || _annot.tool !== 'clone' || !_annot.cloneSrc || !_annot.ptr) return null;
  if (!_annot.cloneOff) return { x: _annot.cloneSrc.x, y: _annot.cloneSrc.y };
  const s = _annotDisplayScale();
  const ix = (_annot.ptr.x - _annot.panX) / s, iy = (_annot.ptr.y - _annot.panY) / s;
  return { x: ix - _annot.cloneOff.x, y: iy - _annot.cloneOff.y };
}
function _annotUpdateClonePeek(ring, d) {
  const peek = ring && ring.firstElementChild;
  if (!peek || peek.tagName !== 'CANVAS') return;
  const src = d >= ANNOT_PEEK_MIN ? _annotClonePeekSrc() : null;
  ring.classList.toggle('peeking', !!src);
  if (!src) return;
  // Mid-stroke the stamp reads the FROZEN snapshot, so the preview must read it
  // too — dragging back over ground already covered would otherwise preview the
  // copy instead of the source, and the two diverge exactly where it matters.
  const from = _annot.cloneSnap || _annot.canvas;
  const px = Math.max(1, Math.round(_annot.size));
  // The backing store is the brush in IMAGE pixels, so what is drawn here is
  // pixel-for-pixel what the dab will put down, however far the view is zoomed.
  if (peek.width !== px || peek.height !== px) { peek.width = px; peek.height = px; }
  const g = peek.getContext('2d');
  g.clearRect(0, 0, px, px);
  g.imageSmoothingEnabled = false;
  try { g.drawImage(from, Math.round(src.x - px / 2), Math.round(src.y - px / 2), px, px, 0, 0, px, px); } catch (_) {}
  peek.classList.toggle('pixelated', d / px >= 3);
}
// Show the ring and its "12 px" badge for a moment after the size changes, so
// the slider, the wheel and [ ] all say what they did even when the pointer is
// nowhere near the picture.
function _annotBrushFlash() {
  if (!_annot) return;
  _annot.hudUntil = Date.now() + ANNOT_HUD_MS;
  _annotUpdateBrushRing();
  clearTimeout(_annot.hudTimer);
  _annot.hudTimer = setTimeout(() => { if (_annot) _annotUpdateBrushRing(); }, ANNOT_HUD_MS + 40);
}
// hex → [r,g,b]
function _annotHexToRgb(hex) {
  hex = String(hex || '').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex || '000000', 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Paint-bucket flood fill: from the clicked pixel, recolour every connected
// pixel whose colour is within tolerance of it — fills enclosed shapes/regions.
function _annotFloodFill(sx, sy) {
  const cv = _annot.canvas, ctx = _annot.ctx, W = cv.width, H = cv.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
  const img = ctx.getImageData(0, 0, W, H), out = img.data;
  const src = new Uint8ClampedArray(out);   // stable copy for matching
  const at = (x, y) => (y * W + x) * 4;
  const s0 = at(sx, sy);
  const tr = src[s0], tg = src[s0 + 1], tb = src[s0 + 2], ta = src[s0 + 3];
  // Erasing with the bucket CUTS when the session is set to transparent — the
  // fastest way to take a flat plate off a sprite: click it, it is gone.
  const cut = _annot.tool === 'erase' && annotEraseClears();
  const fill = _annot.tool === 'erase' ? [255, 255, 255] : _annotHexToRgb(_annot.color);
  const fr = fill[0], fg = fill[1], fb = fill[2];
  if (!cut && Math.abs(tr - fr) < 2 && Math.abs(tg - fg) < 2 && Math.abs(tb - fb) < 2 && ta === 255) return; // already that colour
  if (cut && ta === 0) return;                    // already empty here
  const t = Math.max(1, _annot.tol || 32);
  const TOL = t * t * 3;   // squared colour distance a pixel may differ and still count
  const match = i => { const dr = src[i] - tr, dg = src[i + 1] - tg, db = src[i + 2] - tb, da = src[i + 3] - ta; return dr * dr + dg * dg + db * db + da * da <= TOL; };
  const seen = new Uint8Array(W * H);
  const stack = [[sx, sy]];
  while (stack.length) {
    let [x, y] = stack.pop();
    while (x > 0 && match(at(x - 1, y))) x--;   // walk to the left edge of this span
    let up = false, dn = false;
    for (; x < W && match(at(x, y)); x++) {
      const k = y * W + x; if (seen[k]) continue; seen[k] = 1;
      const i = k * 4;
      if (cut) { out[i + 3] = 0; }
      else { out[i] = fr; out[i + 1] = fg; out[i + 2] = fb; out[i + 3] = 255; }
      if (y > 0) { const mu = match(at(x, y - 1)); if (mu && !up && !seen[k - W]) stack.push([x, y - 1]); up = mu; }
      if (y < H - 1) { const md = match(at(x, y + 1)); if (md && !dn && !seen[k + W]) stack.push([x, y + 1]); dn = md; }
    }
  }
  ctx.putImageData(img, 0, 0);
}
// ---- MOVE: lift the selection off the picture and drop it anywhere ---------
// Photoshop's Move tool. Dragging inside a selection cuts those pixels out onto
// a floating layer that follows the pointer; the hole they left follows the
// ⬜/▨ Erase-to setting — white on a scanned page, a real hole on art. Hold
// Alt to copy instead of cut, leaving the original where it was. The float is
// only burned in on release, so nothing is committed until you let go.
function _annotSelLift(copy) {
  const m = _annotSelMask(); if (!m) return null;
  const cv = _annot.canvas, ctx = _annot.ctx;
  const layer = document.createElement('canvas');
  layer.width = m.w; layer.height = m.h;
  const lx = layer.getContext('2d');
  const src = ctx.getImageData(m.x, m.y, m.w, m.h);
  const cut = lx.createImageData(m.w, m.h);
  for (let k = 0; k < m.mask.length; k++) {
    if (!m.mask[k]) continue;
    const i = k * 4;
    cut.data[i] = src.data[i]; cut.data[i + 1] = src.data[i + 1];
    cut.data[i + 2] = src.data[i + 2]; cut.data[i + 3] = src.data[i + 3];
  }
  lx.putImageData(cut, 0, 0);
  if (!copy) {
    // The hole the pixels left behind follows the same rule Erase does: white
    // on a scanned page, a real hole on a piece of art that stands on nothing.
    const clear = annotEraseClears();
    for (let k = 0; k < m.mask.length; k++) {
      if (!m.mask[k]) continue;
      const i = k * 4;
      if (clear) { src.data[i + 3] = 0; }
      else { src.data[i] = 255; src.data[i + 1] = 255; src.data[i + 2] = 255; src.data[i + 3] = 255; }
    }
    ctx.putImageData(src, m.x, m.y);
  }
  // The picture with the hole in it, so each drag frame redraws from a clean base.
  const base = document.createElement('canvas');
  base.width = cv.width; base.height = cv.height;
  base.getContext('2d').drawImage(cv, 0, 0);
  return { layer, base, mask: m, dx: 0, dy: 0 };
}
function _annotFloatDraw() {
  const f = _annot && _annot.float; if (!f) return;
  const ctx = _annot.ctx;
  ctx.putImageData(f.base.getContext('2d').getImageData(0, 0, f.base.width, f.base.height), 0, 0);
  ctx.drawImage(f.layer, f.mask.x + f.dx, f.mask.y + f.dy);
}
// Drop it: the float becomes part of the picture and the selection travels with
// it, so it can be moved again, filled, or nudged further.
function _annotFloatCommit() {
  const f = _annot && _annot.float; if (!f) return;
  _annotFloatDraw();
  const m = f.mask;
  _annot.sel = { x: m.x + f.dx, y: m.y + f.dy, w: m.w, h: m.h, mask: m.mask };
  _annot.sel.outline = _annotMaskOutline(_annot.sel);
  _annot.float = null;
  _annotSelSyncBar();
}

// ---- ROTATE & SKEW (free transform) ---------------------------------------
// Turning and slanting, for the two things that actually go wrong with a
// scanned science paper: the whole page went in crooked, or one object inside
// it (an arrow, a label, a pasted diagram) sits at the wrong angle.
//
// With a selection live the selected pixels are lifted onto their own layer —
// the hole behind them is filled the way Move fills one (⬜/▨ Erase to) — so the object
// turns on its own. With nothing selected the WHOLE picture is the object, and
// the canvas grows so no corner is ever cut off.
//
// Nothing is committed while you drag: the preview redraws from the untouched
// layer every frame, so turning 30° and back to 0° leaves the pixels as sharp
// as they started. Only Apply burns it in.
const ANNOT_XFORM_MAX_PX = 16384;   // never let "grow to fit" run away with memory
const ANNOT_SCALE_MIN = 0.05;      // 5% — small enough to shrink a stamp, big enough to still grab
const ANNOT_SCALE_MAX = 8;
const _annotRad = d => (d || 0) * Math.PI / 180;
function _annotWrapDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return Math.abs(d) < 1e-9 ? 0 : d; }
function _annotClampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, isNaN(v) ? 0 : v)); }
function _annotXformSx(x) { return (x && typeof x.sx === 'number' && x.sx) ? x.sx : 1; }
function _annotXformSy(x) { return (x && typeof x.sy === 'number' && x.sy) ? x.sy : 1; }
function _annotXformIsIdentity(x) {
  // A PASTED picture is never "nothing to do": the object itself is new, so
  // even at 100% and 0° there is something to burn in. Reading it as identity
  // would make ✓ Apply — and every tool switch — throw the paste away.
  if (x && x.scope === 'paste') return false;
  return !x || (!x.angle && !x.skewX && !x.skewY && _annotXformSx(x) === 1 && _annotXformSy(x) === 1 && !x.moved);
}

// Start a transform session. Snapshots history once, up front, so Cancel (and
// Ctrl+Z afterwards) puts the picture back exactly as it was.
function _annotXformBegin() {
  if (!_annot || _annot.xform) return;
  // Burn any label still being typed: a whole-picture turn resizes the canvas
  // underneath it, and a floating label would be left pointing at nothing.
  document.querySelectorAll('#annotStage .annot-textbox-input').forEach(i => i.blur());
  _annotPushHistory();
  const cv = _annot.canvas;
  let layer, ox, oy, base, scope;
  const prevSel = _annot.sel;
  if (_annot.sel) {
    const lift = _annotSelLift(false);   // cut the object out; the hole follows ⬜/▨ Erase to
    if (!lift) { showToast('That selection is empty — nothing to turn', 'info'); _annot.history.pop(); return; }
    layer = lift.layer; ox = lift.mask.x; oy = lift.mask.y; base = lift.base; scope = 'sel';
    _annot.sel = null; _annotSelSyncBar();   // the old outline no longer describes anything
  } else {
    layer = document.createElement('canvas');
    layer.width = cv.width; layer.height = cv.height;
    layer.getContext('2d').drawImage(cv, 0, 0);
    ox = 0; oy = 0; base = null; scope = 'image';
  }
  _annot.xform = {
    scope, layer, base, ox, oy,
    cx: ox + layer.width / 2, cy: oy + layer.height / 2,
    angle: 0, skewX: 0, skewY: 0,
    sx: 1, sy: 1, lock: true, moved: false,
    grow: scope === 'image',
    baseW: cv.width, baseH: cv.height,
    straighten: false, strLine: null, prevSel
  };
  _annotXformSyncBar();
  _annotXformPreview();
}

// ---- PASTE a picture straight into the editor ------------------------------
// The picture somebody wants to drop onto a diagram is nearly always already on
// the clipboard — a screenshot, a photo, a figure lifted out of another
// question. Ctrl+V (or 📋 Paste) puts it on the canvas scaled to FIT the
// picture it is landing on, and opens the transform box on it straight away, so
// the eight handles are live from the first moment: drag a corner to resize,
// drag the middle to move, then ✓ Apply. That is the PowerPoint gesture, which
// is the one everybody already has in their fingers.
//
// It is its OWN transform scope (`paste`) rather than a selection lift, because
// the pixels do not come off the canvas: `base` is the picture untouched, so
// Cancel — and the history step taken here — simply leave no trace of it.
// The working ceiling for the editor's canvas. See _annotOpenSrc.
const ANNOT_MAX_PX = Infinity;
const ANNOT_MAX_PX_STANDALONE = Infinity;
const ANNOT_PASTE_FIT = 0.9;       // land inside this much of the canvas, so the handles have room
const ANNOT_PASTE_MAX_PX = Infinity;   // never hold a layer bitmap bigger than this
// The image file on the clipboard, if there is one. `items` is what a
// screenshot arrives as; `files` is what a copied file arrives as.
function _annotClipboardImageFile(e) {
  const dt = e && e.clipboardData;
  if (!dt) return null;
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it && it.kind === 'file' && String(it.type || '').startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  const files = dt.files ? Array.from(dt.files) : [];
  for (const f of files) if (f && String(f.type || '').startsWith('image/')) return f;
  return null;
}
// Bound in CAPTURE while the editor is open, so it beats the page-level paste
// handlers (the exam paper builder, Mark Paper, the contenteditable guard) —
// any of which could be on the page underneath the overlay.
function _annotPasteHandler(e) {
  if (!_annot) return;
  const ov = document.getElementById('annotOverlay');
  if (!ov || !ov.classList.contains('show')) return;
  // A label being typed keeps its own paste: pasting WORDS into a text box is
  // the other honest meaning of Ctrl+V in here.
  if (_annotTypingInField(e)) return;
  const file = _annotClipboardImageFile(e);
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  const r = new FileReader();
  r.onload = () => _annotPasteDataUrl(String(r.result || ''));
  r.onerror = () => showToast('Could not read that picture from the clipboard', 'error');
  r.readAsDataURL(file);
}
function _annotPasteDataUrl(url) {
  if (!url || !_annot) return;
  _loadImageEl(url).then(img => _annotPasteImage(img))
    .catch(err => { console.warn('annot paste', err); showToast('Could not open that pasted picture', 'error'); });
}
// The 📋 button: the keyboard shortcut is invisible, and a toolbar full of
// tools is where somebody looks for "put a picture in". Reading the clipboard
// needs permission, and Safari/Firefox may refuse outright — so a refusal says
// to use Ctrl+V instead rather than failing silently.
async function annotPasteFromClipboard() {
  if (!_annot) return;
  if (!navigator.clipboard || !navigator.clipboard.read) {
    showToast('Press Ctrl+V (⌘V) to paste a picture in from the clipboard', 'info');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = (it.types || []).find(t => String(t).startsWith('image/'));
      if (!type) continue;
      const blob = await it.getType(type);
      const url = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || '')); r.onerror = rej;
        r.readAsDataURL(blob);
      });
      _annotPasteDataUrl(url);
      return;
    }
    showToast('There is no picture on the clipboard — copy one first', 'info');
  } catch (err) {
    console.warn('clipboard read', err);
    showToast('This browser will not let a page read the clipboard — press Ctrl+V (⌘V) instead', 'info');
  }
}
function _annotPasteImage(img) {
  if (!_annot) return;
  const iw = img.naturalWidth || img.width || 0, ih = img.naturalHeight || img.height || 0;
  if (iw * ih > 24000000) { showToast('Image too large for touch-up; original remains unchanged.'); return; }
  if (!iw || !ih) { showToast('That clipboard picture was empty', 'error'); return; }
  // Settle whatever transform was open first — a paste is a NEW object and must
  // never inherit the last one's angle, nor silently discard its work.
  if (_annot.xform) {
    if (_annotXformIsIdentity(_annot.xform)) annotXformCancel(true); else annotXformApply(true);
  }
  // A label mid-type would be left pointing at a picture that has moved on.
  document.querySelectorAll('#annotStage .annot-textbox-input').forEach(i => i.blur());
  _annotPushHistory();
  const cv = _annot.canvas;
  // The layer holds the pasted picture at its OWN resolution (capped), and what
  // fits it into the window is the transform's scale — which is exactly what
  // the handles then edit. So dragging a corner back out stays sharp instead of
  // magnifying an already-shrunken bitmap.
  const cap = Math.min(1, ANNOT_PASTE_MAX_PX / Math.max(iw, ih));
  const lw = Math.max(1, Math.round(iw * cap)), lh = Math.max(1, Math.round(ih * cap));
  const layer = document.createElement('canvas');
  layer.width = lw; layer.height = lh;
  const lx = layer.getContext('2d');
  lx.imageSmoothingEnabled = true;
  try { lx.imageSmoothingQuality = 'high'; } catch (_) {}
  lx.drawImage(img, 0, 0, lw, lh);
  // The picture as it stands, so every preview frame redraws from a clean base.
  const base = document.createElement('canvas');
  base.width = cv.width; base.height = cv.height;
  base.getContext('2d').drawImage(cv, 0, 0);
  // Fit it inside what it is landing on — never blown UP past its own pixels,
  // and never so large that the corner handles sit off the edge of the stage.
  const fit = Math.min(1, (cv.width * ANNOT_PASTE_FIT) / lw, (cv.height * ANNOT_PASTE_FIT) / lh);
  const s = _annotXformClampScale(null, fit, Math.max(lw, lh));
  const prevSel = _annot.sel;
  _annot.sel = null; _annot.selPts = null; _annotSelSyncBar();
  const cx = cv.width / 2, cy = cv.height / 2;
  _annot.xform = {
    scope: 'paste', layer, base, ox: cx - lw / 2, oy: cy - lh / 2,
    cx, cy, angle: 0, skewX: 0, skewY: 0,
    sx: s, sy: s, lock: true, moved: false,
    grow: false,
    baseW: cv.width, baseH: cv.height,
    straighten: false, strLine: null, prevSel
  };
  // Resize is the tool the handles belong to, so the pasted picture arrives
  // ready to drag rather than waiting to be discovered.
  _annotSetTool('scale');
  _annotXformSyncBar();
  _annotXformPreview();
  showToast('📋 Pasted ' + iw + '×' + ih + ' — drag the handles to resize, drag the middle to move, then ✓ Apply', 'success');
}
// Scale first, then skew, then rotate — the same order the canvas applies them
// below, so the corner maths and the render can never drift apart. (u, v) are
// layer pixels measured from the pivot, BEFORE scaling.
function _annotXformMapper(x) {
  const a = _annotRad(x.angle), cos = Math.cos(a), sin = Math.sin(a);
  const tx = Math.tan(_annotRad(x.skewX)), ty = Math.tan(_annotRad(x.skewY));
  const sx = _annotXformSx(x), sy = _annotXformSy(x);
  return (u, v) => {
    const zu = u * sx, zv = v * sy;
    const su = zu + tx * zv, sv = ty * zu + zv;
    return { x: x.cx + su * cos - sv * sin, y: x.cy + su * sin + sv * cos };
  };
}
// The other direction, for turning a pointer position back into the object's
// own coordinates while a handle is being dragged. Two stops on the way back:
// the M-FRAME (rotation and slant undone, scaling still applied) is what the
// resize maths works in, and layer coordinates are one divide further.
function _annotXformMFrameVec(x, vx, vy) {
  const a = -_annotRad(x.angle), cos = Math.cos(a), sin = Math.sin(a);
  const rx = vx * cos - vy * sin, ry = vx * sin + vy * cos;
  const tx = Math.tan(_annotRad(x.skewX)), ty = Math.tan(_annotRad(x.skewY));
  const det = (1 - tx * ty) || 1e-6;
  return { x: (rx - tx * ry) / det, y: (ry - ty * rx) / det };
}
function _annotXformMFrame(x, px, py) { return _annotXformMFrameVec(x, px - x.cx, py - x.cy); }
function _annotXformUnmapVec(x, vx, vy) {
  const m = _annotXformMFrameVec(x, vx, vy);
  return { x: m.x / (_annotXformSx(x) || 1e-6), y: m.y / (_annotXformSy(x) || 1e-6) };
}
function _annotXformCorners(x) {
  const map = _annotXformMapper(x);
  const u0 = x.ox - x.cx, v0 = x.oy - x.cy;
  const u1 = u0 + x.layer.width, v1 = v0 + x.layer.height;
  return [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)];
}
function _annotXformDrawInto(ctx, x, offX, offY) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  try { ctx.imageSmoothingQuality = 'high'; } catch (_) {}
  ctx.translate(x.cx + offX, x.cy + offY);
  ctx.rotate(_annotRad(x.angle));
  ctx.transform(1, Math.tan(_annotRad(x.skewY)), Math.tan(_annotRad(x.skewX)), 1, 0, 0);
  ctx.scale(_annotXformSx(x), _annotXformSy(x));
  ctx.drawImage(x.layer, x.ox - x.cx, x.oy - x.cy);
  ctx.restore();
}
// Redraw the canvas for the current angle/slant. Whole-picture transforms
// recompute the canvas size each frame so you see the real result, corners and
// all, and the view re-fits so the picture doesn't wander off the stage.
function _annotXformPreview() {
  const x = _annot && _annot.xform; if (!x) return;
  const cv = _annot.canvas;
  let W = x.baseW, H = x.baseH, offX = 0, offY = 0, refit = false;
  if (x.scope === 'image' && x.grow) {
    const c = _annotXformCorners(x);
    const minX = Math.min(...c.map(p => p.x)), maxX = Math.max(...c.map(p => p.x));
    const minY = Math.min(...c.map(p => p.y)), maxY = Math.max(...c.map(p => p.y));
    W = Math.max(1, Math.ceil(maxX - minX));
    H = Math.max(1, Math.ceil(maxY - minY));
    if (W > ANNOT_XFORM_MAX_PX || H > ANNOT_XFORM_MAX_PX || W * H > 24000000) {
      if (!x.invalid) showToast('This transform exceeds the native-resolution memory limit. Reduce its size or cancel the transform.');
      x.invalid = true; return;
    }
    x.invalid = false;
    offX = -minX; offY = -minY;
  }
  if (cv.width !== W || cv.height !== H) { _annotResizeCanvas(W, H); refit = true; }
  const ctx = _annot.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Turning the WHOLE picture opens up new corners. On a scanned page those are
  // paper, so they go white; on a piece of art that stands on nothing they must
  // stay empty, or straightening a sprite boxes it in a white rectangle.
  ctx.clearRect(0, 0, W, H);
  if (!annotEraseClears()) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
  if (x.base) ctx.drawImage(x.base, offX, offY);
  _annotXformDrawInto(ctx, x, offX, offY);
  x.offX = offX; x.offY = offY;
  if (refit) annotZoomFit();
}
// ---- Free transform: the eight handles round the box ----------------------
// Corners resize both ways at once, edge handles one way, and the corner
// opposite the one you drag stays exactly where it is — the thing everybody
// expects of a resize box and the reason the maths below anchors rather than
// just multiplying a scale.
const ANNOT_HANDLES = [
  { id: 'nw', hx: 0, hy: 0, cur: 'nwse-resize' }, { id: 'n', hx: 0.5, hy: 0, cur: 'ns-resize' },
  { id: 'ne', hx: 1, hy: 0, cur: 'nesw-resize' }, { id: 'e', hx: 1, hy: 0.5, cur: 'ew-resize' },
  { id: 'se', hx: 1, hy: 1, cur: 'nwse-resize' }, { id: 's', hx: 0.5, hy: 1, cur: 'ns-resize' },
  { id: 'sw', hx: 0, hy: 1, cur: 'nesw-resize' }, { id: 'w', hx: 0, hy: 0.5, cur: 'ew-resize' },
];
function _annotXformHandles(x) {
  const map = _annotXformMapper(x);
  const W = x.layer.width, H = x.layer.height;
  const d = { x: x.ox - x.cx, y: x.oy - x.cy };
  return ANNOT_HANDLES.map(h => Object.assign({}, h, {
    pt: map(d.x + h.hx * W, d.y + h.hy * H),
    pD: { x: h.hx * W, y: h.hy * H },            // the handle, in layer pixels
    pA: { x: (1 - h.hx) * W, y: (1 - h.hy) * H },// the point it pivots against
  }));
}
// Which handle is under the pointer, judged in SCREEN pixels so it stays
// grabbable at any zoom.
function _annotXformHandleAt(p) {
  const x = _annot && _annot.xform; if (!x) return null;
  const s = _annotDisplayScale() || 1;
  const q = _annotXformUnoffset(x, p);
  let best = null, bestD = 11 / s;
  _annotXformHandles(x).forEach(h => {
    const d = Math.hypot(q.x - h.pt.x, q.y - h.pt.y);
    if (d <= bestD) { bestD = d; best = h; }
  });
  return best;
}
// A pointer position arrives in CANVAS coordinates; the transform maths lives
// in the frame the object is composed in, which a growing canvas shifts by
// (offX, offY). Everything that compares the two has to go through here.
function _annotXformUnoffset(x, p) { return { x: p.x - (x.offX || 0), y: p.y - (x.offY || 0) }; }
// Is the pointer inside the transform box? (Point-in-quad by winding.) That is
// what makes dragging the middle of the box move the object.
function _annotXformInside(p) {
  const x = _annot && _annot.xform; if (!x) return false;
  const c = _annotXformCorners(x);
  p = _annotXformUnoffset(x, p);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
// Put the pivot back in the middle of the box without moving a single pixel:
// the shift is taken straight back out of the layer's own offset. Run after a
// resize or a move, so a turn afterwards spins about the object's centre.
function _annotXformRecentre(x) {
  const W = x.layer.width, H = x.layer.height;
  const d = { x: x.ox - x.cx, y: x.oy - x.cy };
  const c = _annotXformMapper(x)(d.x + W / 2, d.y + H / 2);
  const shift = _annotXformUnmapVec(x, x.cx - c.x, x.cy - c.y);
  x.cx = c.x; x.cy = c.y;
  x.ox = c.x + d.x + shift.x;
  x.oy = c.y + d.y + shift.y;
}
// Begin a handle drag: everything the move needs is frozen here, so each frame
// is computed from the state at mouse-down and can never drift.
function _annotXformScaleStart(h) {
  const x = _annot.xform;
  const d = { x: x.ox - x.cx, y: x.oy - x.cy };
  const sx = _annotXformSx(x), sy = _annotXformSy(x);
  _annot.xfScale = {
    h, sx0: sx, sy0: sy,
    // The anchor's position in the M-frame — the one point the drag holds still.
    Ua: (d.x + h.pA.x) * sx, Va: (d.y + h.pA.y) * sy,
    spanX: h.pD.x - h.pA.x, spanY: h.pD.y - h.pA.y,
  };
}
function _annotXformScaleDrag(p, shift) {
  const x = _annot && _annot.xform, st = _annot && _annot.xfScale;
  if (!x || !st) return;
  const q = _annotXformUnoffset(x, p);
  const m = _annotXformMFrame(x, q.x, q.y);
  let sx = st.sx0, sy = st.sy0;
  if (Math.abs(st.spanX) > 0.5) sx = (m.x - st.Ua) / st.spanX;
  if (Math.abs(st.spanY) > 0.5) sy = (m.y - st.Va) / st.spanY;
  // Locked (or Shift held): one factor drives both axes, so the object keeps
  // its shape. The bigger of the two moves wins, and each axis keeps its own
  // sign — dragging a handle past the anchor still flips the object.
  const keep = x.lock !== (!!shift);          // Shift is a momentary override
  if (keep) {
    // Only the axes this handle actually drives get a vote: an edge handle
    // leaves its other axis at 1x, and letting that count would out-vote the
    // shrink the drag is asking for.
    const fx = Math.abs(st.spanX) > 0.5 ? sx / (st.sx0 || 1) : null;
    const fy = Math.abs(st.spanY) > 0.5 ? sy / (st.sy0 || 1) : null;
    const f = Math.max(fx === null ? 0 : Math.abs(fx), fy === null ? 0 : Math.abs(fy)) || 1;
    sx = Math.sign(fx === null ? 1 : (fx || 1)) * f * st.sx0;
    sy = Math.sign(fy === null ? 1 : (fy || 1)) * f * st.sy0;
  }
  sx = _annotXformClampScale(x, sx, x.layer.width);
  sy = _annotXformClampScale(x, sy, x.layer.height);
  // Hold the anchor: the layer offset is whatever puts it back where it was.
  x.sx = sx; x.sy = sy;
  x.ox = x.cx + st.Ua / sx - st.h.pA.x;
  x.oy = x.cy + st.Va / sy - st.h.pA.y;
  _annotXformSyncBar();
  _annotXformPreview();
}
// A scale factor has to keep the object visible, keep it under the canvas
// ceiling, and never be zero — a zero would collapse the object with no way
// back, because the offset maths divides by it.
function _annotXformClampScale(x, s, sidePx) {
  const sign = s < 0 ? -1 : 1;
  let mag = Math.abs(s);
  if (!isFinite(mag) || mag < ANNOT_SCALE_MIN) mag = ANNOT_SCALE_MIN;
  const roomy = Math.max(ANNOT_SCALE_MIN, ANNOT_XFORM_MAX_PX / Math.max(1, sidePx));
  mag = Math.min(mag, ANNOT_SCALE_MAX, roomy);
  return sign * mag;
}
// Drag the middle of the box to reposition the object. The pivot travels with
// it, so the object keeps turning about its own centre.
function _annotXformMoveTo(dx, dy) {
  const x = _annot && _annot.xform; if (!x) return;
  x.cx += dx; x.cy += dy; x.ox += dx; x.oy += dy;
  x.moved = true;
  _annotXformPreview();
}
// The % boxes and the flip buttons scale about the pivot, which _after a
// recentre_ is the middle of the box — so the object grows evenly both ways
// instead of creeping off to one side.
function annotXformSetScale(field, val) {
  const x = _annot && _annot.xform; if (!x) return;
  const side = field === 'sx' ? x.layer.width : x.layer.height;
  const was = field === 'sx' ? _annotXformSx(x) : _annotXformSy(x);
  const want = _annotXformClampScale(x, (parseFloat(val) || 0) / 100 * (was < 0 ? -1 : 1), side);
  const f = want / (was || 1);
  x[field] = want;
  if (x.lock) {
    const other = field === 'sx' ? 'sy' : 'sx';
    const oside = field === 'sx' ? x.layer.height : x.layer.width;
    x[other] = _annotXformClampScale(x, (field === 'sx' ? _annotXformSy(x) : _annotXformSx(x)) * f, oside);
  }
  _annotXformSyncBar();
  _annotXformPreview();
}
function annotXformSetLock(on) {
  const x = _annot && _annot.xform; if (!x) return;
  x.lock = !!on;
  _annotXformSyncBar();
}
function annotXformFlip(axis) {
  const x = _annot && _annot.xform; if (!x) return;
  if (axis === 'y') x.sy = -_annotXformSy(x); else x.sx = -_annotXformSx(x);
  _annotXformSyncBar();
  _annotXformPreview();
}
function annotXformScaleNudge(f) {
  const x = _annot && _annot.xform; if (!x) return;
  x.sx = _annotXformClampScale(x, _annotXformSx(x) * f, x.layer.width);
  x.sy = _annotXformClampScale(x, _annotXformSy(x) * f, x.layer.height);
  _annotXformSyncBar();
  _annotXformPreview();
}

// The transformed object becomes the new selection, so it can be turned again,
// nudged with Move, or filled — the mask comes straight from its alpha.
function _annotXformSelFromLayer() {
  const x = _annot.xform, cv = _annot.canvas;
  const sc = document.createElement('canvas');
  sc.width = cv.width; sc.height = cv.height;
  _annotXformDrawInto(sc.getContext('2d'), x, x.offX || 0, x.offY || 0);
  const d = sc.getContext('2d').getImageData(0, 0, sc.width, sc.height).data;
  let x0 = sc.width, y0 = sc.height, x1 = -1, y1 = -1;
  for (let y = 0; y < sc.height; y++) for (let px = 0; px < sc.width; px++) {
    if (d[(y * sc.width + px) * 4 + 3] < 128) continue;
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
    mask[y * w + px] = d[((y + y0) * sc.width + (px + x0)) * 4 + 3] >= 128 ? 1 : 0;
  }
  const sel = { x: x0, y: y0, w, h, mask };
  sel.outline = _annotMaskOutline(sel);
  return sel;
}
function _annotXformEnd() {
  if (!_annot) return;
  _annot.xform = null;
  _annot.xfScale = null; _annot.xfMove = false;
  _annotXformSyncBar();
  _annotSelSyncBar();
}
// Burn the transform in. An untouched session just melts away — no history
// step is spent on a turn of 0°.
function annotXformApply(quiet) {
  const x = _annot && _annot.xform; if (!x) return;
  if (_annotXformIsIdentity(x)) { annotXformCancel(true); return; }
  _annotXformPreview();
  if (x.invalid) return;
  // A pasted picture becomes the selection too, so it can be nudged, filled or
  // turned again straight afterwards without hunting for it with the lasso.
  const sel = x.scope === 'image' ? null : _annotXformSelFromLayer();
  const what = x.scope === 'image' ? 'Picture' : x.scope === 'paste' ? 'Pasted picture' : 'Object';
  const bits = [];
  const sx = _annotXformSx(x), sy = _annotXformSy(x);
  const pct = v => Math.round(Math.abs(v) * 1000) / 10 + '%';
  if (Math.abs(sx) !== 1 || Math.abs(sy) !== 1) bits.push('resized to ' + pct(sx) + ' × ' + pct(sy));
  if (sx < 0 && sy < 0) bits.push('flipped both ways');
  else if (sx < 0) bits.push('flipped ↔');
  else if (sy < 0) bits.push('flipped ↕');
  if (x.angle) bits.push('turned ' + (Math.round(x.angle * 10) / 10) + '°');
  if (x.skewX) bits.push('slanted ' + (Math.round(x.skewX * 10) / 10) + '° ↔');
  if (x.skewY) bits.push('slanted ' + (Math.round(x.skewY * 10) / 10) + '° ↕');
  if (x.moved && !bits.length) bits.push('moved');
  else if (x.moved) bits.push('moved');
  if (x.scope === 'paste' && !bits.length) bits.push('placed');
  _annotXformEnd();
  if (sel) { _annot.sel = sel; _annotSelSyncBar(); }
  if (!quiet) showToast(what + ' ' + (bits.join(', ') || 'transformed') + ' ✓ (Undo puts it back)', 'success');
}
// Throw the session away and restore the snapshot taken when it started. The
// selection that was lifted comes back too, so cancelling costs nothing.
function annotXformCancel(quiet) {
  if (!_annot || !_annot.xform) return;
  const prevSel = _annot.xform.prevSel || null;
  const wasPaste = _annot.xform.scope === 'paste';
  _annotXformEnd();
  annotUndo();
  _annot.sel = prevSel;
  _annotSelSyncBar();
  if (!quiet) showToast(wasPaste ? 'Pasted picture removed' : 'Turn cancelled — picture put back', 'info');
}
function annotXformReset() {
  const x = _annot && _annot.xform; if (!x) return;
  x.angle = 0; x.skewX = 0; x.skewY = 0; x.strLine = null;
  x.sx = 1; x.sy = 1;
  _annotXformSyncBar(); _annotXformPreview();
}
function annotXformSet(field, val) {
  const x = _annot && _annot.xform; if (!x) return;
  const lim = field === 'angle' ? 180 : 60;
  x[field] = _annotClampNum(parseFloat(val), -lim, lim);
  _annotXformSyncBar(); _annotXformPreview();
}
function annotXformNudge(deg) {
  const x = _annot && _annot.xform; if (!x) return;
  x.angle = _annotWrapDeg(x.angle + deg);
  _annotXformSyncBar(); _annotXformPreview();
}
function annotXformSetGrow(on) {
  const x = _annot && _annot.xform; if (!x) return;
  x.grow = !!on;
  _annotXformPreview();
}
// Straighten: drag a line along something that ought to be level (a table rule,
// the base of a diagram, a line of print) and the picture turns to make it so.
function annotXformStraightenStart() {
  const x = _annot && _annot.xform; if (!x) return;
  x.straighten = true; x.strLine = null;
  _annotXformSyncBar();
  showToast('📐 Now drag a line along an edge that should be straight', 'info');
}
function _annotXformStraightenFinish() {
  const x = _annot && _annot.xform; if (!x || !x.strLine) return;
  const { from, to } = x.strLine;
  const dx = to.x - from.x, dy = to.y - from.y;
  x.strLine = null;
  // A stray click leaves Straighten armed — you meant to trace, not to click.
  if (Math.hypot(dx, dy) < 20) { showToast('Drag a longer line along the edge you want level', 'info'); _annotXformSyncBar(); return; }
  x.straighten = false;
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
  if (Math.abs(deg) > 45) deg -= Math.sign(deg) * 90;   // they traced a vertical edge
  x.angle = _annotWrapDeg(x.angle - deg);
  _annotXformSyncBar();
  _annotXformPreview();
  showToast('Straightened by ' + (Math.round(-deg * 10) / 10) + '° — fine-tune with the Turn slider', 'success');
}
function _annotXformSyncBar() {
  const bar = document.getElementById('annotXformBar');
  const x = _annot && _annot.xform;
  if (bar) bar.style.display = x ? 'flex' : 'none';
  if (!x) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  set('annotXformAngle', x.angle); set('annotXformAngleNum', Math.round(x.angle * 10) / 10);
  set('annotXformSkewX', x.skewX); set('annotXformSkewY', x.skewY);
  const lbl = (id, v, unit) => { const el = document.getElementById(id); if (el) el.textContent = (Math.round(v * 10) / 10) + (unit || '°'); };
  lbl('annotXformSkewXVal', x.skewX); lbl('annotXformSkewYVal', x.skewY);
  // Size is shown as a percentage, and in real pixels beside it, because "how
  // big will this actually be" is the question a resize is asked to answer.
  const sx = _annotXformSx(x), sy = _annotXformSy(x);
  set('annotXformSxNum', Math.round(Math.abs(sx) * 1000) / 10);
  set('annotXformSyNum', Math.round(Math.abs(sy) * 1000) / 10);
  const lock = document.getElementById('annotXformLock');
  if (lock) lock.checked = x.lock !== false;
  const px = document.getElementById('annotXformSizePx');
  if (px) px.textContent = Math.round(Math.abs(sx) * x.layer.width) + ' × ' + Math.round(Math.abs(sy) * x.layer.height) + ' px';
  const scope = document.getElementById('annotXformScope');
  if (scope) scope.textContent = x.scope === 'sel' ? 'the selected object'
    : x.scope === 'paste' ? 'the pasted picture' : 'the whole picture';
  const growWrap = document.getElementById('annotXformGrowWrap');
  if (growWrap) growWrap.style.display = x.scope === 'image' ? 'inline-flex' : 'none';
  const grow = document.getElementById('annotXformGrow');
  if (grow) grow.checked = !!x.grow;
  const str = document.getElementById('annotXformStraightenBtn');
  if (str) str.classList.toggle('active', !!x.straighten);
}

// History brush: paint the ORIGINAL picture back, one dab at a time.
function _annotHistoryDab(x, y) {
  if (!_annot.origSnap) return;
  const ctx = _annot.ctx, r = Math.max(1, Math.round(_annot.size)) / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(_annot.origSnap, 0, 0);
  ctx.restore();
}
function _annotHistoryStroke(from, to) {
  const r = Math.max(1, Math.round(_annot.size)) / 2;
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  const step = Math.max(1, r / 2), n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) _annotHistoryDab(from.x + dx * (i / n), from.y + dy * (i / n));
}

// Clone stamp: copy a circular patch from the frozen source snapshot, offset so
// the source point tracks the brush as you drag.
function _annotCloneDab(ctx, x, y) {
  if (!_annot.cloneSnap || !_annot.cloneOff) return;
  const r = Math.max(1, Math.round(_annot.size)) / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(_annot.cloneSnap, _annot.cloneOff.x, _annot.cloneOff.y);
  ctx.restore();
}
function _annotCloneStroke(from, to) {
  const ctx = _annot.ctx, r = Math.max(1, Math.round(_annot.size)) / 2;
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  const step = Math.max(1, r / 2), n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) _annotCloneDab(ctx, from.x + dx * (i / n), from.y + dy * (i / n));
}
function _annotStageBox() {
  const st = document.getElementById('annotStage');
  return st ? st.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
}
// Keep the image from being dragged fully out of the viewport.
function _annotClampPan() {
  if (!_annot) return;
  const box = _annotStageBox(), s = _annotDisplayScale();
  const w = _annot.canvas.width * s, h = _annot.canvas.height * s;
  const margin = 40; // always keep at least this many px of image reachable
  _annot.panX = Math.min(box.width - margin, Math.max(margin - w, _annot.panX));
  _annot.panY = Math.min(box.height - margin, Math.max(margin - h, _annot.panY));
}
function annotZoomFit() {
  if (!_annot) return;
  const box = _annotStageBox();
  _annot.fit = Math.min(box.width / _annot.canvas.width, box.height / _annot.canvas.height) || 1;
  _annot.zoom = 1;
  const s = _annotDisplayScale();
  _annot.panX = (box.width - _annot.canvas.width * s) / 2;
  _annot.panY = (box.height - _annot.canvas.height * s) / 2;
  _annotUpdateTransform();
}
// Zoom about a viewport point (px relative to the stage). Keeps that point fixed.
function _annotZoomAt(factor, vx, vy) {
  if (!_annot) return;
  const box = _annotStageBox();
  if (vx == null) { vx = box.width / 2; vy = box.height / 2; }
  const oldS = _annotDisplayScale();
  const minZoom = 1, maxZoom = ANNOT_MAX_DISPLAY / (_annot.fit || 1);
  const newZoom = Math.min(maxZoom, Math.max(minZoom, _annot.zoom * factor));
  if (newZoom === _annot.zoom) return;
  const newS = _annot.fit * newZoom;
  // canvas-space point under the cursor stays put
  const cx = (vx - _annot.panX) / oldS, cy = (vy - _annot.panY) / oldS;
  _annot.zoom = newZoom;
  _annot.panX = vx - cx * newS;
  _annot.panY = vy - cy * newS;
  _annotClampPan();
  _annotUpdateTransform();
}
function annotZoomStep(factor) {
  const box = _annotStageBox();
  _annotZoomAt(factor, box.width / 2, box.height / 2);
}
function _annotWheel(e) {
  if (!_annot) return;
  e.preventDefault();   // never let the page/browser scroll or zoom
  const box = _annotStageBox();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  _annotZoomAt(factor, e.clientX - box.left, e.clientY - box.top);
}
function _annotTypingInField(e) {
  const el = (e && e.target) || document.activeElement;
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}
function _annotKeyDown(e) {
  if (!_annot) return;
  if (e.code === 'Space' && !_annotTypingInField(e)) { _annot.space = true; const st = document.getElementById('annotStage'); if (st) st.classList.add('canpan'); _annotUpdateBrushRing(); e.preventDefault(); }
  // Escape backs out of the open transform first, then out of a selection.
  if (e.key === 'Escape' && !_annotTypingInField(e) && _annot.xform) { e.preventDefault(); _annot.drawing = false; annotXformCancel(); return; }
  // An open pen path is backed out of before anything else: Esc drops the path,
  // not the selection that was there before it.
  if (e.key === 'Escape' && !_annotTypingInField(e) && _annotPenActive()) { e.preventDefault(); _annotPenCancel(); return; }
  if (e.key === 'Escape' && !_annotTypingInField(e) && (_annot.sel || _annot.selPts)) { _annot.selPts = null; _annot.drawing = false; annotSelClear(); }
  // Ctrl/Cmd+Z works even from a text label; everything else needs the canvas.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); annotUndo(); return; }
  if (_annotTypingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  // [ and ] step the brush the way every paint program does. Shift jumps by 5.
  if (k === '[' || k === '{') { e.preventDefault(); _annotStepSize(k === '{' ? -5 : -1); return; }
  if (k === ']' || k === '}') { e.preventDefault(); _annotStepSize(k === '}' ? 5 : 1); return; }
  if (k === '+' || k === '=') { e.preventDefault(); annotZoomStep(1.3); return; }
  if (k === '-' || k === '_') { e.preventDefault(); annotZoomStep(1 / 1.3); return; }
  if (k === '0') { e.preventDefault(); annotZoomFit(); return; }
  // Mid-path, Backspace takes back the last anchor and Enter closes the path.
  // Enter must NEVER fall through to "save the whole picture" while a path is open.
  if (_annotPenActive()) {
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); _annotPenRemoveLast(); return; }
    if (k === 'Enter') { e.preventDefault(); _annotPenClose(); return; }
  }
  // Delete / Backspace cuts the selection away, the way every image editor does.
  if ((k === 'Delete' || k === 'Backspace') && _annot.sel) { e.preventDefault(); annotSelDelete(); return; }
  // Enter commits an open transform (Photoshop's habit); otherwise it saves.
  if (k === 'Enter') { e.preventDefault(); if (_annot.xform) annotXformApply(); else applyAnnotTool(); return; }
  const tool = ANNOT_KEYS[String(k).toLowerCase()];
  if (tool) { e.preventDefault(); _annotSetTool(tool); }
}
function _annotKeyUp(e) { if (_annot && e.code === 'Space') { _annot.space = false; const st = document.getElementById('annotStage'); if (st) st.classList.remove('canpan'); _annotUpdateBrushRing(); } }
function _annotBindZoomListeners() {
  const st = document.getElementById('annotStage');
  if (st && !st._zoomBound) {
    st.addEventListener('wheel', _annotWheel, { passive: false });
    // The pointer can leave the stage (or the window) without another move
    // event ever arriving, which would strand the ring where it was last seen.
    st.addEventListener('pointerleave', () => { if (_annot) { _annot.ptrIn = false; _annotUpdateBrushRing(); } });
    st._zoomBound = true;
  }
  window.addEventListener('keydown', _annotKeyDown);
  window.addEventListener('keyup', _annotKeyUp);
  // Capture, so a picture pasted into the editor never reaches the page-level
  // paste handlers sitting underneath the overlay.
  window.addEventListener('paste', _annotPasteHandler, true);
}
function _annotUnbindZoomListeners() {
  window.removeEventListener('keydown', _annotKeyDown);
  window.removeEventListener('keyup', _annotKeyUp);
  window.removeEventListener('paste', _annotPasteHandler, true);
  const st = document.getElementById('annotStage');
  if (st) st.classList.remove('canpan', 'panning');
}
const ANNOT_CURSORS = { text: 'text', fill: 'cell', wand: 'cell', move: 'move', rotate: 'grab', skew: 'ew-resize', scale: 'move' };
function _annotSetTool(t) {
  _annotResetCompose();      // never strand the canvas in destination-out
  // An unfinished pen path or a stroke waiting to snap belongs to the tool being left.
  if (_annot && _annot.pen && t !== 'penselect') _annotPenCancel();
  _annotSnapEnd();
  // Leaving Rotate/Skew/Resize settles the open transform: a real change is
  // kept, an untouched one is dropped. Nothing is ever left half-applied.
  if (_annot && _annot.xform && t !== 'rotate' && t !== 'skew' && t !== 'scale') {
    if (_annotXformIsIdentity(_annot.xform)) annotXformCancel(true); else annotXformApply();
  }
  if (_annot) _annot.tool = t;
  document.querySelectorAll('.annot-tool').forEach(b => b.classList.toggle('active', b.getAttribute('data-atool') === t));
  const c = document.getElementById('annotCanvas');
  if (c) c.style.cursor = ANNOT_CURSORS[t] || 'crosshair';
  // With Move active a whole text label is draggable, not just its little handle.
  document.querySelectorAll('#annotStage .annot-textbox').forEach(b => b.classList.toggle('movable', t === 'move'));
  _annotUpdateCloneMarker();   // show the clone-source pin only while the Clone tool is active
  // Picking Rotate, Skew or Resize opens the transform straight away, so the
  // handles and sliders are there to use — you shouldn't have to drag once to
  // discover the panel.
  if (_annot && (t === 'rotate' || t === 'skew' || t === 'scale') && !_annot.xform) _annotXformBegin();
  _annotXformSyncBar();
  // Switching to a brush tool should show its size straight away — you should
  // not have to make a mark to find out how big the mark will be.
  if (_annot && ANNOT_RING_TOOLS[t]) _annotBrushFlash(); else _annotUpdateBrushRing();
}
// Single-key tool switching, Photoshop's letters where they exist.
const ANNOT_KEYS = { e: 'erase', b: 'paint', g: 'fill', s: 'clone', y: 'history', m: 'select', l: 'lasso', p: 'penselect', w: 'wand', v: 'move', u: 'line', t: 'text', r: 'rotate', k: 'skew', f: 'scale' };
// A history step remembers the canvas SIZE as well as its pixels: rotating the
// whole picture grows the canvas, and undoing that has to shrink it back.
function _annotPushHistory() {
  if (!_annot) return;
  try {
    _annot.history.push({ img: _annot.ctx.getImageData(0, 0, _annot.canvas.width, _annot.canvas.height), w: _annot.canvas.width, h: _annot.canvas.height });
    if (_annot.history.length > Math.max(1, Math.min(10, Math.floor(80000000 / (_annot.canvas.width * _annot.canvas.height * 4))))) _annot.history.shift();
  } catch (_) {}
}
// 🧻 Clean paper — the manual twin of the automatic pass in the enhance door,
// for every picture that is ALREADY in the bank. Those were re-rendered before
// the cleaner existed and carry the weave in their stored pixels; nobody is
// going to reopen a thousand of them, but the one being touched up anyway is a
// tap away from clean. One history step, so ↶ Undo puts the texture back if
// the guards let through something they should not have.
function annotCleanPaper() {
  if (!_annot) return;
  const W = _annot.canvas.width, H = _annot.canvas.height;
  let id;
  try { id = _annot.ctx.getImageData(0, 0, W, H); }
  catch (e) { showToast('Could not read the picture to clean it', 'error'); return; }
  const rep = _paperCleanPixels(id.data, W, H);
  if (!rep.ok) {
    // Every refusal is named, because "nothing happened" on a button is the
    // one outcome nobody can act on.
    showToast(rep.reason === 'no-white' ? 'Left alone — this picture has no white paper to clean (it is a photo or dark artwork)'
      : rep.reason === 'not-paper' ? 'Left alone — the bright part is not a page background here'
      : rep.reason === 'no-ink' ? 'Left alone — there is no line work in this picture to protect'
      : 'Nothing to clean', 'info');
    return;
  }
  if (!rep.changed) { showToast('Already clean — the background is pure white ✓', 'info'); return; }
  _annotPushHistory();
  _annot.ctx.putImageData(id, 0, 0);
  showToast(`🧻 Cleaned the background — ${Math.round(rep.changed / (W * H) * 100)}% of the picture snapped to white ✓`, 'success');
}

function annotUndo() {
  if (!_annot) return;
  // While a rotate/skew is open, undo means "abandon this turn" — stepping the
  // canvas back underneath a live session would leave the two out of step.
  // (Cancel clears the session first, so this never recurses.)
  if (_annot.xform) { annotXformCancel(); return; }
  if (!_annot.history.length) return;
  const step = _annot.history.pop();
  if (_annot.canvas.width !== step.w || _annot.canvas.height !== step.h) {
    _annotResizeCanvas(step.w, step.h);
    annotZoomFit();
  }
  _annot.ctx.putImageData(step.img, 0, 0);
}
// Resize the working canvas (and the marching-ants overlay that rides on it).
function _annotResizeCanvas(w, h) {
  if (!_annot) return;
  _annot.canvas.width = w; _annot.canvas.height = h;
  if (_annot.selCanvas) { _annot.selCanvas.width = w; _annot.selCanvas.height = h; }
}
function _annotPt(e) {
  const c = _annot.canvas, r = c.getBoundingClientRect();
  const scale = c.width / r.width;
  return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * (c.height / r.height), dispX: e.clientX - r.left, dispY: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY, scale };
}
// Plot a crisp 1px line between two points (Bresenham) — no anti-aliasing, so a
// 1px brush drags as clean single pixels, like a Photoshop pencil.
function _annotPlotLine(ctx, x0, y0, x1, y1) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
// Snap the end point to the nearest 45° from the start (PowerPoint-style).
function _annotSnap45(s, p) {
  const dx = p.x - s.x, dy = p.y - s.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
}
// Lock to the horizontal or vertical axis (whichever is dominant) — the
// Photoshop Shift-drag brush constraint.
function _annotSnapAxis(s, p) {
  const dx = p.x - s.x, dy = p.y - s.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: s.y } : { x: s.x, y: p.y };
}
// Constrain a rectangle drag to a square (Shift held while rect-selecting).
function _annotSquarePt(s, p) {
  const dx = p.x - s.x, dy = p.y - s.y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: s.x + (dx < 0 ? -m : m), y: s.y + (dy < 0 ? -m : m) };
}
// One straight brush stroke between two points with the current tool settings
// (used by the Photoshop click-then-Shift-click line).
function _annotBrushLine(a, b) {
  const ctx = _annot.ctx, lw = Math.max(1, Math.round(_annot.size));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  _annotPaintCompose(ctx);
  ctx.lineWidth = lw;
  if (lw <= 1) { _annotPlotLine(ctx, a.x, a.y, b.x, b.y); }
  else { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  _annotResetCompose();
}
// =====================================================================
// ✨ HOLD TO SNAP and 🖊️ PEN SELECT — both ride shape-snap.js, which is
// byte-for-byte the same file in polymathlc/book and polymathlc/anskey.
//
// HOLD TO SNAP. Draw with 🖌️ Paint, or ➰ Lasso round something, and keep the
// pointer still: the stroke is replaced by the neat shape it was meant to be
// (straight line, arc, smooth curve, circle, ellipse, rectangle, square,
// triangle, pentagon, hexagon). Keep dragging to adjust it; lift to keep it.
//   · Paint redraws the SNAPPED shape in the brush over the picture exactly as
//     it was before the stroke began (the history step pushed at pointer-down),
//     so nothing underneath is ever lost and ↶ Undo takes the whole stroke back.
//   · Lasso only snaps to a CLOSED outline: an open line selects nothing.
//   · 🧽 Erase is deliberately not snapped — an eraser pass is a decision about
//     what to destroy, and a guessed shape would rub out the wrong place.
//   · No shape-snap.js (it failed to load) = plain ink, never an error.
//
// PEN SELECT is Photoshop's pen used to make a selection: click for a corner
// anchor, click-and-drag for a smooth one with Bezier handles, click the first
// anchor (or Enter / double-click) to close. The path is flattened to a polygon
// and becomes the ordinary `_annot.sel`, so fill / delete / move / resize /
// rotate / skew / AI fill all work on it unchanged. Nothing touches the pixels
// until one of those is used.
// =====================================================================
const ANNOT_SNAP_TOOLS = { paint: 1, lasso: 1 };
let _annotSnapHintShown = false;
function _annotShapeSnap() { return (typeof window !== 'undefined' && window.ShapeSnap && window.ShapeSnap.recognize) ? window.ShapeSnap : null; }
function _annotPxUnit() { return 1 / (_annotDisplayScale() || 1); }   // image pixels per screen pixel
// A paint / lasso stroke has begun: start watching for the pointer to rest.
function _annotSnapBegin(e, p) {
  _annotSnapEnd();
  const S = _annotShapeSnap();
  if (!S || !_annot || !ANNOT_SNAP_TOOLS[_annot.tool]) return;
  _annot.snapPts = [{ x: p.x, y: p.y }];
  _annot.snapDesc = null;
  _annot.snapHold = S.createHold({ onHold: _annotSnapFire });
  _annot.snapHold.start(e.clientX, e.clientY);
}
function _annotSnapEnd() {
  if (!_annot) return;
  if (_annot.snapHold) _annot.snapHold.cancel();
  if (_annot.snapRaf) { cancelAnimationFrame(_annot.snapRaf); _annot.snapRaf = 0; }
  _annot.snapHold = null; _annot.snapPts = null; _annot.snapDesc = null;
}
// The pointer rested long enough: decide what the stroke was meant to be.
function _annotSnapFire() {
  const a = _annot, S = _annotShapeSnap();
  if (!a || !S || !a.drawing || a.snapDesc) return;
  const unit = _annotPxUnit();
  if (a.tool === 'lasso') {
    const rec = a.selPts && a.selPts.length > 3 ? S.recognize(a.selPts, { unit }) : null;
    if (!rec || !rec.closed) return;                 // an open line has no inside to select
    a.snapDesc = rec;
    a.selPts = S.toPoints(rec);
    _annotSnapAnnounce(rec);
    return;
  }
  if (a.tool === 'paint' && a.snapPts && a.snapPts.length > 3 && !a.shiftSeg) {
    const top = a.history[a.history.length - 1];
    if (!top || top.w !== a.canvas.width || top.h !== a.canvas.height) return;   // no clean "before" to go back to
    const rec = S.recognize(a.snapPts, { unit });
    if (!rec) return;
    a.snapDesc = rec;
    _annotSnapPaint(rec);
    _annotSnapAnnounce(rec);
  }
}
function _annotSnapAnnounce(rec) {
  const S = _annotShapeSnap();
  if (_annotSnapHintShown) return;
  _annotSnapHintShown = true;
  showToast('✨ Snapped to a ' + String(S.label(rec)).toLowerCase() + ' — keep dragging to adjust, or lift to keep it', 'info');
}
// Put the picture back to how it was before this stroke, then paint the shape.
function _annotSnapPaint(rec) {
  const a = _annot, S = _annotShapeSnap(), ctx = a.ctx;
  const top = a.history[a.history.length - 1];
  if (!top) return;
  ctx.putImageData(top.img, 0, 0);
  const pts = S.toPoints(rec), lw = Math.max(1, Math.round(a.size));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  _annotPaintCompose(ctx);
  ctx.lineWidth = lw;
  if (lw <= 1) {
    for (let i = 1; i < pts.length; i++) _annotPlotLine(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  } else {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  _annotResetCompose();
  ctx.beginPath();
  // A later Shift-click continues from where the SNAPPED shape ends, not from
  // wherever the freehand stroke happened to stop.
  a.last = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
}
// After the snap the pointer adjusts the shape (a line's end, a circle's radius…).
function _annotSnapAdjust(p) {
  const a = _annot, S = _annotShapeSnap();
  if (!a || !S || !a.snapDesc) return;
  a.snapDesc = S.drag(a.snapDesc, p);
  if (a.tool === 'lasso') { a.selPts = S.toPoints(a.snapDesc); return; }
  if (a.snapRaf) return;                              // one repaint per display frame
  a.snapRaf = requestAnimationFrame(() => {
    if (!_annot) return;
    _annot.snapRaf = 0;
    if (_annot.snapDesc && _annot.drawing) _annotSnapPaint(_annot.snapDesc);
  });
}

// ---- 🖊️ PEN SELECT ---------------------------------------------------------
const ANNOT_PEN_HIT_PX = 9, ANNOT_PEN_SLOP_PX = 4, ANNOT_PEN_DOUBLE_MS = 400;
function _annotPenActive() { return !!(_annot && _annot.pen && _annot.pen.anchors.length); }
function _annotPenCancel() {
  if (!_annot || !_annot.pen) return;
  const had = _annot.pen.anchors.length;
  _annot.pen = null;
  if (_annot.tool === 'penselect') _annot.drawing = false;
  return had;
}
// Pointer went down with the pen: a new anchor, a grab of an existing one, or the close.
function _annotPenDown(e, p) {
  const S = _annotShapeSnap();
  if (!S) { showToast('Pen select needs shape-snap.js, which did not load', 'error'); return; }
  const a = _annot, unit = _annotPxUnit(), now = performance.now();
  if (!a.pen) a.pen = { anchors: [], drag: null, hover: p, lastClick: null, closeHot: false };
  const pen = a.pen;
  // Double-click ends an open path, like Photoshop.
  const lc = pen.lastClick;
  if (lc && now - lc.t < ANNOT_PEN_DOUBLE_MS && Math.hypot(p.x - lc.x, p.y - lc.y) < 6 * unit && pen.anchors.length >= 3) {
    _annotPenClose();
    return;
  }
  // Direct-select: a handle or anchor under the pointer is dragged, not duplicated.
  const hit = pen.anchors.length ? S.hitAnchors(pen.anchors, p, ANNOT_PEN_HIT_PX * unit) : null;
  if (hit) {
    if (hit.part === 'anchor' && hit.i === 0 && pen.anchors.length >= 3) { _annotPenClose(); return; }
    pen.drag = { kind: 'move', hit, from: { x: p.x, y: p.y }, orig: JSON.parse(JSON.stringify(pen.anchors[hit.i])), alt: !!e.altKey };
    a.drawing = true;
    return;
  }
  if (!pen.anchors.length) { a.sel = null; _annotSelSyncBar(); }   // a new path replaces the old selection
  let q = p;
  if (e.shiftKey && pen.anchors.length) q = _annotSnap45(pen.anchors[pen.anchors.length - 1], p);
  pen.anchors.push({ x: q.x, y: q.y });
  pen.drag = { kind: 'new', idx: pen.anchors.length - 1, fromClient: { x: e.clientX, y: e.clientY }, moved: false };
  pen.lastClick = { t: now, x: q.x, y: q.y };
  a.drawing = true;
}
// A drag in progress: pull handles out of a fresh anchor, or move what was grabbed.
function _annotPenDrag(e) {
  const S = _annotShapeSnap(), pen = _annot && _annot.pen;
  if (!S || !pen || !pen.drag) return;
  const p = _annotPt(e), d = pen.drag;
  pen.hover = p;
  if (d.kind === 'new') {
    if (!d.moved && Math.hypot(e.clientX - d.fromClient.x, e.clientY - d.fromClient.y) < ANNOT_PEN_SLOP_PX) return;
    d.moved = true;
    const an = pen.anchors[d.idx];
    S.setSmoothHandles(an, e.shiftKey ? _annotSnap45(an, p) : p);
    return;
  }
  const an = pen.anchors[d.hit.i], dx = p.x - d.from.x, dy = p.y - d.from.y;
  if (d.hit.part === 'anchor') {
    an.x = d.orig.x + dx; an.y = d.orig.y + dy;
    ['hin', 'hout'].forEach(k => { if (d.orig[k]) an[k] = { x: d.orig[k].x + dx, y: d.orig[k].y + dy }; });
    return;
  }
  const other = d.hit.part === 'hout' ? 'hin' : 'hout';
  an[d.hit.part] = { x: p.x, y: p.y };
  // A smooth anchor keeps its handles in line; Alt breaks that for this one.
  if (!d.alt && an[other]) an[other] = { x: 2 * an.x - p.x, y: 2 * an.y - p.y };
}
// The pointer moved with no button down: the rubber band and the "close here" cue.
function _annotPenHover(e) {
  const pen = _annot && _annot.pen;
  if (!pen || !pen.anchors.length) return;
  const c = document.getElementById('annotCanvas');
  if (!c || e.target !== c) return;
  const p = _annotPt(e), first = pen.anchors[0];
  pen.hover = p;
  pen.closeHot = pen.anchors.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= ANNOT_PEN_HIT_PX * _annotPxUnit();
}
function _annotPenRemoveLast() {
  const pen = _annot && _annot.pen;
  if (!pen || !pen.anchors.length) return;
  pen.anchors.pop();
  pen.lastClick = null;
  if (!pen.anchors.length) _annotPenCancel();
}
// Close the path and make it the selection.
function _annotPenClose() {
  const S = _annotShapeSnap(), pen = _annot && _annot.pen;
  if (!S || !pen) return;
  if (pen.anchors.length < 3) { showToast('Click at least three points, then close the path', 'info'); return; }
  const poly = S.flattenAnchors(pen.anchors, true, Math.max(0.25, _annotPxUnit() * 0.4));
  if (poly.length < 3 || S.polygonArea(poly) < 9) {
    _annotPenCancel();
    showToast('That path encloses no area — try again', 'info');
    return;
  }
  _annot.sel = { pts: poly };
  _annot.selPts = null;
  _annot.pen = null;
  _annot.drawing = false;
  _annotSelSyncBar();
  showToast('Area selected — pick a fill option above the image', 'info');
}
// The in-progress path, drawn on the selection canvas next to the marching ants.
// `s` is the display scale, so every size is in SCREEN pixels whatever the zoom.
function _annotPenDraw(sctx, pen, s) {
  const S = _annotShapeSnap();
  if (!S || !pen.anchors.length) return;
  sctx.save();                       // the ants loop shares this context frame to frame
  const anchors = pen.anchors.map(a => Object.assign({}, a));
  const preview = pen.hover && !(pen.drag && pen.drag.kind === 'new' && pen.drag.moved) ? pen.hover : null;
  const draft = preview ? anchors.concat([{ x: preview.x, y: preview.y }]) : anchors;
  const flat = S.flattenAnchors(draft, false, 0.5 / s);
  sctx.setLineDash([]);
  sctx.lineJoin = 'round'; sctx.lineCap = 'round';
  const trace = pts => { sctx.beginPath(); pts.forEach((q, i) => i ? sctx.lineTo(q.x, q.y) : sctx.moveTo(q.x, q.y)); };
  if (flat.length > 1) {
    trace(flat);
    sctx.lineWidth = 3.2 / s; sctx.strokeStyle = 'rgba(255,255,255,0.95)'; sctx.stroke();
    sctx.lineWidth = 1.4 / s; sctx.strokeStyle = '#0a6cff'; sctx.stroke();
  }
  if (anchors.length >= 3) {           // where the path would close, faintly
    sctx.setLineDash([4 / s, 4 / s]);
    const last = anchors[anchors.length - 1];
    const closing = S.flattenAnchors([last, anchors[0]], false, 0.5 / s);
    trace(closing);
    sctx.lineWidth = 1 / s; sctx.strokeStyle = 'rgba(10,108,255,0.55)'; sctx.stroke();
    sctx.setLineDash([]);
  }
  const r = 3.4 / s;
  anchors.forEach(a => {
    ['hin', 'hout'].forEach(k => {
      if (!a[k]) return;
      sctx.beginPath(); sctx.moveTo(a.x, a.y); sctx.lineTo(a[k].x, a[k].y);
      sctx.lineWidth = 1 / s; sctx.strokeStyle = '#0a6cff'; sctx.stroke();
      sctx.beginPath(); sctx.arc(a[k].x, a[k].y, r * 0.8, 0, Math.PI * 2);
      sctx.fillStyle = '#ffffff'; sctx.fill(); sctx.stroke();
    });
  });
  anchors.forEach((a, i) => {
    const first = i === 0, hot = first && pen.closeHot;
    const rr = hot ? r * 1.7 : r;
    sctx.beginPath(); sctx.rect(a.x - rr, a.y - rr, rr * 2, rr * 2);
    sctx.fillStyle = hot ? '#16a34a' : (i === anchors.length - 1 ? '#0a6cff' : '#ffffff');
    sctx.fill();
    sctx.lineWidth = 1.2 / s; sctx.strokeStyle = hot ? '#ffffff' : '#0a6cff'; sctx.stroke();
  });
  sctx.restore();
}
// ---- SELECTION (rectangle / lasso) with marching ants, then fill the area
// with a flat colour, the surrounding texture, or AI content-aware fill. ----
function _annotSelPath(pts) {
  const path = new Path2D();
  if (!pts || pts.length < 2) return path;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}
function _annotSelSyncBar() {
  const bar = document.getElementById('annotSelBar');
  if (bar) bar.style.display = (_annot && _annot.sel) ? 'flex' : 'none';
  _annotAiSyncScope();   // ✨ Regenerate says which of its two scopes it is about to use
}
// The bounding box of a selection, whichever shape it is — a polygon from the
// rectangle / lasso tools, or a masked rect from the magic wand.
function _annotSelBox(sel) {
  if (!sel) return null;
  if (!sel.pts) return { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  sel.pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
function annotSelClear() {
  if (!_annot) return;
  _annot.sel = null; _annot.selPts = null;
  _annotSelSyncBar();
}

// ---- MAGIC WAND -----------------------------------------------------------
// Click a colour and every pixel like it becomes the selection. Contiguous by
// default (the patch you clicked); Alt+click takes that colour across the whole
// picture, which is how you grab, say, every bit of a printed grey watermark in
// one go. "Like it" is the ± slider: squared RGB distance, same yardstick the
// paint bucket uses, so the two tools behave consistently.
//
// The result is a per-pixel MASK, not a polygon — a wand selection can be full
// of holes and islands that no outline could describe. Every selection
// operation below therefore works from a mask, and the polygon tools simply
// rasterise into one.
function _annotMagicWand(sx, sy, global) {
  const cv = _annot.canvas, W = cv.width, H = cv.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const d = _annot.ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => (y * W + x) * 4;
  const s0 = at(sx, sy);
  const tr = d[s0], tg = d[s0 + 1], tb = d[s0 + 2];
  const t = Math.max(1, _annot.tol || 32), TOL = t * t * 3;
  const near = i => { const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb; return dr * dr + dg * dg + db * db <= TOL; };
  const mask = new Uint8Array(W * H);
  if (global) {
    for (let k = 0; k < mask.length; k++) if (near(k * 4)) mask[k] = 1;
  } else {
    const stack = [sy * W + sx];
    mask[sy * W + sx] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % W, y = (k / W) | 0;
      if (x > 0 && !mask[k - 1] && near(at(x - 1, y))) { mask[k - 1] = 1; stack.push(k - 1); }
      if (x < W - 1 && !mask[k + 1] && near(at(x + 1, y))) { mask[k + 1] = 1; stack.push(k + 1); }
      if (y > 0 && !mask[k - W] && near(at(x, y - 1))) { mask[k - W] = 1; stack.push(k - W); }
      if (y < H - 1 && !mask[k + W] && near(at(x, y + 1))) { mask[k + W] = 1; stack.push(k + W); }
    }
  }
  // Crop to the pixels actually hit so every later pass works on a small box.
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = mask[(y + y0) * W + (x + x0)];
  return { x: x0, y: y0, w, h, mask: out, count: n };
}

// The outline of a mask, as edge segments between a selected and an unselected
// pixel. Marching ants ride this exactly like they ride a lasso path.
function _annotMaskOutline(m) {
  const path = new Path2D();
  const on = (x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h) ? 0 : m.mask[y * m.w + x];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!on(x, y)) continue;
    const px = m.x + x, py = m.y + y;
    if (!on(x, y - 1)) { path.moveTo(px, py); path.lineTo(px + 1, py); }
    if (!on(x, y + 1)) { path.moveTo(px, py + 1); path.lineTo(px + 1, py + 1); }
    if (!on(x - 1, y)) { path.moveTo(px, py); path.lineTo(px, py + 1); }
    if (!on(x + 1, y)) { path.moveTo(px + 1, py); path.lineTo(px + 1, py + 1); }
  }
  return path;
}
// Marching-ants animation: redraw the selection outline on the overlay canvas
// while the tool is open. Dash length is in screen pixels regardless of zoom.
let _annotAntsRunning = false;
function _annotAntsLoop() {
  if (!_annot || !_annot.selCanvas) { _annotAntsRunning = false; return; }
  _annotAntsRunning = true;
  const sc = _annot.selCanvas, sctx = sc.getContext('2d');
  sctx.clearRect(0, 0, sc.width, sc.height);
  const pts = (_annot.drawing && _annot.selPts) ? _annot.selPts : (_annot.sel && _annot.sel.pts ? _annot.sel.pts : null);
  let path = null;
  if (pts && pts.length > 1) path = _annotSelPath(pts);
  else if (_annot.sel && _annot.sel.outline) path = _annot.sel.outline;
  if (path) {
    const s = _annotDisplayScale() || 1;
    const phase = (performance.now() / 90) % 16;
    sctx.lineWidth = Math.max(1 / s, 0.5);
    sctx.setLineDash([6 / s, 6 / s]);
    sctx.strokeStyle = '#ffffff'; sctx.lineDashOffset = -phase / s; sctx.stroke(path);
    sctx.strokeStyle = '#111111'; sctx.lineDashOffset = -(phase + 6) / s; sctx.stroke(path);
  }
  // 🖊️ Pen select: the path being laid down, with its anchors and handles.
  if (_annot.pen) _annotPenDraw(sctx, _annot.pen, _annotDisplayScale() || 1);
  // The transform box rides the same overlay: the object's real outline while
  // it is being turned, slanted or resized, with grab handles on it while the
  // Resize tool is the one in hand.
  const xf = _annot.xform;
  if (xf && xf.layer) {
    const s = _annotDisplayScale() || 1;
    const c = _annotXformCorners(xf);
    const off = { x: xf.offX || 0, y: xf.offY || 0 };
    sctx.setLineDash([]);
    sctx.beginPath();
    c.forEach((p, i) => { const X = p.x + off.x, Y = p.y + off.y; i ? sctx.lineTo(X, Y) : sctx.moveTo(X, Y); });
    sctx.closePath();
    sctx.lineWidth = Math.max(1.4 / s, 0.5);
    sctx.strokeStyle = 'rgba(255,255,255,0.95)'; sctx.stroke();
    sctx.lineWidth = Math.max(0.7 / s, 0.25);
    sctx.strokeStyle = '#b45309'; sctx.stroke();
    if (_annot.tool === 'scale') {
      const r = 5 / s;
      _annotXformHandles(xf).forEach(h => {
        const X = h.pt.x + off.x, Y = h.pt.y + off.y;
        sctx.beginPath(); sctx.rect(X - r, Y - r, r * 2, r * 2);
        sctx.fillStyle = '#ffffff'; sctx.fill();
        sctx.lineWidth = Math.max(1 / s, 0.4);
        sctx.strokeStyle = '#b45309'; sctx.stroke();
      });
    }
  }
  if (xf && xf.strLine) {
    const s = _annotDisplayScale() || 1;
    sctx.setLineDash([]);
    sctx.lineCap = 'round';
    sctx.lineWidth = Math.max(1.5 / s, 0.6);
    sctx.beginPath();
    sctx.moveTo(xf.strLine.from.x, xf.strLine.from.y);
    sctx.lineTo(xf.strLine.to.x, xf.strLine.to.y);
    sctx.strokeStyle = 'rgba(255,255,255,0.9)'; sctx.stroke();
    sctx.lineWidth = Math.max(0.8 / s, 0.3);
    sctx.strokeStyle = '#0b6b4f'; sctx.stroke();
  }
  requestAnimationFrame(_annotAntsLoop);
}
// Rasterise the selection into a bounding box + per-pixel mask (1 = selected).
// A wand selection already IS a mask and is handed straight back.
function _annotSelMask() {
  const sel = _annot && _annot.sel; if (!sel) return null;
  if (sel.mask) return sel;
  const W = _annot.canvas.width, H = _annot.canvas.height;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  sel.pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0;
  if (w < 1 || h < 1) return null;
  const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
  const mx = mc.getContext('2d');
  mx.translate(-x0, -y0);
  mx.fillStyle = '#fff';
  mx.fill(_annotSelPath(sel.pts));
  const md = mx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3] > 127 ? 1 : 0;
  return { x: x0, y: y0, w, h, mask };
}
// Apply a callback clipped to the selection, whichever kind it is: a polygon
// gets a real canvas clip (anti-aliased edges), a wand mask is composited
// pixel-by-pixel. One helper so every selection action supports both.
function _annotWithSelClip(fn) {
  const sel = _annot && _annot.sel; if (!sel) return;
  const ctx = _annot.ctx;
  if (sel.pts) { ctx.save(); ctx.clip(_annotSelPath(sel.pts)); fn(ctx); ctx.restore(); return; }
  const m = sel;
  const scratch = document.createElement('canvas');
  scratch.width = _annot.canvas.width; scratch.height = _annot.canvas.height;
  const sx = scratch.getContext('2d');
  fn(sx);
  const before = ctx.getImageData(m.x, m.y, m.w, m.h);
  const after = sx.getImageData(m.x, m.y, m.w, m.h);
  for (let k = 0; k < m.mask.length; k++) {
    if (!m.mask[k] || after.data[k * 4 + 3] === 0) continue;
    const i = k * 4;
    before.data[i] = after.data[i]; before.data[i + 1] = after.data[i + 1];
    before.data[i + 2] = after.data[i + 2]; before.data[i + 3] = 255;
  }
  ctx.putImageData(before, m.x, m.y);
}
// ---- DELETE: cut the selection away to nothing -----------------------------
// The flow this exists for: pick the 🪄 wand, click the colour that should not
// be there (Alt+click to take it across the WHOLE picture), press Delete. Those
// pixels become transparent — not white, not black, gone — and the PNG that is
// saved keeps the hole.
function annotSelDelete() {
  if (!_annot || !_annot.sel) { showToast('Select an area first — 🪄 wand, ⬚ select or ➰ lasso', 'info'); return; }
  _annotPushHistory();
  const ctx = _annot.ctx, sel = _annot.sel;
  if (sel.pts) {
    // A polygon gets a real clip, so the edge is anti-aliased rather than jagged.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill(_annotSelPath(sel.pts));
    ctx.restore();
  } else {
    const m = sel;
    const d = ctx.getImageData(m.x, m.y, m.w, m.h);
    for (let k = 0; k < m.mask.length; k++) if (m.mask[k]) d.data[k * 4 + 3] = 0;
    ctx.putImageData(d, m.x, m.y);
  }
  showToast('Deleted — that area is transparent now ✓', 'success');
}
function annotSelFillColour() {
  if (!_annot || !_annot.sel) return;
  _annotSyncControls();
  _annotPushHistory();
  const sel = _annot.sel, colour = _annot.color;
  _annotWithSelClip(c => {
    c.fillStyle = colour;
    if (sel.pts) c.fill(_annotSelPath(sel.pts));
    else c.fillRect(sel.x, sel.y, sel.w, sel.h);
  });
  showToast('Selection filled ✓', 'success');
}
// "Fill from surroundings" — onion-peel inpainting: BFS inwards from the
// selection edge, each unknown pixel takes the average of its already-known
// neighbours. Fast, local, great for paper/flat backgrounds.
function annotSelPatchFill() {
  if (!_annot || !_annot.sel) return;
  const m = _annotSelMask(); if (!m) return;
  _annotPushHistory();
  const ctx = _annot.ctx, W = _annot.canvas.width, H = _annot.canvas.height;
  // Work on a box one pixel wider than the selection so the border ring is known.
  const bx = Math.max(0, m.x - 1), by = Math.max(0, m.y - 1);
  const bw = Math.min(W, m.x + m.w + 1) - bx, bh = Math.min(H, m.y + m.h + 1) - by;
  const img = ctx.getImageData(bx, by, bw, bh), d = img.data;
  const unknown = new Uint8Array(bw * bh);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.mask[y * m.w + x]) unknown[(y + m.y - by) * bw + (x + m.x - bx)] = 1;
  }
  const queue = [];
  const edge = k => {   // unknown pixel touching at least one known pixel
    const x = k % bw, y = (k / bw) | 0;
    return (x > 0 && !unknown[k - 1]) || (x < bw - 1 && !unknown[k + 1]) || (y > 0 && !unknown[k - bw]) || (y < bh - 1 && !unknown[k + bw]);
  };
  for (let k = 0; k < unknown.length; k++) if (unknown[k] && edge(k)) queue.push(k);
  let qi = 0;
  while (qi < queue.length) {
    const k = queue[qi++];
    if (!unknown[k]) continue;
    const x = k % bw, y = (k / bw) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const nk = ny * bw + nx;
      if (unknown[nk]) continue;
      const i = nk * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) continue;   // no known neighbour (selection spans the whole image edge) — leave as-is
    const i = k * 4;
    d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; d[i + 3] = 255;
    unknown[k] = 0;
    // enqueue unknown 4-neighbours
    if (x > 0 && unknown[k - 1]) queue.push(k - 1);
    if (x < bw - 1 && unknown[k + 1]) queue.push(k + 1);
    if (y > 0 && unknown[k - bw]) queue.push(k - bw);
    if (y < bh - 1 && unknown[k + bw]) queue.push(k + bw);
  }
  ctx.putImageData(img, bx, by);
  showToast('Filled from the surrounding texture ✓', 'success');
}
// AI content-aware fill: paint the selection solid magenta on a copy, ask the
// Gemini image model to reconstruct that region from its surroundings, then
// composite the result back clipped to the selection — pixels outside the
// selection are never touched.
function _annotAiSyncScope() {}
function _annotAiBarInit() {}
function _annotDown(e) {
  if (!_annot) return;
  e.preventDefault();
  _annotSyncControls();
  const p = _annotPt(e), ctx = _annot.ctx;
  if (_annot.tool === 'text') { _annotPlaceText(p); return; }
  if (_annot.tool === 'penselect') { _annotPenDown(e, p); return; }
  if (_annot.tool === 'fill') { _annotPushHistory(); _annotFloodFill(p.x, p.y); return; }
  if (_annot.tool === 'wand') {
    const m = _annotMagicWand(p.x, p.y, e.altKey);
    if (!m) { showToast('Nothing matched there — try a bigger ±', 'info'); return; }
    m.outline = _annotMaskOutline(m);
    _annot.sel = m;
    _annotSelSyncBar();
    showToast(m.count.toLocaleString() + ' pixels selected' + (e.altKey ? ' across the whole picture' : '') +
      ' — fill it, move it, or widen the ± slider', 'info');
    return;
  }
  if (_annot.tool === 'scale') {
    if (!_annot.xform) _annotXformBegin();
    const x = _annot.xform; if (!x) return;
    const h = _annotXformHandleAt(p);
    if (h) { _annotXformScaleStart(h); _annot.start = p; _annot.drawing = true; return; }
    // Not on a handle: dragging the middle of the box slides the object.
    if (_annotXformInside(p)) { _annot.start = p; _annot.xfMove = true; _annot.drawing = true; return; }
    showToast('Drag a corner or edge handle to resize — or inside the box to move it', 'info');
    return;
  }
  if (_annot.tool === 'rotate' || _annot.tool === 'skew') {
    if (!_annot.xform) _annotXformBegin();
    const x = _annot.xform; if (!x) return;
    if (x.straighten) { x.strLine = { from: p, to: p }; _annot.drawing = true; return; }
    _annot.start = p;
    _annot.xfStart = { angle: x.angle, skewX: x.skewX, skewY: x.skewY, ang0: Math.atan2(p.y - x.cy, p.x - x.cx) };
    _annot.drawing = true;
    return;
  }
  if (_annot.tool === 'move') {
    if (!_annot.sel) { showToast('Select an area first (⬚, ➰ or 🪄), then drag it with Move', 'info'); return; }
    _annotPushHistory();
    _annot.float = _annotSelLift(e.altKey);
    if (!_annot.float) return;
    _annot.start = p;
    _annot.drawing = true;
    return;
  }
  if (_annot.tool === 'history') {
    _annotPushHistory();
    _annot.drawing = true;
    _annot.last = p;
    _annotHistoryDab(p.x, p.y);
    return;
  }
  if (_annot.tool === 'select' || _annot.tool === 'lasso') {
    _annot.sel = null; _annotSelSyncBar();
    _annot.selPts = _annot.tool === 'select' ? [p, p, p, p] : [p];
    _annot.start = p;
    _annot.drawing = true;
    if (_annot.tool === 'lasso') _annotSnapBegin(e, p);   // hold still to snap the outline
    return;
  }
  if (_annot.tool === 'clone') {
    // First click (or Alt+click) sets the source; later drags stamp from it.
    if (e.altKey || !_annot.cloneSrc) {
      _annot.cloneSrc = { x: p.x, y: p.y };
      _annotUpdateCloneMarker();
      _annotUpdateBrushRing();   // the ring can start previewing the moment there is a source
      showToast('Clone source set — the ring under your pointer now shows what will be stamped', 'info');
      return;
    }
    _annotPushHistory();
    const snap = document.createElement('canvas');
    snap.width = _annot.canvas.width; snap.height = _annot.canvas.height;
    snap.getContext('2d').drawImage(_annot.canvas, 0, 0);
    _annot.cloneSnap = snap;
    _annot.cloneOff = { x: p.x - _annot.cloneSrc.x, y: p.y - _annot.cloneSrc.y };
    _annot.drawing = true;
    _annot.last = p;
    _annotCloneDab(ctx, p.x, p.y);
    _annotUpdateBrushRing();   // the offset is locked in now — preview from the frozen snapshot
    return;
  }
  _annotPushHistory();
  if (_annot.tool === 'line') {
    _annot.start = p;
    _annot.snap = ctx.getImageData(0, 0, _annot.canvas.width, _annot.canvas.height);
    _annot.drawing = true;
    return;
  }
  // erase / paint brush
  // Photoshop straight-line join: click once, then Shift-click somewhere else —
  // the two points are connected with one straight stroke.
  if (e.shiftKey && _annot.anchor) {
    _annotBrushLine(_annot.anchor, p);
    _annot.drawing = true;
    _annot.last = p;
    _annot.shiftSeg = null;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    return;
  }
  _annot.drawing = true;
  _annot.last = p;
  _annot.shiftSeg = null; // Shift-straight segment state (start pt + snapshot)
  if (_annot.tool === 'paint') _annotSnapBegin(e, p);   // hold still to snap the stroke to a shape
  // Brush size is measured in IMAGE pixels (Photoshop-style): size 1 = one pixel,
  // independent of the current zoom, so precise edits are possible when zoomed in.
  const lw = Math.max(1, Math.round(_annot.size));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // The mode is set for the WHOLE stroke — the drag carries on in pointermove
  // against this same context — and _annotUp puts it back.
  _annotPaintCompose(ctx);
  ctx.lineWidth = lw;
  if (lw <= 1) {
    // A 1px brush paints a crisp single pixel (no anti-aliasing) — pixel-perfect.
    ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
  } else {
    ctx.beginPath(); ctx.arc(p.x, p.y, lw / 2, 0, Math.PI * 2); ctx.fill(); // a click paints a dot
  }
  ctx.beginPath(); ctx.moveTo(p.x, p.y);
}
function _annotMove(e) {
  if (!_annot || !_annot.drawing) return;
  e.preventDefault();
  const p = _annotPt(e), ctx = _annot.ctx;
  if (_annot.tool === 'penselect') { _annotPenDrag(e); return; }
  if (_annot.snapHold) _annot.snapHold.move(e.clientX, e.clientY);   // a real move restarts the wait
  // Once snapped, the pointer adjusts the SHAPE rather than drawing further ink.
  if (_annot.snapDesc && ANNOT_SNAP_TOOLS[_annot.tool]) { _annotSnapAdjust(p); return; }
  if (_annot.tool === 'scale') {
    if (_annot.xfScale) { _annotXformScaleDrag(p, e.shiftKey); return; }
    if (_annot.xfMove && _annot.start) {
      let dx = p.x - _annot.start.x, dy = p.y - _annot.start.y;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }   // Shift = straight
      _annotXformMoveTo(dx, dy);
      _annot.start = p;
    }
    return;
  }
  if (_annot.tool === 'rotate' || _annot.tool === 'skew') {
    const x = _annot.xform; if (!x) return;
    if (x.straighten) { if (x.strLine) x.strLine.to = p; return; }   // the guide is drawn by the ants loop
    if (!_annot.xfStart) return;
    if (_annot.tool === 'rotate') {
      const a = Math.atan2(p.y - x.cy, p.x - x.cx);
      let deg = _annot.xfStart.angle + (a - _annot.xfStart.ang0) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;   // Shift snaps to 15°, like every transform tool
      x.angle = _annotWrapDeg(deg);
    } else {
      // Drag sideways to slant sideways, up/down to slant up/down. A drag across
      // half the picture is 45° of slant; Shift locks to one axis.
      let dx = p.x - _annot.start.x, dy = p.y - _annot.start.y;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      const spanX = Math.max(40, _annot.canvas.height / 2), spanY = Math.max(40, _annot.canvas.width / 2);
      x.skewX = _annotClampNum(_annot.xfStart.skewX + dx / spanX * 45, -60, 60);
      x.skewY = _annotClampNum(_annot.xfStart.skewY + dy / spanY * 45, -60, 60);
    }
    _annotXformSyncBar();
    _annotXformPreview();
    return;
  }
  if (_annot.tool === 'move') {
    if (!_annot.float) return;
    let dx = p.x - _annot.start.x, dy = p.y - _annot.start.y;
    if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }   // Shift = straight
    _annot.float.dx = Math.round(dx); _annot.float.dy = Math.round(dy);
    _annotFloatDraw();
    return;
  }
  if (_annot.tool === 'history') { _annotHistoryStroke(_annot.last, p); _annot.last = p; return; }
  if (_annot.tool === 'select' || _annot.tool === 'lasso') {
    if (!_annot.selPts) return;
    if (_annot.tool === 'select') {
      const s = _annot.start, q = e.shiftKey ? _annotSquarePt(s, p) : p;   // Shift = square, like Photoshop
      _annot.selPts = [s, { x: q.x, y: s.y }, q, { x: s.x, y: q.y }];
    } else {
      _annot.selPts.push(p);
    }
    return;
  }
  if (_annot.tool === 'clone') { _annotCloneStroke(_annot.last, p); _annot.last = p; return; }
  if (_annot.tool === 'line') {
    const end = e.shiftKey ? _annotSnap45(_annot.start, p) : p;
    ctx.putImageData(_annot.snap, 0, 0);
    ctx.strokeStyle = _annot.color; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, Math.round(_annot.size));
    ctx.beginPath(); ctx.moveTo(_annot.start.x, _annot.start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    return;
  }
  // Hold Shift while erasing/painting: the stroke is locked to the horizontal
  // or vertical axis (whichever is dominant), live-previewed by restoring the
  // snapshot — just like Photoshop's Shift-drag brush.
  if (e.shiftKey) {
    if (!_annot.shiftSeg) {
      _annot.shiftSeg = {
        start: _annot.last,
        snap: ctx.getImageData(0, 0, _annot.canvas.width, _annot.canvas.height)
      };
    }
    const s = _annot.shiftSeg.start;
    const q = _annotSnapAxis(s, p);
    ctx.putImageData(_annot.shiftSeg.snap, 0, 0);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(q.x, q.y);
    _annot.last = q;
    return;
  }
  if (_annot.shiftSeg) {
    // Shift released mid-stroke — the straight segment stays; carry on
    // freehand from its end.
    _annot.shiftSeg = null;
    ctx.beginPath(); ctx.moveTo(_annot.last.x, _annot.last.y);
  }
  if (Math.max(1, Math.round(_annot.size)) <= 1) {
    // Pixel-perfect 1px drag: plot crisp pixels between samples.
    _annotPlotLine(ctx, _annot.last.x, _annot.last.y, p.x, p.y);
  } else {
    ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  _annot.last = p;
  if (_annot.snapPts && _annot.snapPts.length < 6000) _annot.snapPts.push({ x: p.x, y: p.y });   // the raw stroke, for hold-to-snap
}
function _annotUp() {
  if (!_annot) return;
  _annotSnapEnd();   // the pointer is up: nothing is waiting to snap, and no repaint may land after this
  if (_annot.tool === 'penselect') {
    // The path stays open between clicks; only the drag that was in progress ends.
    if (_annot.pen) _annot.pen.drag = null;
    _annot.drawing = false;
    return;
  }
  if (_annot.xform && _annot.tool === 'scale') {
    // The box has moved or changed size, so the pivot goes back to its middle —
    // otherwise a turn afterwards swings the object round a point off to one side.
    if (_annot.xfScale || _annot.xfMove) _annotXformRecentre(_annot.xform);
    _annot.xfScale = null; _annot.xfMove = false;
    _annot.drawing = false; _annot.start = null;
    _annotXformSyncBar();
    return;
  }
  if (_annot.xform && (_annot.tool === 'rotate' || _annot.tool === 'skew')) {
    if (_annot.xform.straighten && _annot.xform.strLine) _annotXformStraightenFinish();
    _annot.drawing = false; _annot.start = null; _annot.xfStart = null;
    return;
  }
  if (_annot.float) {
    _annotFloatCommit();
    _annot.drawing = false; _annot.start = null; _annot.last = null;
    return;
  }
  if (_annot.drawing && _annot.selPts && (_annot.tool === 'select' || _annot.tool === 'lasso')) {
    // Finalise the selection: keep it only if it has real area.
    const pts = _annot.selPts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    _annot.sel = (pts.length >= 3 && (x1 - x0) >= 3 && (y1 - y0) >= 3) ? { pts: pts.slice() } : null;
    _annot.selPts = null;
    _annotSelSyncBar();
    if (_annot.sel) showToast('Area selected — pick a fill option above the image', 'info');
  }
  // Remember where the brush stroke ended — a later Shift-click continues from
  // here with a straight line (Photoshop behaviour).
  if ((_annot.tool === 'erase' || _annot.tool === 'paint') && _annot.last) _annot.anchor = _annot.last;
  _annotResetCompose();
  _annot.drawing = false; _annot.start = null; _annot.snap = null; _annot.shiftSeg = null; _annot.last = null; _annot.cloneSnap = null; _annot.cloneOff = null;
  _annotUpdateBrushRing();   // the offset is released — the preview goes back to showing the source itself
}
function _annotPlaceText(p) {
  const stage = document.getElementById('annotStage');
  if (!stage) return;
  const fontNat = Math.max(14, _annot.size * 2.6);
  // A draggable label: a wrapper holding a "move" handle + the text input. The
  // teacher can reposition it freely, and it burns onto the canvas wherever the
  // input ends up (not the original click point).
  const box = document.createElement('div');
  box.className = 'annot-textbox';
  // Position relative to the stage viewport (the canvas is transformed within it).
  const _sr = stage.getBoundingClientRect();
  box.style.left = ((p.clientX != null ? p.clientX - _sr.left : p.dispX)) + 'px';
  box.style.top = ((p.clientY != null ? p.clientY - _sr.top : p.dispY)) + 'px';
  const handle = document.createElement('div');
  handle.className = 'annot-textbox-handle';
  handle.textContent = '✥ drag';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'annot-textbox-input';
  input.style.color = _annot.color;
  input.style.fontSize = Math.max(10, Math.round(fontNat / p.scale)) + 'px';
  box.appendChild(handle);
  box.appendChild(input);
  if (_annot.tool === 'move') box.classList.add('movable');
  stage.appendChild(box);
  setTimeout(() => input.focus(), 0);

  // --- drag to reposition ---
  // The little handle always drags. With the Move tool active the body of the
  // label drags too, so "Move" repositions text as well as pixels.
  let drag = null;
  const startDrag = (ev, el) => {
    ev.preventDefault(); ev.stopPropagation();   // keep input focus; don't draw on the canvas
    drag = { dx: ev.clientX - box.offsetLeft, dy: ev.clientY - box.offsetTop };
    try { el.setPointerCapture(ev.pointerId); } catch (e) {}
  };
  const moveDrag = ev => {
    if (!drag) return;
    const sr = stage.getBoundingClientRect();
    let nx = ev.clientX - drag.dx, ny = ev.clientY - drag.dy;
    nx = Math.max(0, Math.min(sr.width - 10, nx));
    ny = Math.max(19, Math.min(sr.height - 6, ny));   // keep the handle on-screen
    box.style.left = nx + 'px'; box.style.top = ny + 'px';
  };
  const endDrag = (ev, el) => { drag = null; try { el.releasePointerCapture(ev.pointerId); } catch (e) {} input.focus(); };
  handle.addEventListener('pointerdown', ev => startDrag(ev, handle));
  handle.addEventListener('pointermove', moveDrag);
  handle.addEventListener('pointerup', ev => endDrag(ev, handle));
  input.addEventListener('pointerdown', ev => { if (_annot && _annot.tool === 'move') startDrag(ev, input); });
  input.addEventListener('pointermove', moveDrag);
  input.addEventListener('pointerup', ev => { if (drag) endDrag(ev, input); });

  let done = false;
  const commit = () => {
    if (done) return; done = true;
    const val = input.value.trim();
    if (val) {
      _annotPushHistory();
      const c = _annot.canvas, cr = c.getBoundingClientRect(), ir = input.getBoundingClientRect();
      const sx = c.width / cr.width, sy = c.height / cr.height;
      // input's content start = border-box left/top + ~border+padding (1px+4px / 1px+1px)
      const x = (ir.left - cr.left) * sx + 5 * sx;
      const y = (ir.top - cr.top) * sy + 2 * sy;
      const ctx = _annot.ctx;
      ctx.fillStyle = _annot.color;
      ctx.textBaseline = 'top';
      ctx.font = `600 ${Math.round(fontNat)}px 'DM Sans', sans-serif`;
      ctx.fillText(val, x, y);
    }
    if (box.parentNode) box.parentNode.removeChild(box);
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { done = true; if (box.parentNode) box.parentNode.removeChild(box); }
  });
  input.addEventListener('blur', () => { if (!drag) commit(); });   // don't commit while mid-drag
}
// ⬇️ Save the picture as it stands to a PNG file, without leaving the editor.
// It is on EVERY target, not just the standalone page: an answer-key diagram
// worth keeping outside the app, or a piece of card art wanted as a file, is
// the same one click. PNG end to end — a JPEG step here would flatten the
// alpha of anything that has been cut out to transparent.
function annotDownloadPng() {
  if (!_annot) return;
  if (_annot.xform) { annotXformApply(true); if (_annot.xform?.invalid) return; }
  document.querySelectorAll('#annotStage .annot-textbox-input').forEach(i => i.blur());
  try {
    const a = document.createElement('a');
    a.href = _annot.canvas.toDataURL('image/png');
    a.download = 'polymath-image.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('⬇️ Saved as a PNG', 'success');
  } catch (e) {
    console.warn('annot download failed', e);
    showToast('Could not save the PNG: ' + (e && e.message ? e.message : e), 'error');
  }
}
function applyAnnotTool() {
  if (!_annot) return;
  if (_annot.xform) { annotXformApply(true); if (_annot.xform?.invalid) return; }
  document.querySelectorAll('#annotStage .annot-textbox-input').forEach(i => i.blur());
  const canvas = _annot.canvas;
  const result = { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  const cb = bookApply; closeAnnotTool(); if (cb) cb(result);
}
function annotCropSelection() {
  if (!_annot || !_annot.sel) { showToast('Select a rectangular area first.'); return; }
  if (_annot.xform) annotXformApply(true);
  const m = _annotSelBox(_annot.sel);
  const x = Math.max(0, Math.floor(m.x)), y = Math.max(0, Math.floor(m.y));
  const w = Math.min(_annot.canvas.width-x, Math.ceil(m.w)), h = Math.min(_annot.canvas.height-y, Math.ceil(m.h));
  if (w < 1 || h < 1) return;
  _annotPushHistory();
  const px = _annot.ctx.getImageData(x,y,w,h);
  _annot.canvas.width=w; _annot.canvas.height=h; _annot.ctx.putImageData(px,0,0);
  if (_annot.selCanvas) { _annot.selCanvas.width=w; _annot.selCanvas.height=h; }
  annotSelClear(); annotZoomFit();
}
function closeAnnotTool() {
  const o = document.getElementById('annotOverlay'); if (o) o.classList.remove('show');
  const s = document.getElementById('annotStage'); if (s) s.querySelectorAll('.annot-textbox').forEach(el => el.remove());
  const cm = document.getElementById('annotCloneSrc'); if (cm) cm.remove();
  const br = document.getElementById('annotBrushRing'); if (br) br.remove();
  const bh = document.getElementById('annotBrushHud'); if (bh) bh.remove();
  if (_annot) clearTimeout(_annot.hudTimer);
  _annotSnapEnd();
  const sc = document.getElementById('annotSelCanvas'); if (sc) sc.getContext('2d').clearRect(0, 0, sc.width, sc.height);
  _annotUnbindZoomListeners();
  _annot = null;
  _annotSelSyncBar();
  _annotXformSyncBar();
}
document.addEventListener('click', function (e) {
  const t = e.target.closest && e.target.closest('[data-atool]');
  if (t) { e.preventDefault(); _annotSetTool(t.getAttribute('data-atool')); }
});
// Pan when Space is held or the middle mouse button is used; otherwise draw.
function _annotPanStart(e) {
  _annot.panning = true;
  _annot.panFrom = { x: e.clientX, y: e.clientY, panX: _annot.panX, panY: _annot.panY };
  const st = document.getElementById('annotStage'); if (st) st.classList.add('panning');
  _annotUpdateBrushRing();
  try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
}
function _annotPanMove(e) {
  if (!_annot || !_annot.panning || !_annot.panFrom) return;
  _annot.panX = _annot.panFrom.panX + (e.clientX - _annot.panFrom.x);
  _annot.panY = _annot.panFrom.panY + (e.clientY - _annot.panFrom.y);
  _annotClampPan();
  _annotUpdateTransform();
}
function _annotPanEnd() {
  if (_annot && _annot.panning) { _annot.panning = false; _annot.panFrom = null; const st = document.getElementById('annotStage'); if (st) st.classList.remove('panning'); _annotUpdateBrushRing(); }
}
document.addEventListener('pointerdown', function (e) {
  const c = document.getElementById('annotCanvas');
  if (!_annot || !c || e.target !== c) return;
  _annotTrackPointer(e);   // a tap with no movement before it still gets its ring
  if (_annot.space || e.button === 1) { e.preventDefault(); _annotPanStart(e); return; }
  if (e.button === 0) _annotDown(e);
});
document.addEventListener('pointermove', function (e) {
  if (!_annot) return;
  _annotTrackPointer(e);   // the ring follows the pointer whatever else is going on
  if (_annot.panning) { _annotPanMove(e); return; }
  if (_annot.drawing) { _annotMove(e); return; }
  if (_annot.tool === 'penselect') { _annotPenHover(e); return; }   // rubber band + "close here" cue
  // Hovering the transform box: the pointer says what each handle will do, so
  // a resize box behaves like one everywhere else does.
  if (_annot.tool === 'scale' && _annot.xform) {
    const c = document.getElementById('annotCanvas');
    if (c && e.target === c) {
      const p = _annotPt(e);
      const h = _annotXformHandleAt(p);
      c.style.cursor = h ? h.cur : (_annotXformInside(p) ? 'move' : 'default');
    }
  }
});
document.addEventListener('pointerup', function () { _annotPanEnd(); _annotUp(); _annotUpdateBrushRing(); });

// =====================================================================

Object.assign(window, {_annotSyncControls, annotCleanPaper, annotCropSelection, annotDownloadPng, annotPasteFromClipboard, annotSelClear, annotSelDelete, annotSelFillColour, annotSelPatchFill, annotToggleEraseTo, annotUndo, annotXformApply, annotXformCancel, annotXformFlip, annotXformNudge, annotXformReset, annotXformSet, annotXformSetGrow, annotXformSetLock, annotXformSetScale, annotXformStraightenStart, annotZoomFit, annotZoomStep, applyAnnotTool, closeAnnotTool});
window.BookTouchup = { open(src, callback) { bookApply=callback; _annotOpenSrc(Promise.resolve(src), {}, "CER touch-up · Original resolution"); }, isOpen: () => !!_annot, close: closeAnnotTool };
})();
