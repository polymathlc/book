import "../shape-snap.js";
import { blockFromStroke, CONTENT_W, CONTENT_H, drawingPathData, makeBlock } from "../core.js";
import { rng, make } from "./shape-snap-fixtures.mjs";

const ShapeSnap = globalThis.ShapeSnap;
const style = { stroke: "#1f2933", strokeWidth: 3 };

// Every fixture goes through the same conversion used when a Draw stroke ends.
export function drawingFixtures() {
  const path = (name, points, strokeWidth = 3, bounds) => ({
    name,
    block: makeBlock("shape", blockFromStroke(null, points, { ...style, strokeWidth }, ShapeSnap.toPoints, bounds)),
  });
  const snapped = (name, points) => ({
    name,
    block: makeBlock("shape", blockFromStroke(ShapeSnap.recognize(points, { unit: 1 }), points, style, ShapeSnap.toPoints)),
  });
  const nativeEdge = (name, descriptor) => ({
    name,
    block: makeBlock("shape", blockFromStroke(descriptor, [], style, ShapeSnap.toPoints)),
  });
  const restyled = (fixture, strokeWidth) => ({
    name: `${fixture.name} after stroke width edit`,
    block: { ...fixture.block, strokeWidth },
  });
  return [
    path("vertical", [{ x: 80, y: 50 }, { x: 80, y: 190 }]),
    path("horizontal", [{ x: 120, y: 220 }, { x: 260, y: 220 }]),
    path("shallow curve", [{ x: 100, y: 280 }, { x: 150, y: 282 }, { x: 200, y: 277 }, { x: 250, y: 280 }]),
    path("tiny curve", [{ x: 320, y: 350 }, { x: 326, y: 352 }, { x: 332, y: 348 }, { x: 338, y: 350 }]),
    snapped("small circle", make.circle(rng(1), 12)),
    snapped("small ellipse", make.ellipse(rng(2), 24, 0.45, 0)),
    snapped("small rectangle", make.rect(rng(3), 26, 10, 0)),
    snapped("small line", make.line(rng(4), 20, 0)),
    snapped("small tilted triangle", make.regular(rng(6), 3, 20, 17)),
    path("left edge", [{ x: 0, y: 50 }, { x: 0, y: 150 }]),
    path("top edge", [{ x: 100, y: 0 }, { x: 220, y: 0 }]),
    path("right edge", [{ x: CONTENT_W, y: 50 }, { x: CONTENT_W, y: 150 }]),
    path("bottom edge", [{ x: 100, y: CONTENT_H }, { x: 220, y: CONTENT_H }]),
    path("full page with wide stroke", [{ x: 0, y: 0 }, { x: CONTENT_W, y: CONTENT_H }], 24),
    path("full page with browser rounded bounds", [{ x: 0, y: 0 }, { x: Math.ceil(CONTENT_W), y: Math.ceil(CONTENT_H) }], 0.5,
      { w: Math.ceil(CONTENT_W), h: Math.ceil(CONTENT_H) }),
    nativeEdge("circle at page edge", { kind: "circle", c: { x: 4, y: 4 }, r: 4 }),
    nativeEdge("ellipse at page edge", { kind: "ellipse", c: { x: 7, y: 5 }, rx: 7, ry: 5, rot: 0 }),
    nativeEdge("rectangle at page edge", { kind: "rect", c: { x: 10, y: 5 }, w: 20, h: 10, rot: 0 }),
    nativeEdge("line at page edge", { kind: "line", a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }),
    restyled(path("full page with wide stroke", [{ x: 0, y: 0 }, { x: CONTENT_W, y: CONTENT_H }], 24), 1),
    restyled(nativeEdge("circle at page edge", { kind: "circle", c: { x: 4, y: 4 }, r: 4 }), 0.5),
    restyled(nativeEdge("ellipse at page edge", { kind: "ellipse", c: { x: 7, y: 5 }, rx: 7, ry: 5, rot: 0 }), 0.5),
    restyled(nativeEdge("rectangle at page edge", { kind: "rect", c: { x: 10, y: 5 }, w: 20, h: 10, rot: 0 }), 0.5),
  ];
}

// Compare the rendered coordinates, including Bezier control points, as well as
// the stored fractions. Equal point counts cannot detect a stretched drawing.
export function drawingGeometry(block) {
  const geometry = Object.fromEntries(
    ["kind", "x", "y", "w", "height", "rotation", "stroke", "strokeWidth", "fill", "floating", "radius"]
      .map((key) => [key, block[key]]),
  );
  geometry.rotation = block.rotation ?? 0;
  if (block.kind === "path") {
    const d = drawingPathData(block);
    geometry.closed = block.closed;
    geometry.smooth = block.smooth;
    geometry.points = block.points;
    geometry.absolutePoints = block.points.map(([x, y]) => [block.x + x * block.w, block.y + y * block.height]);
    geometry.pathData = d;
    geometry.absolutePath = d.match(/[MLCZ][^MLCZ]*/g).map((command) => ({
      command: command[0],
      coordinates: (command.slice(1).match(/-?\d+(?:\.\d+)?/g) || [])
        .map((value, index) => Number(value) + (index % 2 === 0 ? block.x : block.y)),
    }));
  } else if (block.kind === "circle" || block.kind === "ellipse") {
    geometry.outline = {
      cx: block.x + block.w / 2,
      cy: block.y + block.height / 2,
      rx: Math.max(0, (block.w - block.strokeWidth) / 2),
      ry: Math.max(0, (block.height - block.strokeWidth) / 2),
    };
  } else if (block.kind === "line") {
    geometry.outline = [
      [block.x + block.strokeWidth / 2, block.y + block.height / 2],
      [block.x + block.w - block.strokeWidth / 2, block.y + block.height / 2],
    ];
  } else {
    geometry.outline = {
      x: block.x + block.strokeWidth / 2,
      y: block.y + block.strokeWidth / 2,
      w: Math.max(0, block.w - block.strokeWidth),
      height: Math.max(0, block.height - block.strokeWidth),
    };
  }
  return geometry;
}
