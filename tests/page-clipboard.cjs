const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Page order, PowerPoint-style element copy/cut/paste and full format copying.
module.exports = async function pageClipboard(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1660, height: 1250 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const pageBlocks = async (id) =>
    (await state()).pages.find((p) => p.id === id).blocks;
  const order = async () => (await state()).pages.map((p) => p.id);
  const tab = (id) => page.locator(`[data-page-tab="${id}"]`);
  const row = (id) => page.locator(`[data-list-block="${id}"]`);
  const select = async (pageId, ...ids) => {
    await tab(pageId).click();
    for (const [i, id] of ids.entries())
      await row(id).click({ modifiers: i ? ["Shift"] : [] });
  };
  // Position of an element inside the content area of its sheet, in CSS px.
  const rendered = (pageId, id) =>
    page.evaluate(
      ({ pageId, id }) => {
        const n = document.querySelector(
          `.worksheet[data-page="${pageId}"] [data-block="${id}"]`,
        );
        const c = n.parentElement.getBoundingClientRect(),
          r = n.getBoundingClientRect(),
          scale = c.width / n.parentElement.offsetWidth;
        return {
          x: (r.left - c.left) / scale,
          y: (r.top - c.top) / scale,
          w: r.width / scale,
        };
      },
      { pageId, id },
    );
  const close = (a, b, tolerance = 0.6) =>
    assert.ok(Math.abs(a - b) <= tolerance, `${a} should be near ${b}`);
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const fixture = await state();
    fixture.id = "b_clipboard_test";
    fixture.snap = false;
    const cells = [
      [{ text: "A" }, { text: "B" }],
      [{ text: "C" }, { text: "D" }],
    ];
    fixture.pages = [
      {
        id: "pa",
        blocks: [
          {
            id: "a_text",
            type: "text",
            text: "Styled question",
            fontFamily: "Georgia",
            fontSize: 28,
            color: "#21536a",
            italic: true,
            underline: true,
            align: "center",
            lineSpacing: 2.2,
            floating: true,
            x: 120,
            y: 160,
            w: 380,
          },
          {
            id: "a_flow",
            type: "text",
            text: "A flowing question that is not freely placed",
            fontFamily: "Verdana",
            fontSize: 20,
            bold: true,
          },
          {
            id: "a_shape",
            type: "shape",
            kind: "rounded",
            fill: "#ffeecc",
            stroke: "#aa3300",
            strokeWidth: 5,
            radius: 28,
            w: 200,
            height: 90,
            x: 300,
            y: 400,
            floating: true,
          },
          {
            id: "a_table",
            type: "table",
            rows: 2,
            cols: 2,
            cells,
            headerRow: false,
            borderColor: "#aa00aa",
            borderWidth: 4,
            rowHeight: 52,
            cellPadding: 14,
            fontFamily: "Tahoma",
            fontSize: 22,
            color: "#334455",
            w: 360,
          },
        ],
      },
      { id: "pb", blocks: [] },
      {
        id: "pc",
        blocks: [
          {
            id: "c_text",
            type: "text",
            text: "Plain question",
            floating: true,
            x: 40,
            y: 50,
            w: 300,
          },
          {
            id: "c_shape",
            type: "shape",
            kind: "rectangle",
            fill: "#ffffff",
            stroke: "#000000",
            strokeWidth: 1,
            radius: 0,
            w: 100,
            height: 60,
            x: 20,
            y: 300,
            floating: true,
          },
          {
            id: "c_table",
            type: "table",
            rows: 2,
            cols: 2,
            cells: [
              [{ text: "1" }, { text: "2" }],
              [{ text: "3" }, { text: "4" }],
            ],
            headerRow: true,
            borderColor: "#8ba4ac",
            borderWidth: 1,
            rowHeight: 36,
            cellPadding: 8,
            w: 300,
            floating: true,
            x: 10,
            y: 500,
          },
        ],
      },
    ];
    const input = path.join(output, "page-clipboard.book.json");
    fs.writeFileSync(input, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", input);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.selectOption("#zoom", "0.65");
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);

    // --- Page order: buttons, shortcut and drag and drop.
    await tab("pa").click();
    assert.equal(await page.locator("#page-earlier").isDisabled(), true);
    await tab("pc").click();
    assert.equal(await page.locator("#page-later").isDisabled(), true);
    await page.click("#page-earlier");
    assert.deepEqual(await order(), ["pa", "pc", "pb"]);
    assert.equal(
      await page.locator(".page-tab.active").textContent(),
      "02",
      "the moved page stays active and renumbers",
    );
    await page.click("#page-later");
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);
    await tab("pc").dragTo(tab("pa"), { targetPosition: { x: 2, y: 8 } });
    assert.deepEqual(await order(), ["pc", "pa", "pb"]);
    const last = await tab("pb").boundingBox();
    await tab("pc").dragTo(tab("pb"), {
      targetPosition: { x: last.width - 3, y: 8 },
    });
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    assert.deepEqual(await order(), ["pa", "pc", "pb"]);
    await page.keyboard.press("Alt+Shift+ArrowRight");
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);
    assert.equal(
      (await pageBlocks("pa")).length,
      4,
      "reordering keeps every element on its page",
    );
    await page.keyboard.press("Control+Z");
    assert.deepEqual(await order(), ["pa", "pc", "pb"]);
    await page.keyboard.press("Control+Y");
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);

    // --- Copy a freely placed element and paste it at the same spot elsewhere.
    await select("pa", "a_text");
    await page.keyboard.press("Control+C");
    assert.equal(
      await page.evaluate(() => window.BookStudio.hasElementClipboard()),
      true,
    );
    await tab("pb").click();
    assert.equal(await page.locator("#page-paste").isDisabled(), false);
    await page.keyboard.press("Control+V");
    let pasted = (await pageBlocks("pb"))[0];
    assert.ok(pasted && pasted.id !== "a_text");
    assert.equal(pasted.x, 120);
    assert.equal(pasted.y, 160);
    assert.equal(pasted.w, 380);
    for (const key of [
      "text",
      "fontFamily",
      "fontSize",
      "color",
      "italic",
      "underline",
      "align",
      "lineSpacing",
      "floating",
    ])
      assert.equal(pasted[key], (await pageBlocks("pa"))[0][key], key);
    const original = await rendered("pa", "a_text"),
      copy = await rendered("pb", pasted.id);
    close(copy.x, original.x);
    close(copy.y, original.y);
    close(copy.w, original.w);
    assert.equal(
      (await pageBlocks("pa")).length,
      4,
      "copying leaves the original in place",
    );

    // --- A flowing element is measured and pasted at its exact visible spot.
    const flowSpot = await rendered("pa", "a_flow");
    await select("pa", "a_flow");
    await page.keyboard.press("Control+C");
    await tab("pc").click();
    await page.keyboard.press("Control+V");
    const flowCopy = (await pageBlocks("pc")).at(-1);
    assert.equal(flowCopy.floating, true);
    assert.equal(flowCopy.fontFamily, "Verdana");
    assert.equal(flowCopy.bold, true);
    close(flowCopy.x, flowSpot.x);
    close(flowCopy.y, flowSpot.y);
    const flowShown = await rendered("pc", flowCopy.id);
    close(flowShown.x, flowSpot.x);
    close(flowShown.y, flowSpot.y);

    // --- Several elements keep their positions relative to one another.
    await select("pa", "a_text", "a_shape");
    await page.keyboard.press("Control+C");
    await tab("pb").click();
    await page.keyboard.press("Control+V");
    const group = (await pageBlocks("pb")).slice(-2);
    assert.deepEqual(
      group.map((b) => [b.x, b.y, b.type]),
      [
        [120, 160, "text"],
        [300, 400, "shape"],
      ],
    );
    assert.equal(group[1].fill, "#ffeecc");
    assert.equal(group[1].strokeWidth, 5);
    assert.equal(group[1].radius, 28);

    // --- Pasting onto the source page offsets, like PowerPoint.
    await select("pa", "a_text");
    await page.keyboard.press("Control+C");
    await page.keyboard.press("Control+V");
    let again = (await pageBlocks("pa")).at(-1);
    assert.equal(again.x, 120 + 16);
    assert.equal(again.y, 160 + 16);
    await page.keyboard.press("Control+V");
    again = (await pageBlocks("pa")).at(-1);
    assert.equal(again.x, 120 + 32);

    // --- Cut moves an element, keeping its exact position.
    await select("pc", "c_text");
    await page.keyboard.press("Control+X");
    assert.equal(
      (await pageBlocks("pc")).some((b) => b.id === "c_text"),
      false,
    );
    await tab("pb").click();
    await page.click("#page-paste");
    const moved = (await pageBlocks("pb")).at(-1);
    assert.equal(moved.text, "Plain question");
    assert.equal(moved.x, 40);
    assert.equal(moved.y, 50);
    await page.keyboard.press("Control+Z");
    assert.equal((await pageBlocks("pb")).at(-1).text !== "Plain question", true);

    // --- Context menu and inspector paths.
    await tab("pa").click();
    await page
      .locator('.worksheet[data-page="pa"] [data-block="a_shape"]')
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
    await tab("pc").click();
    const before = (await pageBlocks("pc")).length;
    await page
      .locator('.worksheet[data-page="pc"] [data-block="c_shape"]')
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Paste on this page", exact: true })
      .click();
    const viaMenu = (await pageBlocks("pc")).at(-1);
    assert.equal((await pageBlocks("pc")).length, before + 1);
    assert.equal(viaMenu.x, 300);
    assert.equal(viaMenu.y, 400);

    // --- Elements from another tab arrive through the system clipboard payload.
    const payload = await page.evaluate(() => {
      const data = new DataTransfer();
      const b = window.BookStudio.getProject().pages[0].blocks[0];
      data.setData("text/plain", "Polymath Book Studio elements foreign");
      data.setData(
        "application/x-book-studio-elements",
        JSON.stringify({ token: "foreign", blocks: [b] }),
      );
      document.body.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    });
    assert.equal(payload, true);
    assert.equal((await pageBlocks("pc")).at(-1).text, "Styled question");
    assert.equal((await pageBlocks("pc")).at(-1).fontFamily, "Georgia");

    // --- Formatting: font, size, colour, style, alignment and spacing.
    await select("pa", "a_text");
    await page.keyboard.press("Control+Shift+C");
    await select("pc", "c_shape");
    await page.keyboard.press("Control+Shift+V");
    assert.equal(
      (await pageBlocks("pc")).find((b) => b.id === "c_shape").fill,
      "#ffffff",
      "text format does not alter a shape",
    );
    await row(flowCopy.id).click();
    await page.keyboard.press("Control+Shift+V");
    const styled = (await pageBlocks("pc")).find((b) => b.id === flowCopy.id);
    assert.equal(styled.fontFamily, "Georgia");
    assert.equal(styled.fontSize, 28);
    assert.equal(styled.color, "#21536a");
    assert.equal(styled.italic, true);
    assert.equal(styled.underline, true);
    assert.equal(styled.bold, false);
    assert.equal(styled.align, "center");
    assert.equal(styled.lineSpacing, 2.2);
    for (const run of styled.runs || [])
      assert.equal(run.fontFamily, "Georgia");

    // Shape formatting.
    await select("pa", "a_shape");
    await page.keyboard.press("Control+Shift+C");
    await select("pc", "c_shape");
    await page.keyboard.press("Control+Shift+V");
    const shape = (await pageBlocks("pc")).find((b) => b.id === "c_shape");
    assert.equal(shape.fill, "#ffeecc");
    assert.equal(shape.stroke, "#aa3300");
    assert.equal(shape.strokeWidth, 5);
    assert.equal(shape.radius, 28);
    assert.equal(shape.w, 100, "pasting format never resizes a shape");

    // Table formatting: lines, padding, row height and the text style.
    await select("pa", "a_table");
    await page.keyboard.press("Control+Shift+C");
    await select("pc", "c_table");
    await page.keyboard.press("Control+Shift+V");
    const table = (await pageBlocks("pc")).find((b) => b.id === "c_table");
    assert.equal(table.borderColor, "#aa00aa");
    assert.equal(table.borderWidth, 4);
    assert.equal(table.rowHeight, 52);
    assert.equal(table.cellPadding, 14);
    assert.equal(table.headerRow, false);
    assert.equal(table.fontFamily, "Tahoma");
    assert.equal(table.fontSize, 22);
    assert.equal(table.cells[1][1].fontFamily, "Tahoma");
    assert.equal(table.cells[1][1].text, "4", "cell text is untouched");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "page-clipboard.png") });
  } finally {
    await page.close();
  }
};
