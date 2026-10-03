const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The page-level Draw tool in a REAL browser: real mouse events, a real hold,
// the real stored blocks. The unit tests prove what a stroke becomes; only this
// proves that holding the pen still on an actual page leaves a clean shape there,
// that ink never lands on the page when the tool is off, and that it is one undo
// step. Every failure here is quiet: the page goes on looking like a page.
module.exports = async function drawTool(browser, base, output) {
  const { rng, make } = await import("./shape-snap-fixtures.mjs");
  const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const project = () => page.evaluate(() => window.BookStudio.getProject());
  const blocks = async (index = 0) => (await project()).pages[index].blocks;
  const place = (pts, dx, dy) => {
    const x0 = Math.min(...pts.map((p) => p.x)),
      y0 = Math.min(...pts.map((p) => p.y));
    return pts.map((p) => ({ x: p.x - x0 + dx, y: p.y - y0 + dy }));
  };
  // Screen rectangle of the page's content area, settled (layout drifts after load).
  async function content(sheet = 0) {
    const sel = `.worksheet[data-sheet="${sheet}"] .worksheet-content`;
    await page.locator(sel).scrollIntoViewIfNeeded();
    let prev = "", still = 0;
    for (let i = 0; i < 40 && still < 3; i++) {
      const r = await page.locator(sel).evaluate((n) => {
        const b = n.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10)).join(",");
      });
      still = r === prev ? still + 1 : 0;
      prev = r;
      await page.waitForTimeout(120);
    }
    return page.locator(sel).evaluate((n) => {
      const b = n.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, k: b.width / n.offsetWidth };
    });
  }
  // Draw `pts` (content pixels at the page's current scale) with the real mouse.
  async function draw(pts, { hold = 0, then = [], sheet = 0 } = {}) {
    const c = await content(sheet),
      at = (p) => [c.x + p.x * c.k, c.y + p.y * c.k];
    await page.mouse.move(...at(pts[0]));
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...at(p));
    if (hold) await page.waitForTimeout(hold);
    for (const p of then) await page.mouse.move(...at(p), { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  const last = async (sheet = 0) => {
    const list = await blocks(sheet);
    return list[list.length - 1];
  };
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio && window.ShapeSnap);
    await page.selectOption("#zoom", "1");
    assert.equal((await blocks()).length, 0, "starts with an empty page");

    // ---- turning it on
    assert.equal(await page.isVisible("#draw-bar"), false);
    await page.click("#add-draw");
    assert.equal(await page.evaluate(() => document.body.classList.contains("drawing-mode")), true);
    assert.equal(await page.isVisible("#draw-bar"), true);
    assert.equal(await page.getAttribute("#add-draw", "aria-pressed"), "true");

    // ---- a held circle becomes the editor's own circle block
    await draw(place(make.circle(rng(1), 170), 120, 120), { hold: 800 });
    let b = await last();
    assert.equal(b.type, "shape");
    assert.equal(b.kind, "circle", "a held circle is a real circle block, with handles and inspector");
    assert.ok(Math.abs(b.w - b.height) < 1, "round");
    assert.equal(b.fill, "none");
    assert.equal(
      await page.evaluate(() => document.querySelectorAll(".sheet-block.selected").length),
      0,
      "nothing left selected",
    );
    assert.equal((await blocks()).length, 1);

    // ---- one undo step takes the whole snapped stroke back
    await page.click("#undo");
    assert.equal((await blocks()).length, 0, "one undo removes the snapped stroke");
    await page.click("#redo");
    assert.equal((await blocks()).length, 1);

    // ---- rectangle, ellipse, level line
    await draw(place(make.rect(rng(2), 260, 150, 0), 360, 120), { hold: 800 });
    assert.equal((await last()).kind, "rectangle");
    await draw(place(make.ellipse(rng(3), 250, 0.45, 0), 120, 380), { hold: 800 });
    assert.equal((await last()).kind, "ellipse");
    await draw(place(make.line(rng(4), 300, 0), 120, 520), { hold: 800 });
    b = await last();
    assert.equal(b.kind, "line");
    assert.ok(b.w > 270);

    // ---- triangles keep their corners; tilted lines keep their slope
    await draw(place(make.regular(rng(5), 3, 200, 10), 480, 380), { hold: 800 });
    b = await last();
    assert.equal(b.kind, "path");
    assert.equal(b.closed, true);
    assert.equal(b.points.length, 4, "three corners and the point that closes it");
    const dTri = await page.locator(`[data-block="${b.id}"] path`).getAttribute("d");
    assert.ok(!/C/.test(dTri) && /Z$/.test(dTri), "drawn with straight sides: " + dTri);
    await draw(place(make.line(rng(6), 260, 110), 120, 600), { hold: 800 });
    b = await last();
    assert.equal(b.kind, "path");
    assert.equal(b.points.length, 2);

    // ---- no hold: plain smoothed freehand, nothing snapped
    const before = (await blocks()).length;
    await draw(place(make.wave(rng(7), 320, 40), 120, 720));
    b = await last();
    assert.equal((await blocks()).length, before + 1);
    assert.equal(b.kind, "path");
    assert.equal(b.smooth, true);
    assert.match(await page.locator(`[data-block="${b.id}"] path`).getAttribute("d"), /C/);

    // ---- a scribble that is not a shape stays ink even when held
    await draw(place(make.zigzag(rng(8), 240), 400, 620), { hold: 800 });
    assert.equal((await last()).smooth, true, "a held zig-zag is still freehand");

    // ---- after the snap, dragging on adjusts the shape and lifting keeps it
    const count = (await blocks()).length;
    const circle = place(make.circle(rng(9), 110), 440, 80);
    const lastPt = circle[circle.length - 1];
    await draw(circle, { hold: 800, then: [{ x: lastPt.x, y: lastPt.y + 70 }, { x: lastPt.x, y: lastPt.y + 150 }] });
    assert.equal((await blocks()).length, count + 1, "one block, not two");
    b = await last();
    assert.equal(b.kind, "circle");
    assert.ok(b.w > 150, `the radius followed the pen: ${b.w}`);

    // ---- a tap is not a drawing
    const taps = (await blocks()).length;
    const c = await content();
    await page.mouse.click(c.x + 600 * c.k, c.y + 900 * c.k);
    assert.equal((await blocks()).length, taps);

    // ---- colour and thickness apply to the next stroke
    await page.fill("#draw-colour", "#c0392b");
    await page.selectOption("#draw-width", "8");
    await draw(place(make.circle(rng(10), 90), 470, 780), { hold: 800 });
    b = await last();
    assert.equal(b.stroke, "#c0392b");
    assert.equal(b.strokeWidth, 8);

    // ---- Esc ends drawing, and with the tool off the page behaves as before
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.body.classList.contains("drawing-mode")), false);
    assert.equal(await page.isVisible("#draw-bar"), false);
    const off = (await blocks()).length;
    await draw(place(make.wave(rng(11), 200, 30), 100, 850));
    assert.equal((await blocks()).length, off, "no ink when the tool is off");

    // ---- exports read the same shape: the stored path is in the SVG the page renders
    const svg = await page.locator(".worksheet-content svg.shape-art").count();
    assert.ok(svg >= 8, `shapes render as SVG (${svg})`);

    // ---- the SVG export carries the drawn paths and the preview overlay never leaks into it
    const dl = page.waitForEvent("download");
    await page.click("#export-svg");
    const file = await dl;
    const svgPath = path.join(output, "draw-tool.svg");
    await file.saveAs(svgPath);
    const exported = fs.readFileSync(svgPath, "utf8");
    assert.match(exported, /<path d="M[^"]*Z"/, "the closed triangle is in the export");
    assert.ok(!/draw-preview/.test(exported), "the live preview never reaches an export");

    // ---- a continuation sheet: ink lands on the sheet it was drawn on
    await page.click("#add-draw");
    const long = await project();
    long.id = "b_draw_sheets";
    long.pages = [
      {
        id: "pd",
        blocks: [
          {
            id: "tl",
            type: "text",
            text: Array.from({ length: 140 }, (_, i) => `Line ${i}`).join("\n"),
          },
        ],
      },
    ];
    const input = path.join(output, "draw-tool.book.json");
    fs.writeFileSync(input, JSON.stringify(long));
    await page.keyboard.press("Escape");
    await page.setInputFiles("#project-input", input);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.querySelectorAll(".worksheet").length >= 2);
    await page.click("#add-draw");
    await draw(place(make.circle(rng(12), 140), 300, 200), { hold: 800, sheet: 1 });
    b = await last();
    assert.equal(b.kind, "circle");
    assert.equal(b.sheetIndex, 1, "drawn on the second sheet, so it belongs to the second sheet");
    await page.screenshot({ path: path.join(output, "draw-tool.png") });
    await page.keyboard.press("Escape");

    // ---- graceful degradation: without shape-snap.js it is plain smoothed ink
    const bare = await browser.newPage({ viewport: { width: 1500, height: 1300 } });
    await bare.route(/shape-snap\.js/, (r) => r.abort());
    await bare.route("https://www.gstatic.com/**", (r) => r.abort());
    bare.on("pageerror", (e) => errors.push(e.message));
    await bare.goto(base);
    await bare.waitForFunction(() => window.BookStudio);
    assert.equal(await bare.evaluate(() => !!window.ShapeSnap), false);
    await bare.selectOption("#zoom", "1");
    await bare.click("#add-draw");
    const bc = await bare.locator(".worksheet-content").first().evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, k: r.width / n.offsetWidth };
    });
    const ring = place(make.circle(rng(13), 160), 200, 150);
    await bare.mouse.move(bc.x + ring[0].x * bc.k, bc.y + ring[0].y * bc.k);
    await bare.mouse.down();
    for (const p of ring.slice(1)) await bare.mouse.move(bc.x + p.x * bc.k, bc.y + p.y * bc.k);
    await bare.waitForTimeout(800);
    await bare.mouse.up();
    const bb = (await bare.evaluate(() => window.BookStudio.getProject())).pages[0].blocks;
    assert.equal(bb.length, 1);
    assert.equal(bb[0].kind, "path", "held but not snapped: still freehand");
    assert.equal(bb[0].smooth, true);
    await bare.close();

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
};
