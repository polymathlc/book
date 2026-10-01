import test from "node:test";
import assert from "node:assert/strict";
import {
  pageContext,
  answerPrompt,
  parseAnswerResult,
  pageFingerprint,
} from "../ai-core.js";
import { blankProject, makeBlock } from "../core.js";
test("AI reads the selected part plus all page text, tables, pictures, habits and existing answers", () => {
  const project = blankProject(),
    p = project.pages[0];
  p.blocks = [
    makeBlock("text", { text: "3 boxes have 12 beads each." }),
    makeBlock("text", { part: "a", text: "How many beads altogether?" }),
    makeBlock("answer", { part: "a", value: "36 beads" }),
    makeBlock("habit", { title: "Equal groups" }),
    makeBlock("image", { name: "Bead diagram" }),
    makeBlock("table", { rows: 1, cols: 1, cells: [[{ text: "12 beads" }]] }),
  ];
  const context = pageContext(project, p, p.blocks[2].id),
    prompt = answerPrompt(context, "answers", "Show the units.");
  assert.equal(context.focusId, p.blocks[1].id);
  for (const text of [
    "3 boxes",
    "How many beads",
    "36 beads",
    "Equal groups",
    "Bead diagram",
    "12 beads",
  ])
    assert.ok(prompt.includes(text));
  assert.match(prompt, /Read ALL page text/);
  assert.match(prompt, /step-by-step arithmetic/);
  assert.match(prompt, /Show the units/);
  assert.match(prompt, /Independently check/);
});
test("AI response validation handles parts and clarification, and rejects malformed output", () => {
  const result = parseAnswerResult(
    "```json\n" +
      JSON.stringify({
        answers: [
          { part: "a", answer: "36 beads", working: "3 × 12 = 36 beads" },
        ],
        verification: "36 ÷ 3 = 12",
        warnings: [],
        habits: [],
      }) +
      "\n```",
  );
  assert.equal(result.answers[0].part, "a");
  assert.equal(result.answers[0].answer, "36 beads");
  assert.equal(
    parseAnswerResult('{"clarification":"How many boxes?"}').answers.length,
    0,
  );
  assert.throws(() => parseAnswerResult("Incomplete {"));
  assert.throws(() => parseAnswerResult("{}"));
  assert.throws(() => parseAnswerResult('{"answers":[null]}'));
});
test("question or teacher-instruction changes invalidate a generated answer", () => {
  const p = blankProject();
  p.pages[0].blocks = [makeBlock("text", { text: "4 × 6" })];
  const a = pageFingerprint(p, p.pages[0]);
  p.pages[0].blocks[0].text = "4 × 8";
  assert.notEqual(pageFingerprint(p, p.pages[0]), a);
  const b = pageFingerprint(p, p.pages[0]);
  p.aiGuidance = "Use repeated addition.";
  assert.notEqual(pageFingerprint(p, p.pages[0]), b);
});
