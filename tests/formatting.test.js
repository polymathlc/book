import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseRuns,
  formatRuns,
  replaceRuns,
  sliceRuns,
  formatAt,
  updateTextRuns,
  resizeCells,
  cleanShortcuts,
  shortcutError,
  DEFAULT_SHORTCUTS,
  shortcutFromEvent,
  splitFractions,
} from "../formatting.js";
import { blankProject, makeBlock, validateProject } from "../core.js";
test("selected text changes style without changing adjacent text or newline formatting", () => {
  const runs = normaliseRuns("Cost\n$24", [
    { text: "Cost\n", fontFamily: "Roboto", bold: true },
    { text: "$24", underline: true, color: "#ee0088" },
  ]);
  const styled = formatRuns(runs, 1, 4, { italic: true });
  assert.equal(styled.map((r) => r.text).join(""), "Cost\n$24");
  assert.equal(styled[0].italic, undefined);
  assert.equal(styled[1].text, "ost");
  assert.equal(styled[1].bold, true);
  assert.equal(styled[1].italic, true);
  assert.equal(sliceRuns(styled, 4, 5)[0].text, "\n");
  const inserted = replaceRuns(styled, 4, 4, [
    { text: "\nNext", ...formatAt(styled, 4) },
  ]);
  assert.equal(inserted.map((r) => r.text).join(""), "Cost\nNext\n$24");
  assert.ok(sliceRuns(inserted, 4, 9).every((r) => r.bold));
});
test("rich text, parts, shapes, table cells and shortcuts survive portable projects", () => {
  const p = blankProject();
  p.shortcuts.table = "Mod+Shift+7";
  p.aiGuidance = "Use step-by-step arithmetic.";
  p.pages[0].blocks = [
    makeBlock("text", {
      part: "a",
      lineSpacing: 2.2,
      text: "Find the total",
      fontFamily: "Century Gothic",
      runs: [
        { text: "Find ", bold: true },
        { text: "the total", color: "#aa0044", underline: true },
      ],
    }),
    makeBlock("answer", {
      part: "a",
      value: "$24",
      showLine: false,
      runs: [{ text: "$24", fontFamily: "Roboto", fontSize: 20 }],
    }),
    makeBlock("shape", {
      kind: "circle",
      fill: "none",
      stroke: "#332288",
      strokeWidth: 4,
      w: 100,
      height: 100,
    }),
    makeBlock("table", {
      rows: 2,
      cols: 2,
      cells: resizeCells(
        [
          [{ text: "Cost", runs: [{ text: "Cost", bold: true }] }],
          [{ text: "$24", align: "right" }],
        ],
        2,
        2,
      ),
    }),
  ];
  const q = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.id, p.id);
  assert.equal(q.pages[0].id, p.pages[0].id);
  assert.equal(q.shortcuts.table, "Mod+Shift+7");
  assert.equal(q.aiGuidance, p.aiGuidance);
  assert.equal(q.pages[0].blocks[0].fontFamily, "Century Gothic");
  assert.equal(q.pages[0].blocks[0].lineSpacing, 2.2);
  assert.equal(q.pages[0].blocks[0].runs[1].underline, true);
  assert.equal(q.pages[0].blocks[1].value, "$24");
  assert.equal(q.pages[0].blocks[1].part, "a");
  assert.equal(q.pages[0].blocks[1].showLine, false);
  assert.equal(q.pages[0].blocks[2].fill, "none");
  assert.equal(q.pages[0].blocks[3].cells[1][0].align, "right");
});
test("table resizing keeps populated cells and their formatting", () => {
  const cells = resizeCells(
    [[{ text: "Heading", bold: true }], [{ text: "25", color: "#123456" }]],
    2,
    2,
  );
  const expanded = resizeCells(cells, 4, 3);
  assert.equal(expanded[0][0].text, "Heading");
  assert.equal(expanded[0][0].bold, true);
  assert.equal(expanded[1][0].color, "#123456");
  assert.equal(expanded[3][2].text, "");
});
test("imports discard executable formatting and inconsistent runs", () => {
  const p = blankProject();
  p.pages[0].blocks = [
    makeBlock("text", {
      text: "Safe",
      fontFamily: 'Arial" onload="evil()',
      color: "url(javascript:evil)",
      runs: [{ text: "wrong", bold: true }],
    }),
    makeBlock("shape", {
      fill: '"/><script>bad</script>',
      stroke: "url(#evil)",
    }),
  ];
  const q = validateProject(p);
  assert.equal(q.pages[0].blocks[0].fontFamily, undefined);
  assert.equal(q.pages[0].blocks[0].color, undefined);
  assert.deepEqual(q.pages[0].blocks[0].runs, [{ text: "Safe" }]);
  assert.equal(q.pages[0].blocks[1].fill, "#edf6f6");
});
test("custom shortcuts reject conflicts and editing/browser shortcuts", () => {
  assert.equal(
    shortcutError({ ...DEFAULT_SHORTCUTS, table: "Mod+Shift+7" }),
    "",
  );
  assert.match(
    shortcutError({ ...DEFAULT_SHORTCUTS, table: "Mod+Alt+X" }),
    /only one/,
  );
  assert.match(
    shortcutError({ ...DEFAULT_SHORTCUTS, table: "Mod+V" }),
    /reserved/,
  );
  assert.deepEqual(cleanShortcuts({ table: "Mod+V" }), DEFAULT_SHORTCUTS);
  assert.equal(
    shortcutFromEvent({
      key: "T",
      metaKey: true,
      altKey: true,
      shiftKey: false,
    }),
    "Mod+Alt+T",
  );
});

test("plain text changes preserve styles and inherit formatting for inserted line breaks", () => {
  const runs = [
    { text: "Cost", bold: true, fontFamily: "Roboto" },
    { text: " $24", underline: true },
  ];
  const updated = updateTextRuns("Cost $24", "Cost\nNext $24", runs);
  assert.equal(updated.map((r) => r.text).join(""), "Cost\nNext $24");
  assert.ok(
    sliceRuns(updated, 4, 9).every((r) => r.bold && r.fontFamily === "Roboto"),
  );
  assert.ok(updated.at(-1).underline);
});

test("shortcut keys work with shifted digits and macOS Option characters", () => {
  assert.equal(
    shortcutFromEvent({
      key: "&",
      code: "Digit7",
      ctrlKey: true,
      shiftKey: true,
    }),
    "Mod+Shift+7",
  );
  assert.equal(
    shortcutFromEvent({ key: "†", code: "KeyT", metaKey: true, altKey: true }),
    "Mod+Alt+T",
  );
});

test("fractions are found as numerator/denominator pairs and nothing else", () => {
  const found = (text) =>
    splitFractions(text)
      .filter((p) => p.numerator)
      .map((p) => `${p.numerator}/${p.denominator}`);
  assert.deepEqual(found("2/5 of the beads and 2/9 now"), ["2/5", "2/9"]);
  assert.deepEqual(found("3 1/2 cups, then (3/4)."), ["1/2", "3/4"]);
  assert.deepEqual(found("It is 1/4."), ["1/4"]);
  assert.deepEqual(found("Date 3/4/2024 and 1/2.5 and km/h and A/B"), []);
  assert.deepEqual(found("a1/2 12/ /3"), []);
  const parts = splitFractions("Take 2/5 now");
  assert.equal(parts.map((p) => p.text).join(""), "Take 2/5 now");
  assert.deepEqual(
    validateProject({ ...blankProject(), stackFractions: false }).stackFractions,
    false,
  );
  assert.equal(validateProject(blankProject()).stackFractions, true);
});
