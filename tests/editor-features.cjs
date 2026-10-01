const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const installFirebaseMock = require("./firebase-mock.cjs");
module.exports = async function features(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1660, height: 1250 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installFirebaseMock(page, base);
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    await page.click("#new-project");
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    const state = () => page.evaluate(() => window.BookStudio.getProject());
    const block = (type) =>
      state().then((p) => p.pages[0].blocks.find((b) => b.type === type));
    async function selectText(locator, start, end = start) {
      await locator.evaluate(
        (node, { start, end }) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT),
            nodes = [];
          while (walker.nextNode())
            if (!walker.currentNode.parentElement.closest("[data-caret]"))
              nodes.push(walker.currentNode);
          function point(pos) {
            let offset = 0;
            for (const n of nodes) {
              if (pos <= offset + n.length) return [n, pos - offset];
              offset += n.length;
            }
            return [node, node.childNodes.length];
          }
          node.focus();
          const range = document.createRange();
          range.setStart(...point(start));
          range.setEnd(...point(end));
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        },
        { start, end },
      );
    }
    async function colour(selector, value) {
      await page.locator(selector).evaluate((n, v) => {
        n.value = v;
        n.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    }
    await page.click("#add-question-parts");
    let p = await state();
    assert.deepEqual(
      p.pages[0].blocks.map((b) => b.part),
      ["a", "b", "c"],
    );
    const ids = p.pages[0].blocks.map((b) => b.id),
      a = page.locator(`.worksheet [data-block="${ids[0]}"] .rich-textbox`);
    await a.dblclick();
    await page.keyboard.type("Maya has 3 boxes of 12 beads");
    await selectText(a, 23, 28); // beads
    await page.click("#format-bold");
    await page.click("#format-underline");
    await page.selectOption("#text-font", "Roboto");
    await page.locator("#text-size").fill("13.5");
    await page.locator("#text-size").dispatchEvent("change");
    await colour("#text-colour", "#ad2468");
    p = await state();
    let first = p.pages[0].blocks[0];
    assert.ok(
      first.runs.some(
        (r) =>
          r.text === "beads" &&
          r.bold &&
          r.underline &&
          r.color === "#ad2468" &&
          r.fontFamily === "Roboto" &&
          r.fontSize === 18,
      ),
    );
    assert.ok(!first.runs[0].bold);
    await selectText(a, 28);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("How many beads altogether?");
    p = await state();
    first = p.pages[0].blocks[0];
    assert.match(first.text, /beads\nHow many beads altogether\?/);
    assert.ok(
      first.runs.some(
        (r) =>
          r.text.includes("\nHow many") &&
          r.bold &&
          r.underline &&
          r.fontFamily === "Roboto",
      ),
    );
    await page.locator("#text-spacing").fill("2.2");
    await page.locator("#text-spacing").dispatchEvent("change");
    assert.equal((await state()).pages[0].blocks[0].lineSpacing, 2.2);
    assert.ok(
      Math.abs(
        (await a.evaluate(
          (n) =>
            parseFloat(getComputedStyle(n).lineHeight) /
            parseFloat(getComputedStyle(n).fontSize),
        )) - 2.2,
      ) < 0.01,
    );
    await page.click('[data-text-align="right"]');
    assert.equal((await state()).pages[0].blocks[0].align, "right");
    await page.click('[data-text-align="justify"]');
    assert.equal((await state()).pages[0].blocks[0].align, "justify");
    await page.click('[data-text-align="left"]');
    await selectText(a, 23, 28);
    await page.keyboard.press("Control+Shift+C");
    await page.click("#finish-text");
    const b = page.locator(`.worksheet [data-block="${ids[1]}"] .rich-textbox`);
    await b.dblclick();
    await page.keyboard.type("She gives 9 beads to Noah. How many are left?");
    await selectText(b, 12, 17);
    await page.keyboard.press("Control+Shift+V");
    p = await state();
    assert.ok(
      p.pages[0].blocks[1].runs.some(
        (r) =>
          r.text === "beads" &&
          r.fontFamily === "Roboto" &&
          r.bold &&
          r.underline &&
          r.color === "#ad2468",
      ),
    );
    assert.equal((await state()).pages[0].blocks[1].lineSpacing, 2.2);
    await page.click("#finish-text");
    const c = page.locator(`.worksheet [data-block="${ids[2]}"] .rich-textbox`);
    await c.dblclick();
    await page.keyboard.type(
      "She shares the remaining beads among 3 friends. Find each share.",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("Show your method.");
    await page.click("#finish-text");
    assert.match((await state()).pages[0].blocks[2].text, /share\.\nShow/);
    await page.click("#add-answer-parts");
    p = await state();
    assert.deepEqual(
      p.pages[0].blocks.filter((b) => b.type === "answer").map((b) => b.part),
      ["a", "b", "c"],
    );
    let answer = p.pages[0].blocks.find((b) => b.type === "answer");
    await page.locator(`#block-list [data-list-block="${answer.id}"]`).click();
    await page
      .getByRole("button", { name: "Edit answer on page", exact: true })
      .click();
    await page.keyboard.type("36 beads");
    await page.click("#finish-text");
    assert.equal((await block("answer")).value, "36 beads");
    await page.click("#add-shape");
    await page.click('[data-shape="rounded"]');
    let shape = await block("shape");
    await colour('[data-field="fill"]', "#f2e8f1");
    await colour('[data-field="stroke"]', "#ad2468");
    await page.locator('[data-field="strokeWidth"]').fill("3");
    await page.locator('[data-field="height"]').fill("25");
    await page.locator('[data-field="radius"]').fill("12");
    await page.locator('[data-field="y"]').fill("198");
    shape = await block("shape");
    assert.equal(shape.fill, "#f2e8f1");
    assert.equal(shape.stroke, "#ad2468");
    assert.equal(shape.strokeWidth, 3);
    assert.ok(shape.height > 90);
    await page.click("#add-shape");
    await page.click('[data-shape="circle"]');
    p = await state();
    const circle = p.pages[0].blocks.find(
      (b) => b.type === "shape" && b.kind === "circle",
    );
    await page.selectOption("#zoom", "0.65");
    const cn = page.locator(`.shape-block[data-block="${circle.id}"]`);
    await cn.scrollIntoViewIfNeeded();
    let handle = cn.locator(".selection-handle.se");
    let box = await handle.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 25, { steps: 5 });
    await page.mouse.up();
    p = await state();
    const resized = p.pages[0].blocks.find((x) => x.id === circle.id);
    assert.ok(resized.w > circle.w);
    assert.equal(resized.height, resized.w);
    await page.locator('[data-field="x"]').fill("110");
    await page.locator('[data-field="y"]').fill("190");
    await page.click("#add-table");
    await page.locator("#table-rows").fill("3");
    await page.locator("#table-cols").fill("2");
    await page.click("#table-insert");
    let table = await block("table");
    const cell = page.locator(
      `.worksheet [data-block="${table.id}"] [data-cell="0,0"]`,
    );
    await cell.dblclick();
    await page.keyboard.type("Boxes");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Beads");
    await page.keyboard.press("Tab");
    await page.keyboard.type("3");
    await page.keyboard.press("Tab");
    await page.keyboard.type("12");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("per box");
    await selectText(
      page.locator(`.worksheet [data-block="${table.id}"] [data-cell="1,1"]`),
      0,
      2,
    );
    await page.keyboard.press("Control+B");
    await page.click('[data-text-align="right"]');
    await page.click("#finish-text");
    table = await block("table");
    assert.equal(table.cells[0][0].text, "Boxes");
    assert.equal(table.cells[1][1].text, "12\nper box");
    assert.equal(table.cells[1][1].align, "right");
    assert.ok(table.cells[1][1].runs[0].bold);
    await page.getByRole("button", { name: "Add row", exact: true }).click();
    table = await block("table");
    assert.equal(table.rows, 4);
    assert.equal(table.cells[1][1].text, "12\nper box");
    await page.click("#keyboard-shortcuts");
    const shortcut = page.locator('[data-shortcut="table"]');
    await shortcut.click();
    await page.keyboard.press("Control+Shift+7");
    await page.click("#shortcut-save");
    assert.equal((await state()).shortcuts.table, "Mod+Shift+7");
    await page.locator("#sheets").click({ position: { x: 8, y: 8 } });
    await page.keyboard.press("Control+Shift+7");
    await page.waitForSelector("#table-dialog[open]");
    await page.click("#table-cancel");
    await page.click("#keyboard-shortcuts");
    await page.locator('[data-shortcut="table"]').click();
    await page.keyboard.press("Control+V");
    await page.click("#shortcut-save");
    assert.match(
      await page.locator("#shortcut-error").textContent(),
      /reserved/,
    );
    await page.click("#shortcut-cancel");
    await page.click("#add-habit");
    await page.locator('[data-field="title"]').fill("Equal groups");
    // Sign in once: AI and cloud share this account.
    await page.click("#cloud-books");
    await page.waitForSelector("#cloud-login:not([hidden])");
    await page.click("#cloud-google");
    await page.waitForFunction(() => window.__fm.auth.currentUser);
    await page.waitForFunction(
      () => Object.keys(window.__fm.index.bookStudioProjects).length === 1,
    );
    assert.equal(
      await page.locator("#cloud-status").textContent(),
      "Cloud: saved",
    );
    const savedId = (await state()).id;
    let cloud = await page.evaluate(
      (id) => window.__fm.index.bookStudioProjects[id],
      savedId,
    );
    assert.ok(cloud.bytes > 100);
    assert.equal(cloud.ownerUid, "teacher");
    assert.equal(
      await page.evaluate(() => window.__fm.index.aiEngine),
      "openai",
    );
    await page.click("#cloud-close");
    // A request must include every page element and an actual reading image.
    await page.click("#ai-tools");
    await page.waitForFunction(() =>
      document.getElementById("ai-account").textContent.includes("Connected"),
    );
    await page.selectOption("#ai-focus", ids[0]);
    await page
      .locator("#ai-guidance")
      .fill("Name each quantity and show units.");
    await page.click("#ai-generate");
    await page.waitForSelector("#ai-insert-actions:not([hidden])", {
      timeout: 30000,
    });
    const request = await page.evaluate(() => window.__fm.requests.at(-1));
    assert.equal(request.name, "askOpenAi");
    assert.ok(request.data.prompt.includes("Maya has 3 boxes"));
    assert.ok(request.data.prompt.includes("Noah"));
    assert.ok(request.data.prompt.includes("per box"));
    assert.ok(request.data.prompt.includes("EXISTING TEACHER ANSWER"));
    assert.ok(request.data.prompt.includes("Explain one quantity per line"));
    assert.ok(request.data.prompt.includes("Name each quantity"));
    assert.ok(request.data.media.length >= 1);
    assert.ok(request.data.media[0].data.length > 3000);
    assert.match(
      await page.locator("#ai-status").textContent(),
      /mock-shared-AI/,
    );
    await page.locator("#ai-output textarea").nth(1).fill("36 beads in total");
    await page.click("#ai-new-page");
    p = await state();
    assert.equal(p.pages.length, 2);
    assert.equal(
      p.pages[1].blocks.find((b) => b.type === "answer").value,
      "36 beads in total",
    );
    assert.ok(
      p.pages[1].blocks.some(
        (b) => b.type === "text" && b.text.includes("3 × 12"),
      ),
    );
    await page.locator(".page-tab").first().click();
    await page.selectOption("#zoom", "fit");
    await page.screenshot({ path: path.join(output, "editor-features.png") });
    let dl = page.waitForEvent("download");
    await page.click("#export-pdf");
    let file = await dl;
    await file.saveAs(path.join(output, "formatted-worksheet.pdf"));
    assert.ok(
      fs.statSync(path.join(output, "formatted-worksheet.pdf")).size > 50000,
    );
    dl = page.waitForEvent("download");
    await page.click("#export-svg");
    file = await dl;
    await file.saveAs(path.join(output, "formatted-worksheet.svg"));
    const svg = fs.readFileSync(
      path.join(output, "formatted-worksheet.svg"),
      "utf8",
    );
    assert.match(svg, /font-family="Roboto/);
    assert.match(svg, /text-decoration="underline"/);
    assert.match(svg, /stroke="#ad2468" stroke-width="3"/);
    assert.match(svg, /@font-face/);
    await page.waitForTimeout(3200);
    await page.click("#cloud-books");
    await page.click("#cloud-save-now");
    await page.waitForFunction(
      () =>
        document.getElementById("cloud-status").textContent === "Cloud: saved",
    );
    // Simulate a newer edit on another device, without overwriting it.
    await page.evaluate((id) => {
      window.__fm.index.bookStudioProjects[id].revision = "remote-newer";
      window.__fm.index.bookStudioProjects[id].title = "Newer device";
    }, savedId);
    await page.click("#cloud-close");
    await page.locator("#book-title").fill("My offline draft");
    await page.waitForFunction(
      () =>
        document
          .getElementById("cloud-status")
          .textContent.includes("newer version"),
      { timeout: 10000 },
    );
    assert.equal(
      await page.evaluate(
        (id) => window.__fm.index.bookStudioProjects[id].title,
        savedId,
      ),
      "Newer device",
    );
    await page.click("#cloud-books");
    await page.click("#cloud-save-copy");
    await page.waitForFunction(
      () => Object.keys(window.__fm.index.bookStudioProjects).length === 2,
    );
    assert.notEqual((await state()).id, savedId);
    await page.waitForFunction(
      () =>
        document.getElementById("cloud-status").textContent === "Cloud: saved",
    );
    const copyId = (await state()).id;
    await page
      .locator(".cloud-book")
      .filter({ hasText: "My offline draft" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.waitForSelector("#cloud-dialog", { state: "hidden" });
    p = await state();
    assert.equal(p.id, copyId);
    assert.ok(p.pages[0].blocks[0].runs.some((r) => r.fontFamily === "Roboto"));
    // Offline changes remain local and resume cloud autosave when online.
    await page.context().setOffline(true);
    await page.locator("#book-title").fill("Offline title");
    await page.waitForTimeout(2800);
    assert.match(await page.locator("#cloud-status").textContent(), /offline/);
    await page.context().setOffline(false);
    await page.waitForFunction(
      () =>
        document.getElementById("cloud-status").textContent === "Cloud: saved",
      { timeout: 10000 },
    );
    assert.equal(
      await page.evaluate(
        (id) => window.__fm.index.bookStudioProjects[id].title,
        copyId,
      ),
      "Offline title",
    );
    // Long formatted table rows and answers continue onto A4 sheets without losing text.
    p = await state();
    const fixture = JSON.parse(JSON.stringify(p));
    fixture.id = "b_pagination_test";
    fixture.pages = [
      {
        id: "b_long_page",
        blocks: [
          {
            id: "b_long_table",
            type: "table",
            rows: 1,
            cols: 2,
            cells: [
              [
                {
                  text: Array.from(
                    { length: 90 },
                    (_, i) => `Row line ${i + 1}`,
                  ).join("\n"),
                  fontFamily: "Roboto",
                  lineSpacing: 1.25,
                },
                { text: "Companion cell" },
              ],
            ],
            headerRow: false,
            w: 703,
            borderColor: "#8ba4ac",
            borderWidth: 1,
            rowHeight: 36,
            cellPadding: 8,
          },
          {
            id: "b_long_answer",
            type: "answer",
            text: "Answer",
            part: "c",
            value: Array.from(
              { length: 65 },
              (_, i) => `Answer step ${i + 1}`,
            ).join("\n"),
            showLine: false,
            lineSpacing: 2,
          },
        ],
      },
    ];
    const fixtureFile = path.join(output, "pagination.book.json");
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", fixtureFile);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    assert.ok((await page.locator(".worksheet").count()) >= 4);
    const tableText = await page
      .locator(
        '.worksheet [data-block="b_long_table"] .rich-textbox[data-cell="0,0"]',
      )
      .allTextContents();
    assert.equal(
      tableText.join(""),
      fixture.pages[0].blocks[0].cells[0][0].text,
    );
    const answerText = await page
      .locator('.worksheet [data-block="b_long_answer"] .rich-textbox')
      .allTextContents();
    assert.equal(answerText.join(""), fixture.pages[0].blocks[1].value);
    const overflow = await page
      .locator(".worksheet-content")
      .evaluateAll((nodes) =>
        nodes.some((n) => n.scrollHeight > n.clientHeight + 2),
      );
    assert.equal(overflow, false);
    await page.waitForFunction(
      () =>
        document.getElementById("cloud-status").textContent === "Cloud: saved",
      { timeout: 10000 },
    );
    assert.deepEqual(errors, []);
    console.log(
      "Editor feature acceptance passed: selected-word formatting, Enter/Shift+Enter, format shortcuts, a/b/c parts, shapes, tables, custom shortcuts, contextual AI, full cloud save/load, revision conflicts, offline recovery, formatted PDF/SVG.",
    );
  } finally {
    await page.close();
  }
};
