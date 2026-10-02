/* Optional browser acceptance: npm install --no-save playwright@1.62.1; node tests/browser.test.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const root = path.resolve(__dirname, ".."),
    errors = [],
    output = process.env.BOOK_TEST_OUTPUT || path.join(root, "test-results");
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name =
        req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0],
      file = path.join(root, name);
    try {
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
          }[path.extname(file)] || "application/octet-stream",
      });
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    const args = process.env.BOOK_BROWSER_ARGS
      ? JSON.parse(process.env.BOOK_BROWSER_ARGS)
      : ["--no-sandbox"];
    browser = await chromium.launch({
      headless: true,
      args,
      executablePath: process.env.BOOK_BROWSER_EXECUTABLE || undefined,
    });
    const page = await browser.newPage({
      viewport: { width: 1550, height: 1250 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.route("https://www.gstatic.com/**", (route) => route.abort());
    if (process.env.BOOK_PASTE_ONLY) {
      await require("./text-paste.cjs")(browser, base);
      return;
    }
    if (process.env.BOOK_FRACTIONS_ONLY) {
      await require("./fractions.cjs")(browser, base, output);
      return;
    }
    if (process.env.BOOK_THUMBNAILS_ONLY) {
      await require("./page-thumbnails.cjs")(browser, base, output);
      return;
    }
    if (process.env.BOOK_CLIPBOARD_ONLY) {
      await require("./page-clipboard.cjs")(browser, base, output);
      return;
    }
    if (process.env.BOOK_TEMPLATES_ONLY) {
      await require("./page-templates.cjs")(browser, base, output);
      return;
    }
    if (process.env.BOOK_TEXTBOXES_ONLY) {
      await require("./powerpoint-textboxes.cjs")(browser, base, output);
      return;
    }
    if (process.env.BOOK_FEATURES_ONLY) {
      await require("./editor-features.cjs")(browser, base, output);
      return;
    }
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const state = () => page.evaluate(() => window.BookStudio.getProject());
    await page.click("#load-example");
    assert.equal(await page.locator(".worksheet .habit-block").count(), 2);
    assert.equal(await page.locator(".worksheet-masthead img").count(), 0);
    const footer = await page.locator(".worksheet-footer").evaluate((n) => ({
      image: n.querySelector("img").getBoundingClientRect().right,
      name: n.querySelector(".footer-name").getBoundingClientRect().left,
    }));
    assert.ok(footer.image < footer.name);
    assert.equal(await page.locator(".worksheet").count(), 1);
    await page
      .locator(".worksheet img")
      .first()
      .evaluate((img) => img.decode());
    await page
      .locator(".worksheet")
      .screenshot({ path: path.join(output, "worksheet.png") });
    await page.screenshot({ path: path.join(output, "editor.png") });
    let dl = page.waitForEvent("download");
    await page.click("#export-pdf");
    let file = await dl;
    await file.saveAs(path.join(output, "worksheet.pdf"));
    assert.ok(fs.statSync(path.join(output, "worksheet.pdf")).size > 50000);
    dl = page.waitForEvent("download");
    await page.click("#export-svg");
    file = await dl;
    await file.saveAs(path.join(output, "worksheet.svg"));
    assert.match(
      fs.readFileSync(path.join(output, "worksheet.svg"), "utf8"),
      /clip-path="url\(#contentClip\)"/,
    );
    await page.click("#add-page");
    const imageSrc = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2400;
      c.height = 1800;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 2400, 1800);
      ctx.fillStyle = "#203c44";
      ctx.font = "80px Arial";
      ctx.fillText("Full resolution: 2400 × 1800", 100, 180);
      ctx.fillRect(100, 250, 1400, 5);
      return c.toDataURL("image/png");
    });
    await page.evaluate((src) => {
      const bytes = Uint8Array.from(atob(src.split(",")[1]), (c) =>
          c.charCodeAt(0),
        ),
        data = new DataTransfer();
      data.items.add(new File([bytes], "question.png", { type: "image/png" }));
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    }, imageSrc);
    await page.waitForFunction(
      () => window.BookStudio.getProject().pages[1].blocks.length === 1,
    );
    let p = await state(),
      image = p.pages[1].blocks[0];
    assert.equal(image.src, imageSrc);
    assert.equal(image.originalSrc, imageSrc);
    assert.equal(image.naturalWidth, 2400);
    const imageId = image.id,
      imageNode = page.locator(`.image-block[data-block="${imageId}"]`);
    await imageNode.scrollIntoViewIfNeeded();
    await imageNode.click();
    await page.selectOption("#zoom", "0.65");
    let box = await imageNode.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 45,
      box.y + box.height / 2 + 25,
      { steps: 8 },
    );
    await page.mouse.up();
    p = await state();
    const moved = p.pages[1].blocks[0];
    assert.ok(Math.abs(moved.x - image.x) > 20);
    assert.equal(moved.src, imageSrc);
    await page
      .locator(".alignment-grid")
      .getByRole("button", { name: "Centre", exact: true })
      .click();
    p = await state();
    image = p.pages[1].blocks[0];
    assert.ok(Math.abs(image.x + image.w / 2 - (186 * 96) / 25.4 / 2) < 0.1);
    const w = image.w;
    const handle = imageNode.locator(".selection-handle.se");
    await handle.scrollIntoViewIfNeeded();
    box = await handle.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + 30, { steps: 8 });
    await page.mouse.up();
    p = await state();
    assert.ok(p.pages[1].blocks[0].w > w);
    assert.equal(p.pages[1].blocks[0].src, imageSrc);
    await imageNode.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "CER touch-up", exact: true })
      .click();
    await page.waitForSelector("#annotOverlay.show");
    assert.deepEqual(
      await page.locator("#annotCanvas").evaluate((c) => [c.width, c.height]),
      [2400, 1800],
    );
    await page.click('[data-atool="paint"]');
    const canvas = page.locator("#annotCanvas");
    box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2, {
      steps: 5,
    });
    await page.mouse.up();
    await page
      .locator("#annotOverlay .overlay-foot")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await page.waitForSelector("#annotOverlay.show", { state: "hidden" });
    p = await state();
    assert.notEqual(p.pages[1].blocks[0].src, imageSrc);
    assert.equal(p.pages[1].blocks[0].naturalWidth, 2400);
    assert.equal(p.pages[1].blocks[0].originalSrc, imageSrc);
    await page.click("#undo");
    p = await state();
    assert.equal(p.pages[1].blocks[0].src, imageSrc);
    await page.click("#redo");
    p = await state();
    assert.notEqual(p.pages[1].blocks[0].src, imageSrc);
    await page.getByRole("button", { name: "Restore original image" }).click();
    p = await state();
    assert.equal(p.pages[1].blocks[0].src, imageSrc);
    // A drag can transfer a picture to another manually created page.
    await page.locator("#preview-scroll").evaluate((n) => (n.scrollTop = 450));
    await imageNode.scrollIntoViewIfNeeded();
    const previous = page
      .locator(".worksheet")
      .first()
      .locator(".worksheet-content");
    await page.locator("#preview-scroll").evaluate((n) => (n.scrollTop = 400));
    let ib = await imageNode.boundingBox(),
      pb = await previous.boundingBox();
    if (ib.y + ib.height / 2 < 1200 && pb.y + pb.height - 80 > 150) {
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        pb.x + pb.width / 2,
        Math.min(1000, pb.y + pb.height - 100),
        { steps: 12 },
      );
      await page.mouse.up();
      p = await state();
      assert.ok(
        p.pages[0].blocks.some((b) => b.id === imageId),
        "cross-page drag transferred image",
      );
      await page.locator('[data-field="page"]').selectOption(p.pages[1].id);
      p = await state();
      assert.equal(p.pages[1].blocks[0].id, imageId);
    }
    await page.click("#add-habit");
    await page.click("#add-habit");
    p = await state();
    assert.equal(p.pages[1].blocks.filter((b) => b.type === "habit").length, 2);
    // Align and distribute several independently placed banners together.
    await page.getByLabel("Free placement", { exact: true }).check();
    await page.getByLabel("Width (mm)", { exact: true }).fill("75");
    await page.getByLabel("X (mm)", { exact: true }).fill("10");
    await page.getByLabel("Y (mm)", { exact: true }).fill("30");
    await page
      .locator("#inspector-content")
      .getByRole("button", { name: "Duplicate", exact: true })
      .click();
    await page.getByLabel("Y (mm)", { exact: true }).fill("60");
    await page
      .locator("#inspector-content")
      .getByRole("button", { name: "Duplicate", exact: true })
      .click();
    await page.getByLabel("Y (mm)", { exact: true }).fill("95");
    p = await state();
    const habits = p.pages[1].blocks.filter(
      (b) => b.type === "habit" && b.floating,
    );
    const nodes = habits.map((b) =>
      page.locator(`.habit-block[data-block="${b.id}"]`),
    );
    await nodes[0].click();
    for (const n of nodes.slice(1)) {
      await n.click({ modifiers: ["Shift"] });
    }
    await page
      .locator(".alignment-grid")
      .getByRole("button", { name: "Left", exact: true })
      .click();
    await page
      .locator(".alignment-grid")
      .getByRole("button", { name: "Space ↕", exact: true })
      .click();
    p = await state();
    const aligned = habits.map((b) =>
      p.pages[1].blocks.find((x) => x.id === b.id),
    );
    assert.ok(aligned.every((b) => Math.abs(b.x - aligned[0].x) < 0.1));
    await page.click("#add-page");
    const long = Array.from(
      { length: 90 },
      (_, i) => `Line ${i + 1}: explain your mathematical thinking.`,
    ).join("\n");
    await page.fill("#paste-input", long);
    await page.click("#add-text");
    assert.ok((await page.locator(".worksheet").count()) >= 5);
    const overflow = await page
      .locator(".worksheet .worksheet-content")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.scrollHeight > n.clientHeight + 2),
      );
    assert.ok(!overflow.some(Boolean));
    await page.waitForTimeout(700);
    const before = await state();
    await page.reload();
    await page.waitForFunction(() => window.BookStudio);
    const after = await state();
    assert.equal(after.title, before.title);
    assert.equal(after.pages.length, before.pages.length);
    assert.deepEqual(
      after.pages.map((p) =>
        p.blocks.map((b) => ({
          id: b.id,
          type: b.type,
          text: b.text,
          title: b.title,
          src: b.src,
          originalSrc: b.originalSrc,
          x: b.x || 0,
          y: b.y || 0,
          w: b.type === "image" ? b.w : null,
        })),
      ),
      before.pages.map((p) =>
        p.blocks.map((b) => ({
          id: b.id,
          type: b.type,
          text: b.text,
          title: b.title,
          src: b.src,
          originalSrc: b.originalSrc,
          x: b.x || 0,
          y: b.y || 0,
          w: b.type === "image" ? b.w : null,
        })),
      ),
    );
    dl = page.waitForEvent("download");
    await page.click("#export-project");
    file = await dl;
    await file.saveAs(path.join(output, "roundtrip.book.json"));
    const saved = JSON.parse(
      fs.readFileSync(path.join(output, "roundtrip.book.json"), "utf8"),
    );
    assert.equal(saved.pages[1].blocks[0].src, imageSrc);
    await page.setInputFiles(
      "#project-input",
      path.join(output, "roundtrip.book.json"),
    );
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    assert.equal((await state()).pages[1].blocks[0].src, imageSrc);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.selectOption("#zoom", "fit");
    await page.screenshot({ path: path.join(output, "mobile.png") });
    assert.deepEqual(errors, []);
    await require("./editor-features.cjs")(browser, base, output);
    await require("./powerpoint-textboxes.cjs")(browser, base, output);
    await require("./page-templates.cjs")(browser, base, output);
    await require("./text-paste.cjs")(browser, base);
    await require("./page-clipboard.cjs")(browser, base, output);
    await require("./page-thumbnails.cjs")(browser, base, output);
    await require("./fractions.cjs")(browser, base, output);
    console.log(
      "Browser acceptance passed: paste, native pixels, multiple habits, drag/resize/align, CER edit/undo, long-page flow, A4 PDF/SVG, mobile, autosave, project round-trip.",
    );
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e.stack?.slice(0, 1600) || e.message);
  process.exitCode = 1;
});
