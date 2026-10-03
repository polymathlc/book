/* ShapeSnap — hold-to-snap shape recognition and Photoshop-style pen paths.
 *
 * One dependency-free module shared, byte for byte, by polymathlc/book,
 * polymathlc/cer and polymathlc/anskey. Ship a change to all three together.
 *
 * Draw a freehand stroke and hold still: recognize() decides which neat shape
 * it was meant to be — straight line, arc, smooth curve, circle, ellipse,
 * rectangle / square, triangle or a regular polygon — and toPoints() samples
 * that shape back into points a stroke renderer can draw. drag() keeps the
 * shape adjustable while the pen is still down (a line's end, a circle's
 * radius, a rectangle's corner …).
 *
 * The second half is the Photoshop pen: flattenAnchors() turns click / drag
 * anchors with Bezier handles into a polygon, which is what every selection
 * in these apps is made of.
 *
 * Everything is pure: no DOM, no timers (createHold is the one helper that
 * touches setTimeout and takes it as an option so tests can fake it).
 * Works as a classic script (window.ShapeSnap), as CommonJS, and when imported
 * for its side effect from an ES module (globalThis.ShapeSnap).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ShapeSnap = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var PI = Math.PI, TAU = PI * 2, DEG = PI / 180;

  /* ---- Tunables. Every one is a ratio of the stroke's own size unless it says
     "unit", which is the size of one device pixel in the caller's coordinates. */
  var T = {
    MIN_LEN_UNITS: 16,        // a stroke shorter than this many pixels is a dot, not a shape
    LINE_DEV: 0.04,           // max bow of a straight line, as a share of its length
    LINE_DEV_UNITS: 1.6,      // …but never less than this many pixels of wobble
    LINE_CHORD: 0.8,          // chord / length — a line does not double back
    AXIS_SNAP_DEG: 5,         // a line this close to horizontal / vertical snaps to it
    DIAG_SNAP_DEG: 3,         // …and to 45°
    CLOSED_CHORD: 0.22,       // endpoints this close (share of length) = a closed shape
    CIRCLE_ERR: 0.065,        // rms radial error (share of radius) that still reads as a circle
    ELLIPSE_ERR: 0.075,
    POLY_ERR: 0.05,           // rms distance to the polygon (share of perimeter / 2π)
    POLY_MIN_EXT_DEG: 28,     // a polygon corner must turn at least this much
    POLY_MAX_K: 6,
    ARC_ERR: 0.02,            // arc rms residual, share of arc length
    ARC_MAX: 0.05,
    ARC_MIN_SWEEP_DEG: 14,
    CORNER_EXT_DEG: 38,       // an open polyline needs decisive corners
    CORNER_SHARP: 0.7,        // …and most of that turn must happen at the corner itself
    CORNER_ERR: 0.018,
    CURVE_ERR: 0.025,
    CURVE_MAX: 0.06,
    RECT_RIGHT_DEG: 14,       // a quad's angles may be this far from 90° and still be a rectangle
    RECT_AXIS_DEG: 8,         // …and a rectangle this close to level snaps to level
    SQUARE_RATIO: 0.12,
    ELLIPSE_AXIS_DEG: 7,
    CIRCLE_RATIO: 0.9,        // an "ellipse" this round is a circle
    POLY_AXIS_DEG: 4,
    REGULAR_SIDE: 0.18,
    REGULAR_ANGLE_DEG: 12,
    HOLD_MS: 550,
    HOLD_JITTER_PX: 7
  };

  /* ================= small geometry ================= */
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function P(x, y) { return { x: x, y: y }; }
  function mid(a, b) { return P((a.x + b.x) / 2, (a.y + b.y) / 2); }
  function rot2(p, c, ang) {
    var s = Math.sin(ang), co = Math.cos(ang), dx = p.x - c.x, dy = p.y - c.y;
    return P(c.x + dx * co - dy * s, c.y + dx * s + dy * co);
  }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a <= -PI) a += TAU; return a; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function clean(points) {
    var out = [];
    for (var i = 0; points && i < points.length; i++) {
      var p = points[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      var l = out[out.length - 1];
      if (!l || Math.abs(p.x - l.x) > 1e-9 || Math.abs(p.y - l.y) > 1e-9) out.push(P(+p.x, +p.y));
    }
    return out;
  }
  function pathLen(pts, closed) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0]);
    return L;
  }
  function bboxOf(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
  }
  /* n points evenly spaced by ARC LENGTH. Open: first and last are kept.
     Closed: n points once round, the first not repeated. A pen that dawdles in
     one spot and rushes in another would otherwise bias every fit. */
  function resample(pts, n, closed) {
    var m = pts.length;
    if (m < 2) return pts.slice();
    var src = closed ? pts.concat([pts[0]]) : pts;
    var cum = [0];
    for (var i = 1; i < src.length; i++) cum.push(cum[i - 1] + dist(src[i - 1], src[i]));
    var L = cum[cum.length - 1];
    if (L <= 0) return pts.slice();
    var out = [], j = 1;
    for (var k = 0; k < n; k++) {
      var target = closed ? k * L / n : k * L / (n - 1);
      while (j < cum.length - 1 && cum[j] < target) j++;
      var seg = cum[j] - cum[j - 1];
      var t = seg > 0 ? (target - cum[j - 1]) / seg : 0;
      out.push(P(src[j - 1].x + (src[j].x - src[j - 1].x) * t, src[j - 1].y + (src[j].y - src[j - 1].y) * t));
    }
    return out;
  }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function lineDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    if (l < 1e-9) return dist(p, a);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l;
  }
  function distToPoly(p, verts, closed) {
    var best = Infinity, n = verts.length, last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var d = segDist(p, verts[i], verts[(i + 1) % n]);
      if (d < best) best = d;
    }
    return best;
  }
  function rmsToPoly(pts, verts, closed) {
    var s = 0;
    pts.forEach(function (p) { var d = distToPoly(p, verts, closed); s += d * d; });
    return Math.sqrt(s / Math.max(1, pts.length));
  }
  function maxToPoly(pts, verts, closed) {
    var m = 0;
    pts.forEach(function (p) { var d = distToPoly(p, verts, closed); if (d > m) m = d; });
    return m;
  }
  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; });
    return P(x / pts.length, y / pts.length);
  }
  /* Total least squares line: centroid + unit direction. */
  function fitLineTLS(pts) {
    var c = centroid(pts), sxx = 0, sxy = 0, syy = 0;
    pts.forEach(function (p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    });
    var ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { c: c, d: P(Math.cos(ang), Math.sin(ang)) };
  }
  function intersectLines(l1, l2) {
    var cr = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(cr) < 0.2) return null;            // within ~11° of parallel
    var dx = l2.c.x - l1.c.x, dy = l2.c.y - l1.c.y;
    var t = (dx * l2.d.y - dy * l2.d.x) / cr;
    return P(l1.c.x + l1.d.x * t, l1.c.y + l1.d.y * t);
  }
  function segsCross(a, b, c, d) {
    function o(p, q, r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); }
    var o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  function circMeanMod(angles, period) {
    var s = 0, c = 0, k = TAU / period;
    angles.forEach(function (a) { s += Math.sin(a * k); c += Math.cos(a * k); });
    return Math.atan2(s, c) / k;
  }
  /* Distance of an angle (radians) from the nearest multiple of `step`. */
  function offGrid(angle, step) {
    var r = angle % step; if (r < 0) r += step;
    return Math.min(r, step - r);
  }
  function nearestMultiple(angle, step) { return Math.round(angle / step) * step; }

  /* ================= fits ================= */

  /* Circle through points: algebraic (Kasa) fit on centred coordinates, then a
     few geometric (Landau) refinements so a partial arc is not biased. */
  function fitCircle(pts) {
    var n = pts.length;
    if (n < 3) return null;
    var c0 = centroid(pts);
    var sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sx = 0, sy = 0, sz = 0;
    pts.forEach(function (p) {
      var x = p.x - c0.x, y = p.y - c0.y, z = x * x + y * y;
      sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z; sx += x; sy += y; sz += z;
    });
    // Solve  [sxx sxy sx][A]   [-sxz]
    //        [sxy syy sy][B] = [-syz]   for  x²+y²+Ax+By+C = 0
    //        [sx  sy  n ][C]   [-sz ]
    var M = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
    for (var i = 0; i < 3; i++) {
      var piv = i;
      for (var r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (var r2 = i + 1; r2 < 3; r2++) {
        var f = M[r2][i] / M[i][i];
        for (var k = i; k < 4; k++) M[r2][k] -= f * M[i][k];
      }
    }
    var C = M[2][3] / M[2][2];
    var B = (M[1][3] - M[1][2] * C) / M[1][1];
    var A = (M[0][3] - M[0][1] * B - M[0][2] * C) / M[0][0];
    var cx = -A / 2, cy = -B / 2;
    var r2v = cx * cx + cy * cy - C;
    if (!(r2v > 0) || !isFinite(r2v)) return null;
    var c = P(cx + c0.x, cy + c0.y);
    for (var it = 0; it < 8; it++) {
      var R = 0, rs = [];
      pts.forEach(function (p) { var d = dist(p, c) || 1e-9; rs.push(d); R += d; });
      R /= n;
      var ax = 0, ay = 0, mx = 0, my = 0;
      pts.forEach(function (p, i2) { mx += p.x; my += p.y; ax += (c.x - p.x) / rs[i2]; ay += (c.y - p.y) / rs[i2]; });
      c = P(mx / n + R * ax / n, my / n + R * ay / n);
    }
    var Rm = 0, errs = [];
    pts.forEach(function (p) { var d = dist(p, c); errs.push(d); Rm += d; });
    Rm /= n;
    var e2 = 0, emax = 0;
    errs.forEach(function (d) { var e = d - Rm; e2 += e * e; if (Math.abs(e) > emax) emax = Math.abs(e); });
    if (!isFinite(Rm) || Rm <= 0) return null;
    return { c: c, r: Rm, rms: Math.sqrt(e2 / n), max: emax };
  }

  /* Axis-free ellipse from the second moments of an arc-length-uniform loop.
     By symmetry the loop's centroid is the centre and its principal axes are the
     ellipse's; the semi-axes then fall out of a 2×2 least squares. */
  function fitEllipse(pts) {
    var n = pts.length, c = centroid(pts), sxx = 0, sxy = 0, syy = 0;
    pts.forEach(function (p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    });
    var ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), co = Math.cos(ang), si = Math.sin(ang);
    var Suu = 0, Svv = 0, Suv = 0, Su = 0, Sv = 0, loc = [];
    pts.forEach(function (p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      var u = dx * co + dy * si, v = -dx * si + dy * co;
      loc.push([u, v]);
      Suu += u * u * u * u; Svv += v * v * v * v; Suv += u * u * v * v; Su += u * u; Sv += v * v;
    });
    var det = Suu * Svv - Suv * Suv;
    if (Math.abs(det) < 1e-12) return null;
    var A = (Su * Svv - Sv * Suv) / det, B = (Suu * Sv - Suv * Su) / det;
    if (!(A > 0) || !(B > 0)) return null;
    var a = 1 / Math.sqrt(A), b = 1 / Math.sqrt(B), e2 = 0;
    loc.forEach(function (q) {
      var rho = Math.sqrt(A * q[0] * q[0] + B * q[1] * q[1]);
      var d = rho > 0 ? (rho - 1) * Math.hypot(q[0], q[1]) / rho : 0;   // ≈ distance to the curve
      e2 += d * d;
    });
    if (a < b) { var t = a; a = b; b = t; ang += PI / 2; }
    return refineEllipse(pts, { c: c, rx: a, ry: b, rot: ang, rms: Math.sqrt(e2 / n) });
  }
  /* Levenberg–Marquardt on the geometric residual. The moment fit above assumes
     the loop is traced evenly once round; a hand-drawn ellipse is not, so this
     polishes it against the points themselves. */
  function ellipseResiduals(pts, p, out) {
    var a = Math.exp(p[2]), b = Math.exp(p[3]), co = Math.cos(p[4]), si = Math.sin(p[4]), s = 0;
    for (var i = 0; i < pts.length; i++) {
      var dx = pts[i].x - p[0], dy = pts[i].y - p[1];
      var u = dx * co + dy * si, v = -dx * si + dy * co;
      var rho = Math.sqrt(u * u / (a * a) + v * v / (b * b)), q = Math.hypot(u, v);
      var r = rho > 1e-9 ? q - q / rho : q;
      out[i] = r; s += r * r;
    }
    return s;
  }
  function refineEllipse(pts, e) {
    var n = pts.length, p = [e.c.x, e.c.y, Math.log(e.rx), Math.log(e.ry), e.rot];
    var r = new Array(n), r2 = new Array(n), J = [], lambda = 1e-3, k, i, j;
    var cost = ellipseResiduals(pts, p, r), step = [e.rx * 1e-3, e.rx * 1e-3, 1e-4, 1e-4, 1e-4];
    for (k = 0; k < 5; k++) J.push(new Array(n));
    for (var iter = 0; iter < 14; iter++) {
      for (k = 0; k < 5; k++) {
        var q = p.slice(); q[k] += step[k];
        ellipseResiduals(pts, q, r2);
        for (i = 0; i < n; i++) J[k][i] = (r2[i] - r[i]) / step[k];
      }
      var A = [], g = [];
      for (j = 0; j < 5; j++) {
        A.push(new Array(5)); var gj = 0;
        for (i = 0; i < n; i++) gj += J[j][i] * r[i];
        g.push(-gj);
        for (k = 0; k < 5; k++) { var s = 0; for (i = 0; i < n; i++) s += J[j][i] * J[k][i]; A[j][k] = s; }
      }
      var improved = false;
      for (var tries = 0; tries < 6 && !improved; tries++) {
        var M = A.map(function (row, rj) { var c = row.slice(); c[rj] += lambda * (row[rj] || 1); c.push(g[rj]); return c; });
        var d = solveLinear(M);
        if (!d) { lambda *= 8; continue; }
        var cand = p.map(function (v, ix) { return v + d[ix]; });
        var c2 = ellipseResiduals(pts, cand, r2);
        if (isFinite(c2) && c2 < cost) { p = cand; cost = c2; r = r2.slice(); lambda = Math.max(1e-7, lambda / 3); improved = true; }
        else lambda *= 8;
      }
      if (!improved) break;
    }
    var a = Math.exp(p[2]), b = Math.exp(p[3]), ang = p[4];
    if (!(a > 0) || !(b > 0) || !isFinite(cost)) return e;
    if (a < b) { var t = a; a = b; b = t; ang += PI / 2; }
    return { c: P(p[0], p[1]), rx: a, ry: b, rot: wrapAxis(ang), rms: Math.sqrt(cost / n) };
  }
  function solveLinear(M) {                  // Gaussian elimination, augmented n×(n+1)
    var n = M.length, i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
      if (Math.abs(M[piv][i]) < 1e-14) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (j = i + 1; j < n; j++) {
        var f = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }
  function wrapAxis(a) {            // an ellipse is its own half-turn
    a = wrapPi(a);
    if (a > PI / 2) a -= PI;
    if (a <= -PI / 2) a += PI;
    return a;
  }

  /* Least-squares cubic Bezier with fixed ends, reparameterised by Newton. */
  function fitCubic(pts) {
    var n = pts.length, p0 = pts[0], p3 = pts[n - 1];
    var ts = [0], L = 0, i;
    for (i = 1; i < n; i++) { L += dist(pts[i - 1], pts[i]); ts.push(L); }
    if (L <= 0) return null;
    for (i = 0; i < n; i++) ts[i] /= L;
    var p1 = null, p2 = null;
    function B(t) { var u = 1 - t; return [u * u * u, 3 * t * u * u, 3 * t * t * u, t * t * t]; }
    function solve() {
      var a11 = 0, a12 = 0, a22 = 0, bx1 = 0, bx2 = 0, by1 = 0, by2 = 0;
      for (var k = 0; k < n; k++) {
        var b = B(ts[k]);
        var rx = pts[k].x - b[0] * p0.x - b[3] * p3.x, ry = pts[k].y - b[0] * p0.y - b[3] * p3.y;
        a11 += b[1] * b[1]; a12 += b[1] * b[2]; a22 += b[2] * b[2];
        bx1 += b[1] * rx; bx2 += b[2] * rx; by1 += b[1] * ry; by2 += b[2] * ry;
      }
      var det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-12) return false;
      p1 = P((a22 * bx1 - a12 * bx2) / det, (a22 * by1 - a12 * by2) / det);
      p2 = P((a11 * bx2 - a12 * bx1) / det, (a11 * by2 - a12 * by1) / det);
      return true;
    }
    for (var round = 0; round < 4; round++) {
      if (!solve()) return null;
      for (i = 1; i < n - 1; i++) {                       // Newton step on each parameter
        var t = ts[i], b = B(t), u = 1 - t;
        var q = P(b[0] * p0.x + b[1] * p1.x + b[2] * p2.x + b[3] * p3.x, b[0] * p0.y + b[1] * p1.y + b[2] * p2.y + b[3] * p3.y);
        var d1 = P(3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
                   3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y));
        var d2 = P(6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
                   6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y));
        var num = (q.x - pts[i].x) * d1.x + (q.y - pts[i].y) * d1.y;
        var den = d1.x * d1.x + d1.y * d1.y + (q.x - pts[i].x) * d2.x + (q.y - pts[i].y) * d2.y;
        if (Math.abs(den) > 1e-12) ts[i] = Math.max(0, Math.min(1, t - num / den));
      }
    }
    if (!solve()) return null;
    var e2 = 0, emax = 0;
    for (i = 0; i < n; i++) {
      var bb = B(ts[i]);
      var qx = bb[0] * p0.x + bb[1] * p1.x + bb[2] * p2.x + bb[3] * p3.x;
      var qy = bb[0] * p0.y + bb[1] * p1.y + bb[2] * p2.y + bb[3] * p3.y;
      var e = Math.hypot(qx - pts[i].x, qy - pts[i].y);
      e2 += e * e; if (e > emax) emax = e;
    }
    return { p: [p0, p1, p2, p3], rms: Math.sqrt(e2 / n), max: emax };
  }

  /* ================= polygon / polyline search ================= */

  /* Greedy best-k vertex sets (Ramer-style splitting) over a resampled loop or
     path. Returns {k: [indices]} for every k from 3 (2 for open) up to kmax. */
  function splitVertices(rs, kmax, closed) {
    var n = rs.length, idx, out = {};
    if (closed) {
      var a = 0, b = 1, best = -1;
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
        var d = (rs[i].x - rs[j].x) * (rs[i].x - rs[j].x) + (rs[i].y - rs[j].y) * (rs[i].y - rs[j].y);
        if (d > best) { best = d; a = i; b = j; }
      }
      idx = [a, b];
    } else idx = [0, n - 1];
    while (idx.length < kmax) {
      var bs = -1, bp = -1, bd = -1, cnt = idx.length, segs = closed ? cnt : cnt - 1;
      for (var s = 0; s < segs; s++) {
        var i0 = idx[s], i1 = idx[(s + 1) % cnt], m = ((i1 - i0) % n + n) % n;
        for (var t = 1; t < m; t++) {
          var jx = (i0 + t) % n, dd = segDist(rs[jx], rs[i0], rs[i1]);
          if (dd > bd) { bd = dd; bs = s; bp = jx; }
        }
      }
      if (bp < 0 || bd <= 1e-9) break;
      idx.push(bp);
      idx.sort(function (x, y) { return x - y; });
      out[idx.length] = idx.slice();
    }
    return out;
  }

  /* Replace each polygon vertex with the intersection of the best-fit lines of
     its two sides — rounded hand-drawn corners come out crisp. */
  function refineVertices(rs, verts, closed) {
    var k = verts.length, sides = closed ? k : k - 1, groups = [], i;
    for (i = 0; i < sides; i++) groups.push([]);
    rs.forEach(function (p) {
      var best = Infinity, bi = 0;
      for (var e = 0; e < sides; e++) {
        var d = segDist(p, verts[e], verts[(e + 1) % k]);
        if (d < best) { best = d; bi = e; }
      }
      groups[bi].push(p);
    });
    var lines = [];
    for (i = 0; i < sides; i++) {
      var a = verts[i], b = verts[(i + 1) % k], len = dist(a, b), core = [];
      groups[i].forEach(function (p) {
        var t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len || 1);
        if (t > 0.18 && t < 0.82) core.push(p);          // keep clear of the rounded corners
      });
      var use = core.length >= 3 ? core : groups[i];
      if (use.length < 2) { lines.push(null); continue; }
      var l = fitLineTLS(use);
      var dir = P(b.x - a.x, b.y - a.y);
      if (l.d.x * dir.x + l.d.y * dir.y < 0) l.d = P(-l.d.x, -l.d.y);
      lines.push(l);
    }
    var out = [];
    var diag = bboxOf(verts).diag || 1;
    for (i = 0; i < k; i++) {
      var prev = closed ? lines[(i - 1 + sides) % sides] : (i > 0 ? lines[i - 1] : null);
      var next = closed ? lines[i % sides] : (i < sides ? lines[i] : null);
      var v = null;
      if (prev && next) v = intersectLines(prev, next);
      else if (next && !prev) v = projectOn(next, verts[i]);
      else if (prev && !next) v = projectOn(prev, verts[i]);
      if (!v || dist(v, verts[i]) > 0.35 * diag) v = verts[i];
      out.push(P(v.x, v.y));
    }
    return out;
  }
  function projectOn(line, p) {
    var t = (p.x - line.c.x) * line.d.x + (p.y - line.c.y) * line.d.y;
    return P(line.c.x + line.d.x * t, line.c.y + line.d.y * t);
  }
  function extAngles(verts, closed) {      // exterior turning angle at each vertex (0..π)
    var k = verts.length, out = [];
    for (var i = 0; i < k; i++) {
      if (!closed && (i === 0 || i === k - 1)) { out.push(null); continue; }
      var a = verts[(i - 1 + k) % k], b = verts[i], c = verts[(i + 1) % k];
      var v1 = P(b.x - a.x, b.y - a.y), v2 = P(c.x - b.x, c.y - b.y);
      var l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
      if (l1 < 1e-9 || l2 < 1e-9) { out.push(0); continue; }
      out.push(Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)))));
    }
    return out;
  }
  function turnSign(verts) {                // +1 / -1 when convex, 0 when it bends both ways
    var k = verts.length, pos = 0, neg = 0;
    for (var i = 0; i < k; i++) {
      var a = verts[i], b = verts[(i + 1) % k], c = verts[(i + 2) % k];
      var cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cr > 0) pos++; else if (cr < 0) neg++;
    }
    return pos && neg ? 0 : (pos ? 1 : -1);
  }
  function selfCrossing(verts, closed) {
    var k = verts.length, sides = closed ? k : k - 1;
    for (var i = 0; i < sides; i++) for (var j = i + 2; j < sides; j++) {
      if (closed && i === 0 && j === sides - 1) continue;
      if (segsCross(verts[i], verts[(i + 1) % k], verts[j], verts[(j + 1) % k])) return true;
    }
    return false;
  }

  /* ================= recognisers ================= */

  function tryLine(pts, rs, len, unit) {
    var p0 = pts[0], pn = pts[pts.length - 1], chord = dist(p0, pn);
    if (chord < T.MIN_LEN_UNITS * unit || chord < T.LINE_CHORD * len) return null;
    // Ignore the first / last few percent: a pen-lift hook is not a bend.
    var lo = Math.floor(rs.length * 0.04), hi = rs.length - lo, dev = 0;
    for (var i = lo; i < hi; i++) dev = Math.max(dev, lineDist(rs[i], p0, pn));
    if (dev > Math.max(T.LINE_DEV_UNITS * unit, T.LINE_DEV * chord)) return null;
    // Direction from a total-least-squares fit, endpoints projected onto it.
    var l = fitLineTLS(rs);
    var dir = P(pn.x - p0.x, pn.y - p0.y);
    if (l.d.x * dir.x + l.d.y * dir.y < 0) l.d = P(-l.d.x, -l.d.y);
    var a = projectOn(l, p0), b = projectOn(l, pn);
    return snapLineAngle({ kind: 'line', closed: false, a: a, b: b, err: dev / Math.max(chord, 1e-9) });
  }
  /* Level / plumb / 45° if the line is already nearly there; length is kept. */
  function snapLineAngle(d) {
    var dx = d.b.x - d.a.x, dy = d.b.y - d.a.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) return d;
    var ang = Math.atan2(dy, dx), snapped = ang;
    var q = nearestMultiple(ang, PI / 2);
    if (Math.abs(ang - q) <= T.AXIS_SNAP_DEG * DEG) snapped = q;
    else {
      var e = nearestMultiple(ang, PI / 4);
      if (Math.abs(ang - e) <= T.DIAG_SNAP_DEG * DEG) snapped = e;
    }
    if (snapped !== ang) {
      var m = mid(d.a, d.b);
      d.a = P(m.x - Math.cos(snapped) * L / 2, m.y - Math.sin(snapped) * L / 2);
      d.b = P(m.x + Math.cos(snapped) * L / 2, m.y + Math.sin(snapped) * L / 2);
    }
    return d;
  }

  function tryArc(pts, rs, len) {
    var f = fitCircle(rs);
    if (!f) return null;
    // Sweep: walk the resampled points round the fitted centre.
    var sweep = 0, prev = Math.atan2(rs[0].y - f.c.y, rs[0].x - f.c.x), a0 = prev;
    for (var i = 1; i < rs.length; i++) {
      var a = Math.atan2(rs[i].y - f.c.y, rs[i].x - f.c.x);
      sweep += wrapPi(a - prev); prev = a;
    }
    var abs = Math.abs(sweep);
    if (abs < T.ARC_MIN_SWEEP_DEG * DEG || abs > 340 * DEG) return null;
    if (f.rms > T.ARC_ERR * len || f.max > T.ARC_MAX * len) return null;
    return { kind: 'arc', closed: false, c: f.c, r: f.r, a0: a0, sweep: sweep, err: f.rms / len };
  }

  /* A real corner turns almost all of its angle right where the vertex is. A
     smooth bend (an S-curve) spreads the same turn over a long stretch, and is
     a curve however well a few straight segments happen to approximate it. */
  function cornerIsSharp(rs, at, ext) {
    var n = rs.length, w = Math.max(2, Math.round(n * 0.035));
    if (at - 3 * w < 0 || at + 3 * w > n - 1) return true;          // too close to an end to judge
    var b0 = rs[at - 3 * w], b1 = rs[at - w], a0 = rs[at + w], a1 = rs[at + 3 * w];
    var t1 = Math.atan2(b1.y - b0.y, b1.x - b0.x), t2 = Math.atan2(a1.y - a0.y, a1.x - a0.x);
    return Math.abs(wrapPi(t2 - t1)) >= T.CORNER_SHARP * ext;
  }
  function tryPolyline(pts, rs, len) {
    var cands = splitVertices(rs, 4, false), best = null;
    for (var k = 3; k <= 4; k++) {
      var idx = cands[k]; if (!idx) continue;
      var verts = refineVertices(rs, idx.map(function (i) { return rs[i]; }), false);
      var ext = extAngles(verts, false), ok = true;
      for (var i = 1; i < k - 1; i++) {
        if (ext[i] < T.CORNER_EXT_DEG * DEG || !cornerIsSharp(rs, idx[i], ext[i])) ok = false;
      }
      for (var s = 0; s < k - 1; s++) if (dist(verts[s], verts[s + 1]) < 0.12 * len) ok = false;
      if (!ok || selfCrossing(verts, false)) continue;
      var rms = rmsToPoly(rs, verts, false);
      if (rms <= T.CORNER_ERR * len) { best = { kind: 'polyline', closed: false, pts: verts, err: rms / len }; break; }
    }
    return best;
  }

  function tryCurve(pts, rs, len) {
    var f = fitCubic(resample(pts, 48, false));
    if (!f || f.rms > T.CURVE_ERR * len || f.max > T.CURVE_MAX * len) return null;
    return { kind: 'curve', closed: false, p: f.p, err: f.rms / len };
  }

  function recognizeOpen(pts, rs, len, unit) {
    return tryLine(pts, rs, len, unit) || tryArc(pts, rs, len) || tryPolyline(pts, rs, len) || tryCurve(pts, rs, len);
  }

  /* ----- closed shapes ----- */
  function windingAround(rs, c) {
    var w = 0, prev = Math.atan2(rs[0].y - c.y, rs[0].x - c.x);
    for (var i = 1; i < rs.length; i++) {
      var a = Math.atan2(rs[i].y - c.y, rs[i].x - c.x);
      w += wrapPi(a - prev); prev = a;
    }
    return Math.abs(w);
  }

  function makeRect(verts) {
    // rectangle-ness: four near-right angles, opposite sides alike.
    var k = verts.length; if (k !== 4) return null;
    var ang = [], i;
    for (i = 0; i < 4; i++) {
      var a = verts[i], b = verts[(i + 1) % 4];
      ang.push(Math.atan2(b.y - a.y, b.x - a.x));
    }
    var ext = extAngles(verts, true);
    for (i = 0; i < 4; i++) if (Math.abs(ext[i] - PI / 2) > T.RECT_RIGHT_DEG * DEG) return null;
    var l = [0, 1, 2, 3].map(function (j) { return dist(verts[j], verts[(j + 1) % 4]); });
    if (Math.min(l[0], l[2]) / Math.max(l[0], l[2]) < 0.7 || Math.min(l[1], l[3]) / Math.max(l[1], l[3]) < 0.7) return null;
    var theta = circMeanMod(ang, PI / 2);
    var c = centroid(verts);
    var u = P(Math.cos(theta), Math.sin(theta)), v = P(-Math.sin(theta), Math.cos(theta));
    var wu = 0, hv = 0;
    verts.forEach(function (p) { wu += Math.abs((p.x - c.x) * u.x + (p.y - c.y) * u.y); hv += Math.abs((p.x - c.x) * v.x + (p.y - c.y) * v.y); });
    var w = wu / 2, h = hv / 2;                         // mean |proj| ×4 / 2 sides = full extent
    // Normalise rotation to (−45°, 45°] so w runs along the nearer axis.
    theta = wrapPi(theta);
    while (theta > PI / 4) { theta -= PI / 2; var t = w; w = h; h = t; }
    while (theta <= -PI / 4) { theta += PI / 2; var t2 = w; w = h; h = t2; }
    if (Math.abs(theta) <= T.RECT_AXIS_DEG * DEG) theta = 0;
    var square = Math.abs(w - h) / Math.max(w, h) < T.SQUARE_RATIO;
    if (square) { w = h = (w + h) / 2; }
    return { kind: 'rect', closed: true, c: c, w: w, h: h, rot: theta, square: square };
  }
  function rectCorners(r) {
    var co = Math.cos(r.rot), si = Math.sin(r.rot), out = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var x = s[0] * r.w / 2, y = s[1] * r.h / 2;
      out.push(P(r.c.x + x * co - y * si, r.c.y + x * si + y * co));
    });
    return out;
  }

  function regularise(verts) {
    var k = verts.length, c = centroid(verts), l = [], i;
    for (i = 0; i < k; i++) l.push(dist(verts[i], verts[(i + 1) % k]));
    var minL = Math.min.apply(null, l), maxL = Math.max.apply(null, l);
    var ext = extAngles(verts, true), want = TAU / k, even = true;
    for (i = 0; i < k; i++) if (Math.abs(ext[i] - want) > T.REGULAR_ANGLE_DEG * DEG) even = false;
    if (k >= 3 && maxL / minL < 1 + T.REGULAR_SIDE && even) {
      var R = 0, offs = [];
      verts.forEach(function (p, j) {
        R += dist(p, c);
        offs.push(Math.atan2(p.y - c.y, p.x - c.x) - j * want * turnSign(verts));
      });
      R /= k;
      var th = circMeanMod(offs, want);
      var sgn = turnSign(verts) || 1, out = [];
      for (i = 0; i < k; i++) out.push(P(c.x + R * Math.cos(th + i * want * sgn), c.y + R * Math.sin(th + i * want * sgn)));
      return { verts: out, regular: true };
    }
    return { verts: verts, regular: false };
  }
  function tidyTriangle(verts) {
    // A right angle that is nearly right becomes exactly right.
    var ext = extAngles(verts, true), bestI = -1, bestD = 1e9;
    for (var i = 0; i < 3; i++) {
      var interior = PI - ext[i], d = Math.abs(interior - PI / 2);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD <= 9 * DEG) {
      var V = verts[bestI], A = verts[(bestI + 2) % 3], B = verts[(bestI + 1) % 3];
      var dA = P(A.x - V.x, A.y - V.y), lB = dist(B, V), lA = Math.hypot(dA.x, dA.y);
      var perp = P(-dA.y / lA, dA.x / lA);
      var cr = (B.x - V.x) * dA.y - (B.y - V.y) * dA.x;     // keep B on its own side of VA
      var sgn = cr > 0 ? -1 : 1;
      var nb = P(V.x + sgn * perp.x * lB, V.y + sgn * perp.y * lB);
      var out = verts.slice(); out[(bestI + 1) % 3] = nb;
      return out;
    }
    return verts;
  }
  /* Rotate a polygon a few degrees about its centre if an edge is almost level. */
  function levelPoly(verts) {
    var c = centroid(verts), k = verts.length, best = null;
    for (var i = 0; i < k; i++) {
      var a = verts[i], b = verts[(i + 1) % k];
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      var q = nearestMultiple(ang, PI / 2), d = q - ang;
      if (Math.abs(d) <= T.POLY_AXIS_DEG * DEG && (!best || dist(a, b) > best.len)) best = { d: d, len: dist(a, b) };
    }
    if (!best || best.d === 0) return verts;
    return verts.map(function (p) { return rot2(p, c, best.d); });
  }

  function recognizeClosed(pts, rs, len, unit) {
    var n = rs.length, s = len / TAU;            // "radius" scale of the loop
    var best = null;
    function offer(desc, err, pen, limit) {
      if (err > limit) return;
      var score = err * pen;
      if (!best || score < best.score) best = { desc: desc, score: score };
    }
    // --- circle / ellipse
    var f = fitCircle(rs);
    var cw = f ? windingAround(rs, f.c) : 0;
    if (f && cw >= 1.7 * PI) {
      offer({ kind: 'circle', closed: true, c: f.c, r: f.r, err: f.rms / f.r }, f.rms / s, 1.0, T.CIRCLE_ERR);
    }
    var e = fitEllipse(rs);
    if (e && windingAround(rs, e.c) >= 1.7 * PI) {
      var ratio = e.ry / e.rx;
      if (ratio >= T.CIRCLE_RATIO) {
        var r = (e.rx + e.ry) / 2;
        offer({ kind: 'circle', closed: true, c: e.c, r: r, err: e.rms / s }, e.rms / s, 1.05, T.ELLIPSE_ERR);
      } else {
        var rot = e.rot, rx = e.rx, ry = e.ry;
        if (offGrid(rot, PI / 2) <= T.ELLIPSE_AXIS_DEG * DEG) {
          var q = nearestMultiple(rot, PI / 2);
          if (Math.abs(Math.abs(q) - PI / 2) < 1e-9) { var t = rx; rx = ry; ry = t; }
          rot = 0;
        }
        offer({ kind: 'ellipse', closed: true, c: e.c, rx: rx, ry: ry, rot: rot, err: e.rms / s }, e.rms / s, 1.15, T.ELLIPSE_ERR);
      }
    }
    // --- polygon (triangle … hexagon, rectangles and squares among them)
    var kmax = T.POLY_MAX_K, sets = splitVertices(rs, kmax, true);
    for (var k = 3; k <= kmax; k++) {
      var idx = sets[k]; if (!idx) continue;
      var verts = refineVertices(rs, idx.map(function (i) { return rs[i]; }), true);
      var ext = extAngles(verts, true), ok = true;
      for (var i = 0; i < k; i++) if (ext[i] < T.POLY_MIN_EXT_DEG * DEG) ok = false;
      for (var j = 0; j < k; j++) if (dist(verts[j], verts[(j + 1) % k]) < 0.07 * len) ok = false;
      if (!ok || !turnSign(verts) || selfCrossing(verts, true)) continue;
      var err = rmsToPoly(rs, verts, true) / s;
      if (err > T.POLY_ERR) continue;
      var desc = null;
      if (k === 4) desc = makeRect(verts);
      if (!desc) {
        var work = verts;
        if (k === 3) work = tidyTriangle(work);
        var reg = (k === 3 || k >= 5) ? regularise(work) : { verts: work, regular: false };
        work = reg.verts;
        if (!reg.regular) work = levelPoly(work);
        desc = { kind: 'poly', closed: true, pts: work, regular: reg.regular };
      }
      desc.err = err;
      offer(desc, err, 1 + 0.06 * (k - 3), T.POLY_ERR);
      break;                                         // the fewest corners that fit wins
    }
    return best ? best.desc : null;
  }

  /* A hand rarely stops exactly where it started. If the pen went past its own
     start the overlapped stretch is on the page twice and would double one side
     of the shape, so cut it: drop the head if the END lies on the start of the
     path, or the tail if the START lies on the end of it. A stroke that stops
     short is left as it is. */
  function trimOverlap(pts) {
    var n = pts.length, L = pathLen(pts, false), cum = [0], i;
    for (i = 1; i < n; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    var p0 = pts[0], pn = pts[n - 1], gap = dist(p0, pn);
    var bestHead = { d: Infinity, i: 0 }, bestTail = { d: Infinity, i: n - 1 };
    for (i = 0; i < n - 1 && cum[i] <= 0.3 * L; i++) {
      var dh = segDist(pn, pts[i], pts[i + 1]);
      if (dh < bestHead.d) bestHead = { d: dh, i: i };
    }
    for (i = n - 1; i > 0 && cum[i] >= 0.7 * L; i--) {
      var dt = segDist(p0, pts[i - 1], pts[i]);
      if (dt < bestTail.d) bestTail = { d: dt, i: i };
    }
    var useHead = bestHead.d < gap * 0.5 && bestHead.i > 0, useTail = bestTail.d < gap * 0.5 && bestTail.i < n - 1;
    if (useHead && (!useTail || bestHead.d <= bestTail.d)) return pts.slice(bestHead.i + 1).concat([]).length >= 4 ? pts.slice(bestHead.i + 1) : pts;
    if (useTail) return pts.slice(0, bestTail.i).length >= 4 ? pts.slice(0, bestTail.i) : pts;
    return pts;
  }

  /* ================= public: recognise ================= */

  /* recognize(points, opts) → a descriptor, or null (leave the ink alone).
     opts.unit — one device pixel in the caller's units (default 1) so the small
     absolute floors scale with zoom. opts.last — pointer position at the moment
     of the snap, used to pick which handle a later drag() moves. */
  function recognize(points, opts) {
    opts = opts || {};
    var unit = opts.unit > 0 ? opts.unit : 1;
    var pts = clean(points);
    if (pts.length < 4) return null;
    var len = pathLen(pts, false);
    if (len < T.MIN_LEN_UNITS * unit) return null;
    // A jittery blob has a long path but covers no ground: that is a dot.
    if (bboxOf(pts).diag < T.MIN_LEN_UNITS * unit) return null;
    var chord = dist(pts[0], pts[pts.length - 1]);
    var closed = chord < T.CLOSED_CHORD * len;
    var desc = null;
    if (closed) {
      var loop = trimOverlap(pts);
      // The loop is sampled along the STROKE only (no invented closing chord) and
      // searched as a cycle, so a small gap at the seam costs nothing.
      desc = recognizeClosed(loop, resample(loop, 128, false), pathLen(loop, false), unit);
    }
    // A "closed" scribble that is not a clean loop may still be an open curve.
    if (!desc && !closed) desc = recognizeOpen(pts, resample(pts, 96, false), len, unit);
    if (!desc) return null;
    desc.handle = pickHandle(desc, opts.last || pts[pts.length - 1]);
    if (desc.kind === 'ellipse' || desc.kind === 'circle') desc.d0 = Math.max(dist(desc.c, opts.last || pts[pts.length - 1]), 2 * unit);
    desc.unit = unit;
    return desc;
  }

  function pickHandle(d, at) {
    var pts = d.kind === 'poly' || d.kind === 'polyline' ? d.pts : d.kind === 'rect' ? rectCorners(d) : null;
    if (!pts) return 0;
    var bi = 0, bd = Infinity;
    pts.forEach(function (p, i) { var dd = dist(p, at); if (dd < bd) { bd = dd; bi = i; } });
    return bi;
  }

  /* ================= public: sample and adjust ================= */

  function sampleCubic(p, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push(P(u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
                 u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y));
    }
    return out;
  }
  function round(p) { return P(round2(p.x), round2(p.y)); }

  /* Points a stroke renderer can draw. Closed shapes repeat their first point. */
  function toPoints(d) {
    var out = [], i;
    switch (d.kind) {
      case 'line': out = [d.a, d.b]; break;
      case 'polyline': out = d.pts.slice(); break;
      case 'arc': {
        var n = Math.max(8, Math.ceil(Math.abs(d.sweep) / (3 * DEG)));
        for (i = 0; i <= n; i++) {
          var a = d.a0 + d.sweep * i / n;
          out.push(P(d.c.x + d.r * Math.cos(a), d.c.y + d.r * Math.sin(a)));
        }
        break;
      }
      case 'curve': out = sampleCubic(d.p, 48); break;
      case 'circle': case 'ellipse': {
        var rx = d.kind === 'circle' ? d.r : d.rx, ry = d.kind === 'circle' ? d.r : d.ry, rot = d.rot || 0;
        var co = Math.cos(rot), si = Math.sin(rot);
        for (i = 0; i <= 90; i++) {
          var t = i / 90 * TAU, x = rx * Math.cos(t), y = ry * Math.sin(t);
          out.push(P(d.c.x + x * co - y * si, d.c.y + x * si + y * co));
        }
        break;
      }
      case 'rect': out = rectCorners(d); out.push(out[0]); break;
      case 'poly': out = d.pts.concat([d.pts[0]]); break;
      default: return [];
    }
    return out.map(round);
  }

  /* drag(desc, pt) → a NEW descriptor with the pen now at pt. */
  function drag(d, pt) {
    var u = d.unit || 1, n = Object.assign({}, d), i;
    switch (d.kind) {
      case 'line': {
        n.a = d.a; n.b = P(pt.x, pt.y);
        var snapped = snapLineAngle({ kind: 'line', a: n.a, b: n.b });
        // Keep the START fixed while adjusting; only the end follows the pen.
        var L = dist(n.a, n.b), ang = Math.atan2(snapped.b.y - snapped.a.y, snapped.b.x - snapped.a.x);
        var raw = Math.atan2(n.b.y - n.a.y, n.b.x - n.a.x);
        if (Math.abs(wrapPi(ang - raw)) > 1e-9) n.b = P(n.a.x + Math.cos(ang) * L, n.a.y + Math.sin(ang) * L);
        break;
      }
      case 'polyline': case 'poly':
        n.pts = d.pts.slice(); n.pts[d.handle || 0] = P(pt.x, pt.y); n.regular = false; break;
      case 'arc': {
        var ea = Math.atan2(pt.y - d.c.y, pt.x - d.c.x), cur = d.a0 + d.sweep;
        var ns = d.sweep + wrapPi(ea - cur);
        var lim = 2 * PI - 0.05;
        n.sweep = Math.max(-lim, Math.min(lim, ns));
        break;
      }
      case 'curve': {
        var dx = pt.x - d.p[3].x, dy = pt.y - d.p[3].y;
        n.p = [d.p[0], d.p[1], P(d.p[2].x + dx, d.p[2].y + dy), P(pt.x, pt.y)];
        break;
      }
      case 'circle': n.r = Math.max(3 * u, dist(d.c, pt)); break;
      case 'ellipse': {
        var sc = Math.max(0.15, dist(d.c, pt) / (d.d0 || 1));
        n.rx = d.rx * sc; n.ry = d.ry * sc; break;
      }
      case 'rect': {
        var corners = rectCorners(d), h = d.handle || 0, opp = corners[(h + 2) % 4];
        var co = Math.cos(d.rot), si = Math.sin(d.rot);
        var lx = (pt.x - opp.x) * co + (pt.y - opp.y) * si, ly = -(pt.x - opp.x) * si + (pt.y - opp.y) * co;
        var w = Math.max(3 * u, Math.abs(lx)), hh = Math.max(3 * u, Math.abs(ly));
        if (d.square) { w = hh = Math.max(w, hh); }
        var sx = (lx < 0 ? -1 : 1), sy = (ly < 0 ? -1 : 1);
        var ctr = P(opp.x + (sx * w / 2) * co - (sy * hh / 2) * si, opp.y + (sx * w / 2) * si + (sy * hh / 2) * co);
        n.c = ctr; n.w = w; n.h = hh;
        n.handle = h;
        break;
      }
      default: break;
    }
    return n;
  }

  var LABELS = {
    line: 'Straight line', polyline: 'Corner', arc: 'Arc', curve: 'Smooth curve', circle: 'Circle', ellipse: 'Ellipse',
    rect: 'Rectangle', poly: 'Polygon'
  };
  function label(d) {
    if (!d) return '';
    if (d.kind === 'rect' && d.square) return 'Square';
    if (d.kind === 'poly') {
      var n = d.pts.length;
      return n === 3 ? 'Triangle' : n === 5 ? (d.regular ? 'Pentagon' : 'Polygon') : n === 6 ? (d.regular ? 'Hexagon' : 'Polygon') : 'Polygon';
    }
    return LABELS[d.kind] || 'Shape';
  }

  /* One call for stroke-based apps: recognise, then sample. */
  function snapStroke(points, opts) {
    var d = recognize(points, opts);
    return d ? { desc: d, points: toPoints(d), closed: !!d.closed } : null;
  }

  /* ================= hold detection ================= */

  /* createHold({ms, jitter, onHold, setTimeout, clearTimeout}) — call start() on
     pointer down and move() on every pointer move (screen pixels). onHold fires
     once the pen has stayed within `jitter` px for `ms`. A real move re-arms it. */
  function createHold(o) {
    o = o || {};
    var ms = o.ms || T.HOLD_MS, jitter = o.jitter || T.HOLD_JITTER_PX;
    var st = o.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
    var ct = o.clearTimeout || (typeof clearTimeout === 'function' ? clearTimeout : null);
    var timer = null, ax = 0, ay = 0, on = false, fired = false;
    function arm() {
      if (timer && ct) ct(timer);
      timer = st ? st(function () { timer = null; if (on && !fired) { fired = true; if (o.onHold) o.onHold(); } }, ms) : null;
    }
    return {
      start: function (x, y) { on = true; fired = false; ax = x; ay = y; arm(); },
      move: function (x, y) {
        if (!on || fired) return;
        if (Math.hypot(x - ax, y - ay) > jitter) { ax = x; ay = y; arm(); }
      },
      cancel: function () { on = false; if (timer && ct) ct(timer); timer = null; },
      held: function () { return fired; }
    };
  }

  /* ================= pen path (Photoshop-style) ================= */

  /* Anchors: {x, y, hin?: {x,y}, hout?: {x,y}} — handles are ABSOLUTE points.
     A corner anchor has none; a smooth anchor has them mirrored through it. */
  function flatCubic(p0, p1, p2, p3, tol, out, depth) {
    // Flat enough when both control points sit within tol of the chord.
    var d1 = segDist(p1, p0, p3), d2 = segDist(p2, p0, p3);
    if ((d1 <= tol && d2 <= tol) || depth > 12) { out.push(P(p3.x, p3.y)); return; }
    var p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3);
    var a = mid(p01, p12), b = mid(p12, p23), m = mid(a, b);
    flatCubic(p0, p01, a, m, tol, out, depth + 1);
    flatCubic(m, b, p23, p3, tol, out, depth + 1);
  }
  function flattenAnchors(anchors, closed, tol) {
    tol = tol > 0 ? tol : 0.35;
    var n = anchors.length, out = [];
    if (!n) return out;
    out.push(P(anchors[0].x, anchors[0].y));
    var last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var a = anchors[i], b = anchors[(i + 1) % n];
      var p1 = a.hout || a, p2 = b.hin || b;
      if (a.hout || b.hin) flatCubic(P(a.x, a.y), p1, p2, P(b.x, b.y), tol, out, 0);
      else out.push(P(b.x, b.y));
    }
    if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-9) out.pop();
    return out;
  }
  /* Photoshop: dragging out of a fresh anchor pulls a symmetric pair of handles;
     the pen end becomes hout and the mirror image becomes hin. */
  function setSmoothHandles(anchor, pen) {
    anchor.hout = P(pen.x, pen.y);
    anchor.hin = P(2 * anchor.x - pen.x, 2 * anchor.y - pen.y);
    return anchor;
  }
  function pointInPolygon(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-12) + a.x)) inside = !inside;
    }
    return inside;
  }
  function polygonArea(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }
  /* Nearest anchor / handle under the pen: {i, part:'anchor'|'hin'|'hout'} or null. */
  function hitAnchors(anchors, pt, radius) {
    var best = null, bd = radius;
    anchors.forEach(function (a, i) {
      ['hout', 'hin'].forEach(function (k) {
        if (a[k]) { var d = dist(a[k], pt); if (d <= bd) { bd = d; best = { i: i, part: k }; } }
      });
    });
    anchors.forEach(function (a, i) {
      var d = dist(a, pt); if (d <= bd) { bd = d; best = { i: i, part: 'anchor' }; }
    });
    return best;
  }

  return {
    T: T,
    recognize: recognize, toPoints: toPoints, drag: drag, label: label, snapStroke: snapStroke,
    createHold: createHold,
    flattenAnchors: flattenAnchors, setSmoothHandles: setSmoothHandles, hitAnchors: hitAnchors,
    pointInPolygon: pointInPolygon, polygonArea: polygonArea,
    snapLineAngle: snapLineAngle, rectCorners: rectCorners,
    _internal: { fitCircle: fitCircle, fitEllipse: fitEllipse, fitCubic: fitCubic, resample: resample, clean: clean, pathLen: pathLen, dist: dist,
      splitVertices: splitVertices, refineVertices: refineVertices, extAngles: extAngles, rmsToPoly: rmsToPoly, turnSign: turnSign, selfCrossing: selfCrossing }
  };
});
