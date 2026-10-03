const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const installFirebaseMock = require("./firebase-mock.cjs");

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
  await installFirebaseMock(page, base);
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
  // Compare the stored box, absolute path coordinates, and the actual SVG.
  // Keeping only normalised points would miss a box changing around those points.
  const geometry = (ids) => page.evaluate((ids) => ids.map((id) => {
    const b = window.BookStudio.getProject().pages.flatMap((p) => p.blocks).find((b) => b.id === id);
    const node = document.querySelector(`.worksheet [data-block="${id}"]`);
    const svg = node.querySelector("svg.shape-art");
    const r = node.getBoundingClientRect(), c = node.parentElement.getBoundingClientRect();
    const scale = c.width / node.parentElement.offsetWidth;
    return {
      x: b.x, y: b.y, w: b.w, height: b.height, kind: b.kind,
      stroke: b.stroke, strokeWidth: b.strokeWidth, fill: b.fill,
      closed: b.closed, smooth: b.smooth, points: b.points,
      absolutePoints: b.points?.map(([x, y]) => [b.x + x * b.w, b.y + y * b.height]),
      rendered: [r.x - c.x, r.y - c.y, r.width, r.height].map((n) => Math.round(n / scale * 1000) / 1000),
      viewBox: svg.getAttribute("viewBox"), graphic: svg.innerHTML,
    };
  }), ids);
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

    // ---- real narrow strokes and small held native shapes survive every reopen
    await page.click("#add-draw");
    await page.fill("#draw-colour", "#21536a");
    await page.selectOption("#draw-width", "3");
    const narrow = [];
    const stroke = async (pts, options) => {
      await draw(pts, options);
      const value = await last();
      narrow.push(value.id);
      return value;
    };
    b = await stroke([{ x: 35, y: 100 }, { x: 35, y: 140 }, { x: 35, y: 185 }]);
    assert.equal(b.kind, "path");
    assert.ok(b.w < 40, `vertical stroke is genuinely narrow: ${b.w}`);
    b = await stroke([{ x: 35, y: 290 }, { x: 100, y: 290 }, { x: 175, y: 290 }]);
    assert.equal(b.kind, "path");
    assert.ok(b.height < 20, `horizontal stroke is genuinely shallow: ${b.height}`);
    b = await stroke(Array.from({ length: 17 }, (_, i) => ({ x: 35 + i * 11, y: 325 + 6 * Math.sin(i * Math.PI / 16) })));
    assert.equal(b.kind, "path");
    assert.ok(b.height < 20);
    assert.match(await page.locator(`.worksheet [data-block="${b.id}"] path`).getAttribute("d"), /C/, "shallow curve keeps Bezier geometry");
    const oval = (cx, cy, rx, ry) => Array.from({ length: 25 }, (_, i) => ({
      x: cx + rx * Math.cos(i * Math.PI / 12), y: cy + ry * Math.sin(i * Math.PI / 12),
    }));
    b = await stroke(oval(90, 35, 7, 7), { hold: 800 });
    assert.equal(b.kind, "circle");
    assert.ok(b.w < 40 && b.height < 20);
    b = await stroke(oval(150, 35, 13, 5), { hold: 800 });
    assert.equal(b.kind, "ellipse");
    assert.ok(b.w < 40 && b.height < 20);
    b = await stroke([
      { x: 200, y: 30 }, { x: 213, y: 30 }, { x: 226, y: 30 },
      { x: 226, y: 35 }, { x: 226, y: 40 }, { x: 213, y: 40 },
      { x: 200, y: 40 }, { x: 200, y: 35 }, { x: 200, y: 30 },
    ], { hold: 800 });
    assert.equal(b.kind, "rectangle");
    assert.ok(b.w < 40 && b.height < 20);
    b = await stroke(Array.from({ length: 7 }, (_, i) => ({ x: 280 + i * 4, y: 35 })), { hold: 800 });
    assert.equal(b.kind, "line");
    assert.ok(b.w < 40);
    await page.keyboard.press("Escape");
    const drawn = await geometry(narrow);

    // Wait for the real IndexedDB transaction, then reload the actual page.
    await page.waitForFunction(() => document.getElementById("save-status").textContent === "Draft saved on this device");
    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open("polymath-book-studio", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, read = db.transaction("drafts").objectStore("drafts").get("current");
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    }));
    assert.deepEqual(stored.pages[0].blocks.filter((b) => narrow.includes(b.id)), (await blocks()).filter((b) => narrow.includes(b.id)), "drawings really reached the device draft");
    await page.reload();
    await page.waitForFunction(() => window.BookStudio && window.ShapeSnap);
    await page.selectOption("#zoom", "1");
    await content();
    assert.deepEqual(await geometry(narrow), drawn, "device draft reload preserves boxes, absolute paths and SVG geometry");

    const projectDownload = page.waitForEvent("download");
    await page.click("#export-project");
    const savedProject = path.join(output, "draw-round-trip.book.json");
    await (await projectDownload).saveAs(savedProject);
    assert.deepEqual(JSON.parse(fs.readFileSync(savedProject, "utf8")).pages[0].blocks.filter((b) => narrow.includes(b.id)), (await blocks()).filter((b) => narrow.includes(b.id)));
    await page.setInputFiles("#project-input", savedProject);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await content();
    assert.deepEqual(await geometry(narrow), drawn, "project export/import preserves the actual drawing geometry");

    // Exercise Firebase upload, listing and Open through the browser's existing
    // service double. The app and repository perform their real serialization.
    await page.click("#cloud-books");
    await page.waitForSelector("#cloud-login:not([hidden])");
    await page.click("#cloud-google");
    await page.waitForFunction(() => document.getElementById("cloud-status").textContent === "Cloud: saved");
    await page.locator("#cloud-list").getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.waitForFunction(() => !document.getElementById("cloud-dialog").open);
    await content();
    assert.deepEqual(await geometry(narrow), drawn, "cloud reopen preserves the actual drawing geometry");

    // Loaded drawings still use the normal editor. Nudge and style changes are
    // independently undoable; dragging a resize handle changes the path's box.
    for (const i of [0, 1, 3, 4, 5, 6]) {
      await page.locator(`[data-list-block="${narrow[i]}"]`).click();
      await page.keyboard.press("ArrowDown");
      const moved = (await geometry([narrow[i]]))[0];
      assert.equal(moved.y, drawn[i].y + 1, `${drawn[i].kind} remains movable after reopening`);
      for (const field of ["x", "w", "height", "graphic", "points"])
        assert.deepEqual(moved[field], drawn[i][field], `moving ${drawn[i].kind} retains ${field}`);
      await page.click("#undo");
      assert.deepEqual(await geometry([narrow[i]]), [drawn[i]], `undo restores ${drawn[i].kind} exactly`);
    }
    await page.locator(`[data-list-block="${narrow[2]}"]`).click();
    await page.keyboard.press("ArrowRight");
    const nudged = (await geometry([narrow[2]]))[0];
    assert.equal(nudged.x, drawn[2].x + 1);
    assert.equal(nudged.y, drawn[2].y);
    assert.deepEqual(nudged.points, drawn[2].points);
    assert.deepEqual(nudged.absolutePoints, drawn[2].absolutePoints.map(([x, y]) => [x + 1, y]));
    await page.click("#undo");
    assert.deepEqual(await geometry(narrow), drawn, "undo restores the narrow drawing exactly");
    await page.click("#redo");
    assert.deepEqual((await geometry([narrow[2]]))[0], nudged);
    await page.click("#undo");
    await page.locator(`[data-list-block="${narrow[2]}"]`).click();
    await page.locator('[data-field="stroke"]').fill("#aa3300");
    assert.equal((await geometry([narrow[2]]))[0].stroke, "#aa3300");
    await page.click("#undo");
    assert.deepEqual(await geometry(narrow), drawn);
    await page.locator(`[data-list-block="${narrow[2]}"]`).click();
    const handle = page.locator(`.worksheet [data-block="${narrow[2]}"] .selection-handle.se`);
    await handle.scrollIntoViewIfNeeded();
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 35, handleBox.y + handleBox.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    const resized = (await geometry([narrow[2]]))[0];
    assert.ok(resized.w > drawn[2].w && resized.height > drawn[2].height);
    assert.deepEqual(resized.points, drawn[2].points, "resizing retains the editable normalized path");
    assert.notEqual(resized.graphic, drawn[2].graphic, "resize changes rendered geometry");
    await page.click("#undo");
    assert.deepEqual(await geometry(narrow), drawn);

    // Copy via the app's copy handler, then paste in a fresh tab so the payload
    // goes through clipboardElements' validation instead of its in-tab shortcut.
    for (const [i, id] of narrow.entries())
      await page.locator(`[data-list-block="${id}"]`).click({ modifiers: i ? ["Shift"] : [] });
    const payload = await page.evaluate(() => {
      const data = new DataTransfer();
      document.body.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      return Object.fromEntries(Array.from(data.types, (type) => [type, data.getData(type)]));
    });
    assert.ok(payload["application/x-book-studio-elements"]);
    const copied = await browser.newPage({ viewport: { width: 1500, height: 1300 } });
    try {
      await copied.route("https://www.gstatic.com/**", (route) => route.abort());
      copied.on("pageerror", (e) => errors.push(e.message));
      await copied.goto(base);
      await copied.waitForFunction(() => window.BookStudio);
      await copied.evaluate((payload) => {
        const data = new DataTransfer();
        for (const [type, value] of Object.entries(payload)) data.setData(type, value);
        document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, payload);
      const pasted = await copied.evaluate(() => window.BookStudio.getProject().pages[0].blocks);
      const originals = (await blocks()).filter((b) => narrow.includes(b.id));
      const withoutId = ({ id, ...b }) => b;
      assert.deepEqual(pasted.map(withoutId), originals.map(withoutId), "validated cross-tab paste preserves drawing positions and geometry");
      await copied.click("#undo");
      assert.equal(await copied.evaluate(() => window.BookStudio.getProject().pages[0].blocks.length), 0);
      await copied.click("#redo");
      assert.deepEqual(await copied.evaluate(() => window.BookStudio.getProject().pages[0].blocks), pasted);
    } finally {
      await copied.close();
    }
    await page.click("#cloud-books");
    await page.click("#cloud-signout");
    await page.waitForFunction(() => !window.__fm.auth.currentUser);
    await page.click("#cloud-close");
    console.log("Draw browser round-trips passed: real narrow strokes and small snapped shapes, IndexedDB reload, project export/import, mocked cloud reopen, edit/move/resize, cross-tab copy/paste and undo/redo.");

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
