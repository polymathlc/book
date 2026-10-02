const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Stacked fractions: layout, plain-text editing, toggle and SVG export.
module.exports = async function fractions(browser, base, output) {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
      acceptDownloads: true,
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const box = (id) =>
    page.locator(`.worksheet [data-block="${id}"] .rich-textbox`);
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    const fixture = await state();
    fixture.id = "b_fraction_test";
    fixture.pages = [
      {
        id: "pf",
        blocks: [
          {
            id: "q",
            type: "text",
            text: "Then 2/5 of the beads were blue and 2/9 now. On 3/4/2024 or 1/2.5 km/h.",
            fontSize: 20,
            fontFamily: "Roboto",
          },
        ],
      },
    ];
    const input = path.join(output, "fractions.book.json");
    fs.writeFileSync(input, JSON.stringify(fixture));
    await page.setInputFiles("#project-input", input);
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");

    // Two stacked fractions only; the date, decimal and unit stay plain.
    assert.equal(await box("q").locator(".frac").count(), 2);
    const geometry = await box("q")
      .locator(".frac")
      .first()
      .evaluate((f) => {
        const n = f.querySelector(".frac-n").getBoundingClientRect(),
          d = f.querySelector(".frac-d").getBoundingClientRect(),
          s = f.querySelector(".frac-s").getBoundingClientRect();
        return {
          numeratorAbove: n.bottom <= d.top + 0.5,
          sameColumn: Math.abs(n.left + n.width / 2 - (d.left + d.width / 2)) < 1.5,
          slashHidden: s.width === 0 && s.height === 0,
          bar: getComputedStyle(f.querySelector(".frac-n")).borderBottomWidth,
        };
      });
    assert.equal(geometry.numeratorAbove, true);
    assert.equal(geometry.sameColumn, true);
    assert.equal(geometry.slashHidden, true);
    assert.notEqual(geometry.bar, "0px");
    // Stored and visible text remain plain "2/5".
    assert.match((await state()).pages[0].blocks[0].text, /2\/5 of/);
    assert.match(await box("q").textContent(), /Then 2\/5 of the beads/);

    // Typing a new fraction stacks it straight away and keeps the stored text.
    await box("q").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Add 1/4");
    assert.equal(await box("q").locator(".frac").count(), 3);
    assert.match((await state()).pages[0].blocks[0].text, / Add 1\/4$/);
    await page.keyboard.type(" more");
    assert.match((await state()).pages[0].blocks[0].text, / Add 1\/4 more$/);
    assert.equal(await box("q").locator(".frac").count(), 3);
    await page.keyboard.press("Escape");

    // Turning the setting off shows plain slashes; it round-trips in the project.
    await page.locator("#stack-fractions").uncheck();
    assert.equal(await box("q").locator(".frac").count(), 0);
    assert.equal((await state()).stackFractions, false);
    await page.locator("#stack-fractions").check();
    assert.equal(await box("q").locator(".frac").count(), 3);

    // SVG export draws a bar and places numerators above denominators.
    await page.waitForSelector("#export-svg:not([disabled])");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export-svg"),
    ]);
    const file = path.join(output, "fractions.svg");
    await download.saveAs(file);
    const svg = fs.readFileSync(file, "utf8");
    const bars = svg.match(/<line [^>]*stroke="rgb\(32, 60, 68\)"/g) || [];
    assert.ok(bars.length >= 3, "a fraction bar is drawn for each fraction");
    assert.doesNotMatch(svg, />2\/5</, "no plain 2/5 text is drawn");
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(
      (m) => ({ x: +m[1], y: +m[2], t: m[3] }),
    );
    const two = texts.find((t) => t.t === "2"),
      five = texts.find((t) => t.t === "5");
    assert.ok(two && five && five.y > two.y + 8, "denominator sits below numerator");
    assert.ok(Math.abs(two.x - five.x) < 12, "stacked in one column");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "fractions.png") });
  } finally {
    await page.close();
  }
};
