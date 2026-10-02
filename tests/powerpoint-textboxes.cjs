const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function powerpointTextboxes(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1660, height: 1250 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const block = async (id) =>
    (await state()).pages[0].blocks.find((b) => b.id === id);
  const node = (id) => page.locator(`.worksheet [data-block="${id}"]`);
  const text = (id) => node(id).locator(".rich-textbox");
  async function point(locator, position) {
    await locator.scrollIntoViewIfNeeded();
    return locator.evaluate((n, position) => {
      const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let offset = 0;
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (t.parentElement.closest("[data-caret]")) continue;
        if (position <= offset + t.length) {
          const range = document.createRange();
          range.setStart(t, position - offset);
          range.collapse(true);
          const r = range.getBoundingClientRect();
          return { x: r.x, y: r.y + r.height / 2 };
        }
        offset += t.length;
      }
      throw new Error("Text position not found");
    }, position);
  }
  async function clickAt(locator, position, clickCount = 1) {
    const p = await point(locator, position);
    await page.mouse.click(p.x, p.y, { clickCount });
  }
  async function colour(value) {
    await page.locator("#text-colour").evaluate((n, value) => {
      n.value = value;
      n.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
  async function drag(locator, dx, dy) {
    await locator.scrollIntoViewIfNeeded();
    const r = await locator.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, {
      steps: 8,
    });
    await page.mouse.up();
  }
  async function open(fixture, name) {
    const file = path.join(output, name + ".book.json");
    fs.writeFileSync(file, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", file);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
  }
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const fixture = await state();
    fixture.id = "b_powerpoint_test";
    fixture.title = "Thinking in patterns";
    fixture.snap = false;
    fixture.pages = [
      {
        id: "b_ppt_page",
        blocks: [
          {
            id: "b_ppt_habit",
            type: "habit",
            number: "01",
            title: "Look for a pattern",
          },
          {
            id: "b_ppt_a",
            type: "text",
            part: "a",
            text: "Maya has 3 boxes of 12 beads. Find the total.",
          },
          {
            id: "b_ppt_b",
            type: "text",
            part: "b",
            text: "Noah gives 9 beads to a friend. How many are left?",
          },
          {
            id: "b_ppt_table",
            type: "table",
            rows: 1,
            cols: 2,
            w: 703,
            headerRow: false,
            cells: [[{ text: "Boxes" }, { text: "Beads" }]],
          },
          {
            id: "b_ppt_answer",
            type: "answer",
            text: "Answer",
            part: "a",
            value: "",
            showLine: true,
          },
        ],
      },
    ];
    await open(fixture, "powerpoint");
    await page.selectOption("#zoom", "0.65");

    // A single click puts the caret at the clicked character, including when
    // switching directly to another box and returning without pressing Done.
    await clickAt(text("b_ppt_a"), 9);
    assert.equal(
      await text("b_ppt_a").evaluate((n) => n.isContentEditable),
      true,
    );
    await page.keyboard.type("red ");
    assert.equal(
      (await block("b_ppt_a")).text,
      "Maya has red 3 boxes of 12 beads. Find the total.",
    );
    await clickAt(text("b_ppt_b"), 5);
    await page.keyboard.type("also ");
    assert.match((await block("b_ppt_b")).text, /^Noah also gives/);
    await clickAt(text("b_ppt_a"), 0);
    await page.keyboard.type("Now ");
    assert.match((await block("b_ppt_a")).text, /^Now Maya has red/);
    assert.equal(
      await page.locator(".worksheet [contenteditable=true]").count(),
      1,
    );

    // Border selection formats every word, keeping unrelated boxes unchanged.
    await node("b_ppt_a")
      .locator(".selection-edge.n")
      .click({ position: { x: 30, y: 4 } });
    await page.waitForFunction(
      () => !document.querySelector(".worksheet [contenteditable=true]"),
    );
    await page.selectOption("#text-font", "Roboto");
    await page.locator("#text-size").fill("15");
    await page.locator("#text-size").dispatchEvent("change");
    await colour("#21536a");
    let a = await block("b_ppt_a");
    assert.equal(a.floating, false);
    assert.equal(a.fontSize, 20);
    assert.ok(
      a.runs.every((r) => r.fontFamily === "Roboto" && r.color === "#21536a"),
    );
    assert.equal((await block("b_ppt_b")).fontFamily, undefined);
    assert.equal(await node("b_ppt_a").locator(".selection-handle").count(), 8);

    // Dragging across text on its first click selects words, not the box.
    const beforeTextDrag = await block("b_ppt_a");
    const from = await point(text("b_ppt_a"), 4),
      to = await point(text("b_ppt_a"), 8);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), "Maya");
    assert.equal((await block("b_ppt_a")).floating, beforeTextDrag.floating);
    await page.click("#format-bold");
    await page.click("#format-underline");
    await page.selectOption("#text-font", "Helvetica");
    await colour("#ad2468");
    assert.equal(await page.evaluate(() => getSelection().toString()), "Maya");
    a = await block("b_ppt_a");
    assert.ok(
      a.runs.some(
        (r) =>
          r.text === "Maya" &&
          r.bold &&
          r.underline &&
          r.fontFamily === "Helvetica" &&
          r.color === "#ad2468",
      ),
    );
    assert.equal(a.runs[0].fontFamily, "Roboto");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Show your method.");
    assert.match((await block("b_ppt_a")).text, /total\.\nShow your method\.$/);
    await page.keyboard.press("Escape");
    assert.equal(
      await text("b_ppt_a").evaluate((n) => n.isContentEditable),
      false,
    );
    await page.keyboard.press("F2");
    assert.equal(
      await text("b_ppt_a").evaluate((n) => n.isContentEditable),
      true,
    );
    await page.keyboard.press("Escape");
    const boxes = (await block("b_ppt_a")).text.indexOf("boxes");
    await clickAt(text("b_ppt_a"), boxes + 2, 2);
    assert.equal(await page.evaluate(() => getSelection().toString()), "boxes");
    await page.click("#format-italic");
    await page.keyboard.press("Escape");

    // Horizontal and vertical side handles change the frame, preserving all
    // character formatting; dragging a flow box gives it free placement.
    const runs = (await block("b_ppt_a")).runs;
    const widthBefore = await node("b_ppt_a").evaluate((n) => n.offsetWidth);
    await drag(node("b_ppt_a").locator(".selection-handle.e"), -130, 0);
    a = await block("b_ppt_a");
    assert.equal(a.floating, true);
    assert.ok(a.w < widthBefore - 100);
    assert.deepEqual(a.runs, runs);
    const h = await node("b_ppt_a").evaluate((n) => n.offsetHeight),
      w = a.w;
    await drag(node("b_ppt_a").locator(".selection-handle.s"), 0, 70);
    a = await block("b_ppt_a");
    assert.ok(a.boxHeight > h + 60);
    assert.equal(a.w, w);
    assert.deepEqual(a.runs, runs);
    const position = { x: a.x, y: a.y };
    const edge = node("b_ppt_a").locator(".selection-edge.n");
    const edgeBox = await edge.boundingBox();
    await page.mouse.move(edgeBox.x + 20, edgeBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(edgeBox.x + 45, edgeBox.y + 36, { steps: 8 });
    await page.mouse.up();
    a = await block("b_ppt_a");
    assert.ok(a.x > position.x + 20 && a.y > position.y + 25);
    await page.keyboard.press("Control+Z");
    assert.equal((await block("b_ppt_a")).x, position.x);
    await page.keyboard.press("Control+Y");
    assert.equal((await block("b_ppt_a")).x, a.x);
    await page.locator('[data-field="y"]').fill("90");

    // Cells and an empty answer line activate on one click too.
    const cell1 = node("b_ppt_table").locator('[data-cell="0,0"]'),
      cell2 = node("b_ppt_table").locator('[data-cell="0,1"]');
    await clickAt(cell1, 0);
    await page.keyboard.type("3 ");
    await clickAt(cell2, 0);
    await page.keyboard.type("12 ");
    assert.equal((await block("b_ppt_table")).cells[0][0].text, "3 Boxes");
    assert.equal((await block("b_ppt_table")).cells[0][1].text, "12 Beads");
    await node("b_ppt_answer").locator(".answer-line").click();
    await page.keyboard.type("36 beads");
    assert.equal((await block("b_ppt_answer")).value, "36 beads");
    await page.keyboard.press("Escape");

    // Math Habits retain normal selection/movement on one click; double-click
    // edits the title or number in place, with independent formatting runs.
    const habitTitle = node("b_ppt_habit").locator(".habit-title"),
      habitNumber = node("b_ppt_habit").locator(".habit-number");
    await habitTitle.click();
    assert.equal(await habitTitle.evaluate((n) => n.isContentEditable), false);
    await habitTitle.dblclick();
    assert.equal(await habitTitle.evaluate((n) => n.isContentEditable), true);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Take note of shared sides");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Check shared corners");
    await page.keyboard.press("Escape");
    assert.equal(
      (await block("b_ppt_habit")).title,
      "Take note of shared sides\nCheck shared corners",
    );
    await clickAt(habitTitle, 2, 2);
    assert.equal(await page.evaluate(() => getSelection().toString()), "Take");
    await page.click("#format-italic");
    await colour("#ad2468");
    await habitNumber.dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("04");
    await page.keyboard.press("Escape");
    const habit = await block("b_ppt_habit");
    assert.equal(habit.number, "04");
    assert.ok(
      habit.titleRuns.some(
        (r) => r.text === "Take" && r.italic && r.color === "#ad2468",
      ),
    );
    assert.ok(habit.numberRuns.every((r) => r.color === "#ffffff"));
    // Finishing a banner can replace its DOM node during page reflow. Query
    // and read the current node in one browser task, rather than a stale handle.
    await page.waitForFunction(() => {
      const number = document.querySelector(
        '.worksheet [data-block="b_ppt_habit"] .habit-number',
      );
      return number && getComputedStyle(number).color === "rgb(255, 255, 255)";
    });

    // Local autosave and portable projects retain frame dimensions and banner
    // text. Selection chrome never changes the printable SVG/PDF artwork.
    await page.waitForFunction(() =>
      document
        .getElementById("save-status")
        .textContent.includes("Draft saved"),
    );
    const saved = await state();
    await page.reload();
    await page.waitForFunction(() => window.BookStudio);
    assert.deepEqual(
      (await block("b_ppt_a")).runs,
      saved.pages[0].blocks.find((b) => b.id === "b_ppt_a").runs,
    );
    assert.equal(
      (await block("b_ppt_a")).boxHeight,
      saved.pages[0].blocks.find((b) => b.id === "b_ppt_a").boxHeight,
    );
    assert.equal((await block("b_ppt_habit")).title, habit.title);
    assert.deepEqual((await block("b_ppt_habit")).titleRuns, habit.titleRuns);
    await node("b_ppt_a").locator(".rich-textbox").click();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(output, "powerpoint-textboxes.png"),
    });
    let download = page.waitForEvent("download");
    await page.click("#export-svg");
    let file = await download;
    await file.saveAs(path.join(output, "powerpoint-selected.svg"));
    await page.locator(".worksheet-masthead").click();
    download = page.waitForEvent("download");
    await page.click("#export-svg");
    file = await download;
    await file.saveAs(path.join(output, "powerpoint-unselected.svg"));
    assert.equal(
      fs.readFileSync(path.join(output, "powerpoint-selected.svg"), "utf8"),
      fs.readFileSync(path.join(output, "powerpoint-unselected.svg"), "utf8"),
    );
    download = page.waitForEvent("download");
    await page.click("#export-pdf");
    file = await download;
    await file.saveAs(path.join(output, "powerpoint-textboxes.pdf"));
    assert.ok(
      fs.statSync(path.join(output, "powerpoint-textboxes.pdf")).size > 50000,
    );

    // Editing only a continuation updates the full model and its formatting,
    // then repaginates without duplicating or dropping surrounding text.
    const long = Array.from(
      { length: 100 },
      (_, i) => `Step ${i + 1}: keep this sentence.`,
    ).join("\n");
    fixture.pages[0].blocks = [
      {
        id: "b_ppt_long",
        type: "text",
        text: long,
        fontFamily: "Roboto",
        runs: [{ text: long, color: "#21536a" }],
      },
    ];
    await open(fixture, "powerpoint-long");
    const continuation = text("b_ppt_long").nth(1);
    await continuation.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Repeat on future pages…", exact: true })
      .click();
    assert.equal(await page.locator("#repeat-dialog[open]").count(), 0);
    assert.equal((await block("b_ppt_long")).repeatOnPages, false);
    await continuation.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Edit text", exact: true })
      .click();
    assert.equal(await continuation.evaluate((n) => n.isContentEditable), true);
    await page.keyboard.press("Escape");
    const start = await continuation.evaluate((n) => Number(n.dataset.start));
    await clickAt(continuation, 5);
    await page.keyboard.type("extra ");
    const updated = long.slice(0, start + 5) + "extra " + long.slice(start + 5);
    assert.equal((await block("b_ppt_long")).text, updated);
    await page.keyboard.press("Escape");
    assert.equal(
      (await text("b_ppt_long").allTextContents()).join(""),
      updated,
    );
    assert.equal(
      await page
        .locator(".worksheet-content")
        .evaluateAll((nodes) =>
          nodes.some((n) => n.scrollHeight > n.clientHeight + 2),
        ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PowerPoint-style acceptance passed: single-click caret and box switching, native word/drag selection, border formatting/movement, eight resize handles, frame persistence, direct banner editing, continuation edits and clean PDF/SVG.",
    );
  } finally {
    await page.close();
  }
};
