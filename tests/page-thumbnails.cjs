const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Thumbnail page sorter: live previews, drag and drop, buttons and keyboard.
module.exports = async function pageThumbnails(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const order = async () => (await state()).pages.map((p) => p.id);
  const card = (id) => page.locator(`[data-thumb-page="${id}"]`);
  const shown = () =>
    page
      .locator("#thumb-grid .thumb-card")
      .evaluateAll((n) => n.map((c) => c.dataset.thumbPage));
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const fixture = await state();
    fixture.id = "b_thumb_test";
    const text = (id, label, x) => ({
      id,
      type: "text",
      text: label,
      floating: true,
      x,
      y: 80,
      w: 300,
    });
    fixture.pages = [
      { id: "pa", blocks: [text("ta", "Alpha page", 20)] },
      { id: "pb", blocks: [text("tb", "Bravo page", 60)] },
      {
        id: "pc",
        blocks: [
          text("tc", "Charlie page", 100),
          {
            id: "tc_long",
            type: "text",
            text: Array.from({ length: 70 }, (_, i) => `Line ${i}`).join("\n"),
          },
        ],
      },
    ];
    const input = path.join(output, "page-thumbnails.book.json");
    fs.writeFileSync(input, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", input);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");

    await page.click("#arrange-pages");
    await page.waitForSelector("#pages-dialog[open]");
    assert.deepEqual(await shown(), ["pa", "pb", "pc"]);
    for (const [id, label] of [
      ["pa", "Alpha page"],
      ["pb", "Bravo page"],
      ["pc", "Charlie page"],
    ])
      assert.match(await card(id).locator(".thumb-frame").textContent(), new RegExp(label));
    assert.match(await card("pc").locator(".thumb-label").textContent(), /sheets/);
    assert.equal(
      await page.locator('[data-block="ta"]').count(),
      1,
      "thumbnails never duplicate the real worksheet's identifiers",
    );
    const box = await card("pa").locator(".thumb-frame").boundingBox();
    assert.ok(Math.abs(box.height / box.width - 297 / 210) < 0.02, "A4 ratio");
    await page.screenshot({ path: path.join(output, "page-thumbnails.png") });

    // Drag the last page to the front, then between others.
    const first = await card("pa").boundingBox();
    await card("pc").dragTo(card("pa"), { targetPosition: { x: 4, y: first.height / 2 } });
    assert.deepEqual(await order(), ["pc", "pa", "pb"]);
    assert.deepEqual(await shown(), ["pc", "pa", "pb"], "grid follows the new order");
    assert.match(await card("pc").locator(".thumb-label").textContent(), /Page 1/);
    const second = await card("pb").boundingBox();
    await card("pc").dragTo(card("pb"), {
      targetPosition: { x: second.width - 4, y: second.height / 2 },
    });
    assert.deepEqual(await order(), ["pa", "pb", "pc"]);

    // Buttons and keyboard.
    await card("pa").getByRole("button", { name: "Move later" }).click();
    assert.deepEqual(await order(), ["pb", "pa", "pc"]);
    assert.equal(
      await card("pb").getByRole("button", { name: "Move earlier" }).isDisabled(),
      true,
    );
    await card("pc").focus();
    await page.keyboard.press("Alt+ArrowLeft");
    assert.deepEqual(await order(), ["pb", "pc", "pa"]);
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.thumbPage),
      "pc",
      "focus follows the moved page",
    );

    // Duplicate and delete from the sorter, with undo.
    await card("pb").getByRole("button", { name: "Duplicate this page" }).click();
    assert.equal((await order()).length, 4);
    await card("pb").getByRole("button", { name: "Delete this page" }).click();
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    assert.equal((await order()).length, 3);
    assert.equal((await shown()).length, 3);

    // Selecting highlights; double-click opens the page.
    await card("pa").click();
    assert.ok(await card("pa").evaluate((n) => n.classList.contains("active")));
    await card("pc").dblclick();
    await page.waitForSelector("#pages-dialog", { state: "hidden" });
    assert.equal(await page.locator("#thumb-grid .thumb-card").count(), 0);
    assert.match(await page.locator(".page-tab.active").getAttribute("data-page-tab"), /pc/);

    // Undo restores the earlier orders.
    await page.keyboard.press("Control+Z");
    assert.equal((await order()).length, 4);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
};
