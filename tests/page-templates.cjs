const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function pageTemplates(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1660, height: 1250 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const find = async (id) =>
    (await state()).pages.flatMap((p) => p.blocks).find((b) => b.id === id);
  const sheet = (id, index = 0) =>
    page.locator(`.worksheet[data-page="${id}"]`).nth(index);
  const item = (pageId, id, index = 0) =>
    sheet(pageId, index).locator(`[data-block="${id}"]`);
  async function context(locator, name) {
    await locator.click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  async function replaceTitle(locator, value) {
    await locator.locator(".habit-title").dblclick();
    assert.equal(
      await locator
        .locator(".habit-title")
        .evaluate((n) => n.isContentEditable),
      true,
    );
    await page.keyboard.press("Control+A");
    await page.keyboard.type(value);
    await page.keyboard.press("Escape");
  }
  async function repeat(locator, x, y, mode) {
    await context(locator, "Repeat on future pages…");
    await page.locator("#repeat-x").fill(String(x));
    await page.locator("#repeat-y").fill(String(y));
    await page.selectOption("#repeat-mode", mode);
    await page.click("#repeat-save");
    await page.waitForSelector("#repeat-dialog", { state: "hidden" });
  }
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const fixture = await state();
    fixture.id = "b_repeat_test";
    fixture.snap = false;
    fixture.pages = [
      {
        id: "b_before",
        blocks: [{ id: "b_earlier", type: "text", text: "Earlier page" }],
      },
      {
        id: "b_source",
        blocks: [
          {
            id: "b_banner",
            type: "habit",
            number: "01",
            title: "Look for a pattern",
          },
          {
            id: "b_source_long",
            type: "text",
            text: Array.from(
              { length: 40 },
              (_, i) => `Source step ${i + 1}`,
            ).join("\n"),
          },
        ],
      },
      {
        id: "b_future",
        blocks: [
          {
            id: "b_question_layout",
            type: "text",
            text: "Question 1: Maya has 3 boxes of 12 beads.",
            fontFamily: "Roboto",
            color: "#21536a",
            lineSpacing: 2,
          },
        ],
      },
    ];
    const input = path.join(output, "page-templates.book.json");
    fs.writeFileSync(input, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", input);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.selectOption("#zoom", "0.65");
    await context(item("b_source", "b_banner"), "Repeat on future pages…");
    await page.locator("#repeat-x").fill("999");
    await page.click("#repeat-save");
    assert.match(
      await page.locator("#repeat-error").textContent(),
      /within the content/,
    );
    assert.equal((await find("b_banner")).repeatOnPages, false);
    await page.locator("#repeat-x").fill("12");
    await page.locator("#repeat-y").fill("24");
    await page.click("#repeat-save");
    await page.waitForSelector("#repeat-dialog", { state: "hidden" });
    assert.equal((await find("b_banner")).repeatMode, "shared");
    assert.equal(
      await sheet("b_before").locator('[data-block="b_banner"]').count(),
      0,
    );
    const layouts = await page.evaluate(() => window.BookStudio.getLayout());
    assert.ok(layouts.filter((s) => s.pageId === "b_source").length >= 2);
    assert.ok(
      layouts
        .filter((s) => s.pageId !== "b_before")
        .every((s) => s.ids.includes("b_banner")),
    );
    const coordinates = await page
      .locator('.worksheet [data-block="b_banner"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const s = n.closest(".worksheet").getBoundingClientRect(),
            r = n.getBoundingClientRect(),
            scale = s.width / 210;
          return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale };
        }),
      );
    assert.ok(
      coordinates.every(
        (r) => Math.abs(r.x - 12) < 0.01 && Math.abs(r.y - 24) < 0.01,
      ),
    );
    await page.click("#add-page");
    let p = await state();
    const newId = p.pages.at(-1).id;
    assert.equal(await item(newId, "b_banner").count(), 1);
    await sheet(newId).locator(".worksheet-masthead").click();
    await page
      .getByRole("button", { name: "Duplicate page", exact: true })
      .click();
    p = await state();
    const duplicateId = p.pages.at(-1).id;
    assert.equal(await item(duplicateId, "b_banner").count(), 1);

    // Detach a shared banner on one manual page, keeping all other copies.
    await context(item(duplicateId, "b_banner"), "Make this copy independent");
    p = await state();
    let copy = p.pages.at(-1).blocks.find((b) => b.repeatedFrom === "b_banner");
    assert.ok(copy && !copy.repeatOnPages);
    await replaceTitle(item(duplicateId, copy.id), "Equal groups");
    assert.equal((await find("b_banner")).title, "Look for a pattern");
    assert.equal((await find(copy.id)).title, "Equal groups");
    assert.equal(await item(duplicateId, "b_banner").count(), 0);
    await context(item(duplicateId, copy.id), "Use repeated version");
    assert.equal(await item(duplicateId, "b_banner").count(), 1);
    await page.keyboard.press("Control+Z");
    assert.equal((await find(copy.id)).title, "Equal groups");

    // The original page and a continuation can also be detached separately.
    await context(item("b_source", "b_banner"), "Make this copy independent");
    p = await state();
    let sourceCopy = p.pages[1].blocks.find(
      (b) => b.repeatedFrom === "b_banner" && b.sheetIndex === 0,
    );
    await replaceTitle(
      item("b_source", sourceCopy.id),
      "Original page variation",
    );
    await context(
      item("b_source", "b_banner", 1),
      "Make this copy independent",
    );
    p = await state();
    const continuationCopy = p.pages[1].blocks.find(
      (b) => b.repeatedFrom === "b_banner" && b.sheetIndex === 1,
    );
    await replaceTitle(
      item("b_source", continuationCopy.id, 1),
      "Continuation variation",
    );
    assert.equal((await find("b_banner")).title, "Look for a pattern");
    assert.equal(
      await item("b_future", "b_banner").locator(".habit-title").textContent(),
      "Look for a pattern",
    );
    assert.equal(
      await item("b_source", sourceCopy.id)
        .locator(".habit-title")
        .textContent(),
      "Original page variation",
    );

    // Question layouts create blank boxes with separate IDs and formatting.
    await repeat(item("b_future", "b_question_layout"), 12, 65, "independent");
    p = await state();
    const newCopy = p.pages
        .find((q) => q.id === newId)
        .blocks.find((b) => b.repeatedFrom === "b_question_layout"),
      duplicateCopy = p.pages
        .find((q) => q.id === duplicateId)
        .blocks.find((b) => b.repeatedFrom === "b_question_layout");
    assert.ok(newCopy && duplicateCopy && newCopy.id !== duplicateCopy.id);
    assert.equal(newCopy.text, "");
    assert.equal(duplicateCopy.text, "");
    assert.equal(newCopy.fontFamily, "Roboto");
    assert.equal(newCopy.x, (await find("b_question_layout")).x);
    assert.equal(newCopy.y, (await find("b_question_layout")).y);
    await item(newId, newCopy.id).locator(".rich-textbox").click();
    await page.keyboard.type("Question A: Find the total of 6 groups of 8.");
    await page.keyboard.press("Escape");
    await item(duplicateId, duplicateCopy.id).locator(".rich-textbox").click();
    await page.keyboard.type(
      "Question B: Share 48 beads equally among 4 friends.",
    );
    await page.keyboard.press("Escape");
    assert.match((await find(newCopy.id)).text, /^Question A/);
    assert.match((await find(duplicateCopy.id)).text, /^Question B/);
    assert.match((await find("b_question_layout")).text, /^Question 1/);
    assert.equal(await item(newId, "b_question_layout").count(), 0);

    // Independent image layouts start empty, then replace from a full-fidelity
    // clipboard image without changing the source or any other placeholder.
    await page.locator(".page-tab").nth(2).click();
    await page.click("#add-hexagon");
    p = await state();
    const image = p.pages[2].blocks.find((b) => b.type === "image");
    await repeat(item("b_future", image.id), 80, 160, "independent");
    p = await state();
    const imageCopy = p.pages
        .find((q) => q.id === newId)
        .blocks.find((b) => b.repeatedFrom === image.id),
      otherImage = p.pages
        .find((q) => q.id === duplicateId)
        .blocks.find((b) => b.repeatedFrom === image.id);
    assert.equal(imageCopy.templatePlaceholder, true);
    assert.notEqual(imageCopy.src, image.src);
    await item(newId, imageCopy.id).click();
    await page.evaluate((src) => {
      const bytes = Uint8Array.from(atob(src.split(",")[1]), (c) =>
          c.charCodeAt(0),
        ),
        clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File([bytes], "question.svg", { type: "image/svg+xml" }),
      );
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true }),
      );
    }, image.src);
    await page.waitForFunction(
      (id) =>
        !window.BookStudio.getProject()
          .pages.flatMap((p) => p.blocks)
          .find((b) => b.id === id).templatePlaceholder,
      imageCopy.id,
    );
    assert.equal((await find(imageCopy.id)).src, image.src);
    assert.equal((await find(imageCopy.id)).originalSrc, image.src);
    assert.equal((await find(otherImage.id)).templatePlaceholder, true);
    assert.equal((await find(image.id)).src, image.src);

    // New pages and automatic continuation sheets receive independent blank
    // questions and pictures. Flow text stays clear of the pinned geometry.
    await page.click("#add-page");
    p = await state();
    const lastPage = p.pages.at(-1).id;
    const long = Array.from(
      { length: 40 },
      (_, i) => `Working step ${i + 1}`,
    ).join("\n");
    await page.locator("#paste-input").fill(long);
    await page.click("#add-text");
    p = await state();
    const last = p.pages.at(-1),
      flow = last.blocks.find((b) => b.type === "text" && !b.floating);
    assert.ok(
      (await page.locator(`.worksheet[data-page="${lastPage}"]`).count()) >= 2,
    );
    const copies = last.blocks.filter(
      (b) => b.repeatedFrom === "b_question_layout",
    );
    assert.ok(copies.length >= 2 && copies.every((b) => b.text === ""));
    assert.equal(
      (
        await page
          .locator(
            `.worksheet[data-page="${lastPage}"] [data-block="${flow.id}"] .rich-textbox`,
          )
          .allTextContents()
      ).join(""),
      long,
    );
    const overlap = await page
      .locator(`.worksheet[data-page="${lastPage}"]`)
      .evaluateAll((sheets) =>
        sheets.some((s) => {
          const flowing = [
              ...s.querySelectorAll(".sheet-block:not(.floating)"),
            ].map((n) => n.getBoundingClientRect()),
            floating = [...s.querySelectorAll(".floating")].map((n) =>
              n.getBoundingClientRect(),
            );
          return flowing.some((a) =>
            floating.some((b) => a.top < b.bottom - 1 && a.bottom > b.top + 1),
          );
        }),
      );
    assert.equal(overlap, false);
    await sheet(lastPage).screenshot({
      path: path.join(output, "page-template-preview.png"),
    });
    await page.waitForFunction(() =>
      document
        .getElementById("save-status")
        .textContent.includes("Draft saved"),
    );
    const saved = await state();
    await page.reload();
    await page.waitForFunction(() => window.BookStudio);
    const restored = await state();
    assert.deepEqual(
      restored.pages.map((p) => p.blocks.map((b) => b.id)),
      saved.pages.map((p) => p.blocks.map((b) => b.id)),
    );
    assert.deepEqual(
      restored.pages[1].repeatSuppressed,
      saved.pages[1].repeatSuppressed,
    );
    assert.equal((await find(imageCopy.id)).originalSrc, image.src);
    assert.match((await find(newCopy.id)).text, /^Question A/);
    assert.match((await find(duplicateCopy.id)).text, /^Question B/);
    assert.equal((await find("b_question_layout")).repeatMode, "independent");
    assert.deepEqual(errors, []);
    console.log(
      "Page-template acceptance passed: exact positions, later/continuation pages, shared banners, per-sheet independence and reset/undo, blank question layouts, original image replacement, reserved flow space and saved copy identities.",
    );
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, "page-template-failure.png") })
      .catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
};
