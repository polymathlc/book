import {
  FONTS,
  fontStack,
  cleanFormat,
  normaliseRuns,
  mergeRuns,
  sliceRuns,
  formatRuns,
  replaceRuns,
  formatAt,
  validColour,
} from "./formatting.js";

export function paintFormat(node, format = {}) {
  if (format.fontFamily) node.style.fontFamily = fontStack(format.fontFamily);
  if (format.fontSize) node.style.fontSize = format.fontSize + "px";
  if (format.color) node.style.color = format.color;
  if (typeof format.bold === "boolean")
    node.style.fontWeight = format.bold ? "700" : "400";
  if (typeof format.italic === "boolean")
    node.style.fontStyle = format.italic ? "italic" : "normal";
  if (typeof format.underline === "boolean")
    node.style.textDecoration = format.underline ? "underline" : "none";
}
export function paintRuns(node, text, runs, base = {}) {
  node.replaceChildren();
  for (const run of normaliseRuns(text, runs)) {
    const span = document.createElement("span");
    span.textContent = run.text;
    paintFormat(span, { ...base, ...run });
    node.append(span);
  }
}
export function richBox(
  block,
  text,
  runs,
  { key = "text", cell, start = 0, end } = {},
) {
  const node = document.createElement("div");
  node.className = "rich-textbox";
  node.dataset.rich = key;
  if (cell) node.dataset.cell = cell.join(",");
  node.dataset.start = start;
  node.dataset.end = end ?? String(text).length + start;
  node.setAttribute("role", "textbox");
  node.setAttribute("aria-multiline", "true");
  node.setAttribute(
    "aria-label",
    cell
      ? `Table cell ${cell[0] + 1}, ${cell[1] + 1}`
      : key === "value"
        ? "Answer text"
        : "Question text",
  );
  node.title = "Double-click to edit text";
  node.dataset.placeholder =
    key === "value"
      ? "Double-click to type an answer"
      : cell
        ? ""
        : "Double-click to type…";
  paintFormat(node, { ...block, underline: false });
  node.style.textAlign = block.align || "left";
  node.style.lineHeight = block.lineSpacing || 1.6;
  paintRuns(node, text, runs, block);
  return node;
}

// All edits are applied to structured runs, keeping newline and character style.
export function createRichEditor(api) {
  const $ = (id) => document.getElementById(id);
  let editing = null,
    formatClipboard = null;
  const selectedBlocks = () => api.selected().map(api.block).filter(Boolean);
  function targetFor(node) {
    const block = api.block(node.closest("[data-block]")?.dataset.block);
    if (!block) return null;
    const cell = node.dataset.cell?.split(",").map(Number);
    return {
      block,
      target: cell ? block.cells[cell[0]][cell[1]] : block,
      key: node.dataset.rich,
      cell,
    };
  }
  const textOf = (ed) => String(ed.target[ed.key] || "");
  const runsOf = (ed) => normaliseRuns(textOf(ed), ed.target.runs);
  function textNodes(root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode())
      if (!walk.currentNode.parentElement.closest("[data-caret]"))
        nodes.push(walk.currentNode);
    return nodes;
  }
  function capture() {
    if (!editing) return;
    const selection = getSelection();
    if (
      !selection.rangeCount ||
      !editing.node.contains(selection.anchorNode) ||
      !editing.node.contains(selection.focusNode)
    )
      return;
    const range = selection.getRangeAt(0);
    const prefix = document.createRange();
    prefix.selectNodeContents(editing.node);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().replace(/\u200b/g, "").length;
    editing.range = {
      start: Math.min(start, textOf(editing).length),
      end: Math.min(
        start + range.toString().replace(/\u200b/g, "").length,
        textOf(editing).length,
      ),
    };
  }
  function restoreRange(start, end = start) {
    if (!editing) return;
    const nodes = textNodes(editing.node),
      range = document.createRange();
    function point(position) {
      let offset = 0;
      for (const node of nodes) {
        if (position <= offset + node.length) return [node, position - offset];
        offset += node.length;
      }
      const tail = editing.node.querySelector("[data-caret]")?.firstChild;
      return tail ? [tail, 0] : [editing.node, editing.node.childNodes.length];
    }
    range.setStart(...point(start));
    range.setEnd(...point(end));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editing.range = { start, end };
    editing.node.focus({ preventScroll: true });
  }
  function repaint(start, end = start) {
    paintFormat(editing.node, {
      ...editing.block,
      ...editing.target,
      underline: false,
    });
    editing.node.style.textAlign =
      editing.target.align || editing.block.align || "left";
    paintRuns(editing.node, textOf(editing), editing.target.runs, {
      ...editing.block,
      ...editing.target,
    });
    if (!textOf(editing) || textOf(editing).endsWith("\n")) {
      const tail = document.createElement("span");
      tail.dataset.caret = "true";
      tail.textContent = "\u200b";
      editing.node.append(tail);
    }
    restoreRange(start, end);
  }
  function start(node) {
    if (!node || editing?.node === node || window.BookTouchup?.isOpen()) return;
    finish();
    // A split text block is edited as one complete box, then repaginated on Done.
    const data = targetFor(node);
    if (!data) return;
    api.select(data.block.id);
    editing = { ...data, node, range: { start: 0, end: 0 }, pending: null };
    node.contentEditable = "true";
    node.classList.add("editing-text");
    node.title = "Enter or Shift+Enter: new line · Escape: done";
    const sheetBlock = node.closest(".sheet-block");
    sheetBlock.classList.add("editing-block");
    node.closest(".worksheet-content").classList.add("editing-content");
    repaint(textOf(editing).length);
    updateToolbar();
  }
  function finish({ render = true } = {}) {
    if (!editing) return;
    const old = editing;
    editing = null;
    old.node.contentEditable = "false";
    old.node.classList.remove("editing-text");
    old.node.closest(".sheet-block")?.classList.remove("editing-block");
    old.node.closest(".worksheet-content")?.classList.remove("editing-content");
    api.fixLayout?.(old.block);
    api.save();
    if (render) api.render();
    updateToolbar();
  }
  function currentFormat() {
    if (editing) {
      const base = {
        ...cleanFormat(editing.block),
        ...cleanFormat(editing.target),
      };
      if (!base.fontSize) base.fontSize = api.project().fontSize;
      if (base.bold === undefined)
        base.bold =
          editing.block.style === "heading" ||
          !!(editing.cell && editing.cell[0] === 0 && editing.block.headerRow);
      return {
        ...formatAt(
          runsOf(editing),
          editing.range.start +
            (editing.range.end > editing.range.start ? 1 : 0),
          base,
        ),
        ...(editing.range.start === editing.range.end ? editing.pending : {}),
      };
    }
    const b = selectedBlocks()[0] || {};
    return {
      fontSize: api.project().fontSize,
      bold: b.style === "heading",
      ...cleanFormat(b),
    };
  }
  function changed() {
    api.save();
    updateToolbar();
  }
  function insert(runs) {
    if (!editing) return;
    capture();
    const { start, end } = editing.range;
    api.checkpoint(editing.block.id + ":typing");
    editing.target.runs = replaceRuns(runsOf(editing), start, end, runs);
    editing.target[editing.key] = editing.target.runs
      .map((r) => r.text)
      .join("");
    repaint(start + runs.map((r) => r.text).join("").length);
    changed();
  }
  function apply(format) {
    format = cleanFormat(format);
    if (editing) {
      capture();
      const { start, end } = editing.range;
      if (start === end) {
        editing.pending = { ...currentFormat(), ...format };
        updateToolbar();
        restoreRange(start);
        return;
      }
      api.checkpoint();
      editing.target.runs = formatRuns(runsOf(editing), start, end, format);
      repaint(start, end);
      changed();
    } else {
      const blocks = selectedBlocks().filter((b) =>
        ["text", "answer", "table"].includes(b.type),
      );
      if (!blocks.length) return;
      api.mutate(() => {
        for (const b of blocks) {
          Object.assign(b, format);
          if (b.type === "table")
            for (const row of b.cells)
              for (const cell of row) {
                Object.assign(cell, format);
                cell.runs = formatRuns(
                  normaliseRuns(cell.text, cell.runs),
                  0,
                  cell.text.length,
                  format,
                );
              }
          else {
            const text = b.type === "answer" ? b.value : b.text;
            b.runs = formatRuns(
              normaliseRuns(text, b.runs),
              0,
              text.length,
              format,
            );
          }
        }
      });
    }
    updateToolbar();
  }
  function align(value) {
    if (editing) {
      capture();
      api.checkpoint();
      editing.target.align = value;
      editing.node.style.textAlign = value;
      changed();
      restoreRange(editing.range.start, editing.range.end);
    } else
      api.mutate(() => {
        for (const b of selectedBlocks())
          if (["text", "answer", "table"].includes(b.type)) {
            b.align = value;
            if (b.type === "table")
              for (const row of b.cells)
                for (const cell of row) cell.align = value;
          }
      });
    updateToolbar();
  }
  function spacing(value) {
    value = Math.max(0.8, Math.min(4, Number(value) || 1.6));
    if (editing) {
      capture();
      api.checkpoint();
      editing.target.lineSpacing = value;
      editing.node.style.lineHeight = value;
      changed();
      restoreRange(editing.range.start, editing.range.end);
    } else
      api.mutate(() => {
        for (const b of selectedBlocks())
          if (["text", "answer", "table"].includes(b.type)) {
            b.lineSpacing = value;
            if (b.type === "table")
              for (const row of b.cells)
                for (const cell of row) cell.lineSpacing = value;
          }
      });
    updateToolbar();
  }
  function copyFormat() {
    capture();
    const b = selectedBlocks()[0];
    if (!b) return;
    if (b.type === "shape")
      formatClipboard = {
        kind: "shape",
        fill: b.fill,
        stroke: b.stroke,
        strokeWidth: b.strokeWidth,
        radius: b.radius,
      };
    else
      formatClipboard = {
        kind: "text",
        lineSpacing: editing?.target.lineSpacing || b.lineSpacing || 1.6,
        ...currentFormat(),
        align: editing?.target.align || b.align || "left",
      };
    api.toast(
      "Formatting copied. Select text or an element, then paste format.",
    );
    updateToolbar();
  }
  function pasteFormat() {
    if (!formatClipboard) {
      api.toast("Copy formatting first.");
      return;
    }
    if (formatClipboard.kind === "shape")
      api.mutate(() => {
        for (const b of selectedBlocks())
          if (b.type === "shape")
            for (const key of ["fill", "stroke", "strokeWidth", "radius"])
              b[key] = formatClipboard[key];
      });
    else {
      apply(formatClipboard);
      align(formatClipboard.align);
      spacing(formatClipboard.lineSpacing);
    }
  }
  function updateToolbar() {
    const blocks = selectedBlocks(),
      enabled =
        !!editing ||
        blocks.some((b) => ["text", "answer", "table"].includes(b.type));
    const format = currentFormat();
    for (const node of $("format-toolbar").querySelectorAll(
      "select,input,button[data-text-align],#format-bold,#format-italic,#format-underline",
    ))
      node.disabled = !enabled;
    $("text-font").value = format.fontFamily || "Arial";
    if (document.activeElement !== $("text-size"))
      $("text-size").value = +(format.fontSize * 0.75).toFixed(2);
    $("text-colour").value = validColour(format.color);
    if (document.activeElement !== $("text-spacing"))
      $("text-spacing").value =
        editing?.target.lineSpacing || blocks[0]?.lineSpacing || 1.6;
    for (const key of ["bold", "italic", "underline"])
      $("format-" + key).setAttribute("aria-pressed", String(!!format[key]));
    for (const node of document.querySelectorAll("[data-text-align]"))
      node.setAttribute(
        "aria-pressed",
        String(
          node.dataset.textAlign ===
            (editing?.target.align || blocks[0]?.align || "left"),
        ),
      );
    $("copy-format").disabled = !blocks.length;
    $("paste-format").disabled = !blocks.length || !formatClipboard;
    $("finish-text").hidden = !editing;
  }
  for (const font of FONTS) {
    const option = document.createElement("option");
    option.value = option.textContent = font;
    option.style.fontFamily = fontStack(font);
    $("text-font").append(option);
  }
  $("text-font").onchange = (e) => apply({ fontFamily: e.target.value });
  $("text-size").onchange = (e) =>
    apply({
      fontSize: Math.max(
        8,
        Math.min(128, (Number(e.target.value) * 4) / 3 || 16),
      ),
    });
  $("text-colour").oninput = (e) => apply({ color: e.target.value });
  $("text-spacing").onchange = (e) => spacing(e.target.value);
  for (const key of ["bold", "italic", "underline"])
    $("format-" + key).onclick = () => apply({ [key]: !currentFormat()[key] });
  for (const node of document.querySelectorAll("[data-text-align]"))
    node.onclick = () => align(node.dataset.textAlign);
  $("copy-format").onclick = copyFormat;
  $("paste-format").onclick = pasteFormat;
  $("finish-text").onclick = () => finish();
  $("format-toolbar").addEventListener("pointerdown", (e) => {
    capture();
    if (e.target.closest("button")) e.preventDefault();
  });
  document.addEventListener("selectionchange", () => {
    if (editing) {
      const previous = editing.range;
      capture();
      if (
        previous.start !== editing.range.start ||
        previous.end !== editing.range.end
      )
        editing.pending = null;
      updateToolbar();
    }
  });
  document.addEventListener("dblclick", (e) => {
    const node =
      e.target.closest(".rich-textbox") ||
      e.target.closest(".answer-block")?.querySelector(".rich-textbox");
    if (node) {
      e.preventDefault();
      start(node);
    }
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        editing &&
        !editing.node.contains(e.target) &&
        !e.target.closest("#format-toolbar")
      )
        finish();
    },
    true,
  );
  document.addEventListener("beforeinput", (e) => {
    if (!editing || !editing.node.contains(e.target) || e.isComposing) return;
    capture();
    if (["insertText", "insertReplacementText"].includes(e.inputType)) {
      e.preventDefault();
      insert([{ text: e.data || "", ...currentFormat() }]);
    } else if (["insertParagraph", "insertLineBreak"].includes(e.inputType)) {
      e.preventDefault();
      insert([{ text: "\n", ...currentFormat() }]);
    } else if (
      ["deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(
        e.inputType,
      )
    ) {
      e.preventDefault();
      const range = editing.range;
      if (range.start === range.end && e.inputType !== "deleteByCut") {
        if (e.inputType === "deleteContentBackward")
          range.start = Math.max(
            0,
            range.start -
              (/[\uDC00-\uDFFF]/.test(textOf(editing)[range.start - 1] || "")
                ? 2
                : 1),
          );
        else
          range.end = Math.min(
            textOf(editing).length,
            range.end +
              (/[\uD800-\uDBFF]/.test(textOf(editing)[range.end] || "")
                ? 2
                : 1),
          );
      }
      // insert() captures the DOM range, so restore the expanded deletion first.
      restoreRange(range.start, range.end);
      insert([]);
    }
  });
  function readDOM(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE)
      return [{ text: node.textContent, ...inherited }];
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      node.matches("script,style,iframe,object,[data-caret]")
    )
      return [];
    if (node.tagName === "BR") return [{ text: "\n", ...inherited }];
    const format = { ...inherited };
    if (["B", "STRONG"].includes(node.tagName)) format.bold = true;
    if (["I", "EM"].includes(node.tagName)) format.italic = true;
    if (node.tagName === "U") format.underline = true;
    const s = node.style;
    if (s.fontWeight)
      format.bold = s.fontWeight === "bold" || Number(s.fontWeight) >= 600;
    if (s.fontStyle) format.italic = s.fontStyle === "italic";
    if (s.textDecoration.includes("underline")) format.underline = true;
    const family = s.fontFamily?.replace(/["']/g, "").split(",")[0].trim();
    if (FONTS.includes(family)) format.fontFamily = family;
    if (s.fontSize && /(?:px|pt)$/.test(s.fontSize))
      format.fontSize =
        parseFloat(s.fontSize) * (s.fontSize.endsWith("pt") ? 4 / 3 : 1);
    if (s.color) {
      const rgb = s.color.match(/\d+/g);
      if (rgb?.length >= 3)
        format.color =
          "#" +
          rgb
            .slice(0, 3)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("");
      else if (/^#[\da-f]{6}$/i.test(s.color)) format.color = s.color;
    }
    let runs = [...node.childNodes].flatMap((child) =>
      readDOM(child, cleanFormat(format)),
    );
    if (
      ["DIV", "P", "LI", "TR"].includes(node.tagName) &&
      runs.length &&
      node.nextSibling
    )
      runs.push({ text: "\n", ...format });
    return runs;
  }
  document.addEventListener("input", (e) => {
    if (!editing || !editing.node.contains(e.target)) return;
    // Browser-managed IME, spellcheck and less common deletion operations.
    capture();
    api.checkpoint(editing.block.id + ":typing");
    const runs = mergeRuns(
      [...editing.node.childNodes].flatMap((n) => readDOM(n)),
    );
    editing.target.runs = runs;
    editing.target[editing.key] = runs.map((r) => r.text).join("");
    changed();
  });
  document.addEventListener(
    "paste",
    (e) => {
      if (
        !editing ||
        !editing.node.contains(e.target) ||
        e.clipboardData.files.length
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const html = e.clipboardData.getData("text/html");
      if (html) {
        const body = new DOMParser().parseFromString(html, "text/html").body;
        insert(
          mergeRuns(
            [...body.childNodes].flatMap((n) => readDOM(n, currentFormat())),
          ),
        );
      } else
        insert([
          { text: e.clipboardData.getData("text/plain"), ...currentFormat() },
        ]);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (window.BookTouchup?.isOpen() || e.target.closest("dialog")) return;
      const mod = e.ctrlKey || e.metaKey,
        key = e.key.toLowerCase();
      const formInput = e.target.closest("input,textarea,select");
      if (mod && !e.altKey && !formInput) {
        if (e.shiftKey && key === "c") {
          e.preventDefault();
          copyFormat();
          return;
        }
        if (e.shiftKey && key === "v") {
          e.preventDefault();
          pasteFormat();
          return;
        }
        if (
          !e.shiftKey &&
          ["b", "i", "u"].includes(key) &&
          (editing ||
            selectedBlocks().some((b) =>
              ["text", "answer", "table"].includes(b.type),
            ))
        ) {
          e.preventDefault();
          const k = { b: "bold", i: "italic", u: "underline" }[key];
          apply({ [k]: !currentFormat()[k] });
          return;
        }
        if (!e.shiftKey && ["l", "e", "r", "j"].includes(key) && editing) {
          e.preventDefault();
          align({ l: "left", e: "center", r: "right", j: "justify" }[key]);
          return;
        }
      }
      if (!editing || !editing.node.contains(e.target)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        insert([{ text: "\n", ...currentFormat() }]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (mod && ["z", "y"].includes(key)) {
        e.preventDefault();
        finish();
        key === "y" || e.shiftKey ? api.redo() : api.undo();
      } else if (e.key === "Tab" && editing.cell) {
        e.preventDefault();
        const b = editing.block,
          index =
            editing.cell[0] * b.cols + editing.cell[1] + (e.shiftKey ? -1 : 1);
        finish();
        if (index >= 0 && index < b.rows * b.cols)
          start(
            document.querySelector(
              `.sheet-block[data-block="${b.id}"] .rich-textbox[data-cell="${Math.floor(index / b.cols)},${index % b.cols}"]`,
            ),
          );
      }
    },
    true,
  );
  return {
    start,
    finish,
    apply,
    align,
    copyFormat,
    pasteFormat,
    updateToolbar,
    isEditing: () => !!editing,
  };
}
