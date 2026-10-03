/* Synthetic "hand-drawn" strokes for the ShapeSnap tests. Seeded, so a failure
   reproduces: noise, wobble, uneven pen speed, overshoot, rounded corners. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

const P = (x, y) => ({ x, y });

/* Walk `dense` (a dense polyline) at an uneven speed, then add white jitter and
   a slow sideways wobble. `size` is the shape's own scale. */
export function hand(dense, r, size, opts = {}) {
  const { jitter = 0.006, wobble = 0.012, minStep = 0.012, maxStep = 0.05 } = opts;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const L = cum[cum.length - 1];
  const out = [];
  let s = 0, j = 1;
  const f1 = r.range(1.2, 2.4), f2 = r.range(3, 5), p1 = r.range(0, 6.28), p2 = r.range(0, 6.28);
  while (s <= L) {
    while (j < cum.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const t = (s - cum[j - 1]) / seg;
    let x = dense[j - 1].x + (dense[j].x - dense[j - 1].x) * t;
    let y = dense[j - 1].y + (dense[j].y - dense[j - 1].y) * t;
    // sideways wobble along the local normal
    const dx = dense[j].x - dense[j - 1].x, dy = dense[j].y - dense[j - 1].y, dl = Math.hypot(dx, dy) || 1;
    const w = size * wobble * (Math.sin(f1 * 6.28 * s / L + p1) * 0.7 + Math.sin(f2 * 6.28 * s / L + p2) * 0.3);
    x += (-dy / dl) * w + r.gauss() * size * jitter;
    y += (dx / dl) * w + r.gauss() * size * jitter;
    out.push(P(x, y));
    s += size * r.range(minStep, maxStep);
  }
  const last = dense[dense.length - 1];
  out.push(P(last.x + r.gauss() * size * jitter, last.y + r.gauss() * size * jitter));
  return out;
}

export function densify(verts, closed, per = 40) {
  const out = [];
  const n = verts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    for (let k = 0; k < per; k++) out.push(P(a.x + (b.x - a.x) * k / per, a.y + (b.y - a.y) * k / per));
  }
  if (!closed) out.push(verts[n - 1]);
  return out;
}
/* Moving-average smoothing that rounds corners the way a real hand does. */
export function roundCorners(dense, closed, window) {
  const n = dense.length, out = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, c = 0;
    for (let k = -window; k <= window; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
      x += dense[j].x; y += dense[j].y; c++;
    }
    out.push(P(x / c, y / c));
  }
  return out;
}
const rotate = (p, c, a) => P(c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a));

/* A closed outline traced once, starting somewhere along it, finishing with a
   little overshoot or a little gap. */
function traceClosed(dense, r, overshoot) {
  const n = dense.length, start = Math.floor(r() * n);
  const total = Math.max(8, Math.round(n * (1 + overshoot)));
  const out = [];
  for (let i = 0; i < total; i++) out.push(dense[(start + i) % n]);
  return out;
}

export const make = {
  line(r, size, angleDeg) {
    const a = angleDeg * Math.PI / 180, o = P(r.range(50, 300), r.range(50, 300));
    const dense = densify([o, P(o.x + Math.cos(a) * size, o.y + Math.sin(a) * size)], false, 80);
    return hand(dense, r, size, { jitter: 0.004, wobble: 0.01 });
  },
  circle(r, size, cw = true) {
    const R = size / 2, c = P(r.range(100, 300), r.range(100, 300)), n = 360, dense = [];
    const drift = r.range(-0.05, 0.05);
    for (let i = 0; i < n; i++) {
      const t = (cw ? 1 : -1) * i / n * 2 * Math.PI;
      const rr = R * (1 + drift * Math.sin(i / n * Math.PI * 2));
      dense.push(P(c.x + rr * Math.cos(t), c.y + rr * Math.sin(t)));
    }
    return hand(traceClosed(dense, r, r.range(-0.06, 0.12)), r, size);
  },
  ellipse(r, size, ratio, rotDeg) {
    const c = P(r.range(100, 300), r.range(100, 300)), rx = size / 2, ry = rx * ratio, rot = rotDeg * Math.PI / 180, dense = [];
    for (let i = 0; i < 360; i++) {
      const t = i / 360 * 2 * Math.PI;
      dense.push(rotate(P(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t)), c, rot));
    }
    return hand(traceClosed(dense, r, r.range(-0.05, 0.1)), r, size);
  },
  polygon(r, verts, size, round = 0.02) {
    const dense = roundCorners(densify(verts, true, 60), true, Math.round(verts.length * 60 * round));
    return hand(traceClosed(dense, r, r.range(-0.04, 0.1)), r, size);
  },
  rect(r, w, h, rotDeg, round = 0.02) {
    const c = P(r.range(150, 300), r.range(150, 300)), a = rotDeg * Math.PI / 180;
    const v = [P(c.x - w / 2, c.y - h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x - w / 2, c.y + h / 2)].map((p) => rotate(p, c, a));
    return make.polygon(r, v, Math.max(w, h), round);
  },
  regular(r, k, size, rotDeg) {
    const c = P(r.range(150, 300), r.range(150, 300)), R = size / 2, a0 = rotDeg * Math.PI / 180;
    const v = [];
    for (let i = 0; i < k; i++) v.push(P(c.x + R * Math.cos(a0 + i * 2 * Math.PI / k), c.y + R * Math.sin(a0 + i * 2 * Math.PI / k)));
    return make.polygon(r, v, size);
  },
  arc(r, size, sweepDeg) {
    const R = size / 2, c = P(r.range(100, 300), r.range(100, 300)), a0 = r.range(0, 6.28), dense = [];
    const n = 300, sw = sweepDeg * Math.PI / 180;
    for (let i = 0; i <= n; i++) dense.push(P(c.x + R * Math.cos(a0 + sw * i / n), c.y + R * Math.sin(a0 + sw * i / n)));
    return hand(dense, r, size, { wobble: 0.008 });
  },
  curve(r, size) {                       // a gentle S
    const o = P(r.range(60, 200), r.range(60, 200)), dense = [], n = 300;
    const p = [o, P(o.x + size * 0.35, o.y - size * 0.45), P(o.x + size * 0.65, o.y + size * 0.45), P(o.x + size, o.y)];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      dense.push(P(u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
                   u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y));
    }
    return hand(dense, r, size, { wobble: 0.006 });
  },
  polyline(r, verts, size) {
    return hand(roundCorners(densify(verts, false, 60), false, 4), r, size, { wobble: 0.006 });
  },
  zigzag(r, size) {
    const o = P(r.range(60, 200), r.range(60, 200)), v = [];
    for (let i = 0; i < 9; i++) v.push(P(o.x + i * size / 8, o.y + (i % 2 ? size * 0.25 : 0)));
    return hand(densify(v, false, 20), r, size);
  },
  scribble(r, size) {                     // a loop-the-loop of random walk
    const o = P(200, 200), out = [o];
    let a = 0, p = o;
    for (let i = 0; i < 120; i++) { a += r.gauss() * 1.2; p = P(p.x + Math.cos(a) * size * 0.04, p.y + Math.sin(a) * size * 0.04); out.push(p); }
    return out;
  },
  wave(r, size) {
    const dense = [];
    for (let i = 0; i <= 300; i++) dense.push(P(100 + size * i / 300, 200 + size * 0.12 * Math.sin(i / 300 * Math.PI * 5)));
    return hand(dense, r, size, { wobble: 0.004 });
  }
};
export const SIZES = [60, 140, 320];
