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
        : key === "title"
          ? "Math Habit title"
          : key === "number"
            ? "Math Habit number"
            : "Question text",
  );
  node.title = "Click to edit text · Drag the border to move the box";
  node.tabIndex = 0;
  node.dataset.placeholder =
    key === "value" ? "Click to type an answer" : cell ? "" : "Click to type…";
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
      runsKey: block.type === "habit" ? node.dataset.rich + "Runs" : "runs",
      cell,
    };
  }
  const textOf = (ed) => String(ed.target[ed.key] || "");
  const runsOf = (ed) => normaliseRuns(textOf(ed), ed.target[ed.runsKey]);
  function baseFormat(ed) {
    const base = { ...ed.block, ...ed.target };
    if (ed.block.type === "habit") {
      base.fontSize ||= 14;
      base.bold ??= true;
      base.color ||= "#203c44";
      if (ed.key === "number") {
        base.color = "#ffffff";
        base.bold = true;
      }
    }
    return base;
  }
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
    const start =
      editing.start + prefix.toString().replace(/\u200b/g, "").length;
    editing.range = {
      start: Math.min(start, editing.end),
      end: Math.min(
        start + range.toString().replace(/\u200b/g, "").length,
        editing.end,
      ),
    };
  }
  function restoreRange(start, end = start) {
    if (!editing) return;
    start = Math.max(editing.start, Math.min(start, editing.end));
    end = Math.max(start, Math.min(end, editing.end));
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
    range.setStart(...point(start - editing.start));
    range.setEnd(...point(end - editing.start));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editing.range = { start, end };
    editing.node.focus({ preventScroll: true });
  }
  function repaint(start, end = start) {
    editing.node.dataset.start = editing.start;
    editing.node.dataset.end = editing.end;
    paintFormat(editing.node, { ...baseFormat(editing), underline: false });
    editing.node.style.textAlign =
      editing.target.align || editing.block.align || "left";
    editing.node.style.lineHeight =
      editing.target.lineSpacing || editing.block.lineSpacing || 1.6;
    const text = textOf(editing).slice(editing.start, editing.end);
    paintRuns(
      editing.node,
      text,
      sliceRuns(runsOf(editing), editing.start, editing.end),
      baseFormat(editing),
    );
    if (!text || text.endsWith("\n")) {
      const tail = document.createElement("span");
      tail.dataset.caret = "true";
      tail.textContent = "\u200b";
      editing.node.append(tail);
    }
    restoreRange(start, end);
  }
  function start(node, { pointer = false } = {}) {
    if (!node || editing?.node === node || window.BookTouchup?.isOpen()) return;
    const data = targetFor(node);
    if (!data) return;
    // Keep both nodes alive when clicking directly from one box to another.
    finish({ render: false });
    api.select(data.block.id, false, node.closest(".worksheet").dataset.page);
    const from = Number(node.dataset.start) || 0,
      to = Math.min(Number(node.dataset.end), textOf(data).length);
    editing = {
      ...data,
      node,
      start: from,
      end: Number.isFinite(to) ? to : textOf(data).length,
      range: { start: from, end: from },
      pending: null,
    };
    node.contentEditable = "true";
    node.classList.add("editing-text");
    node.title = "Enter or Shift+Enter: new line · Escape: done";
    const sheetBlock = node.closest(".sheet-block");
    sheetBlock.classList.add("editing-block");
    node.closest(".worksheet-content").classList.add("editing-content");
    // Pointer-down runs before the browser's native caret/word/drag selection.
    // Editing a continuation preserves its offset instead of expanding the
    // entire question under the pointer and changing which word was clicked.
    if (pointer && textOf(editing).slice(from, editing.end)) {
      // Preserve the actual pointer target. Replacing its span here would
      // detach the target before native mouse-down can place the caret.
      if (
        textOf(editing).slice(from, editing.end).endsWith("\n") &&
        !node.querySelector("[data-caret]")
      ) {
        const tail = document.createElement("span");
        tail.dataset.caret = "true";
        tail.textContent = "\u200b";
        node.append(tail);
      }
      node.focus({ preventScroll: true });
    } else repaint(editing.end);
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
        ...cleanFormat(baseFormat(editing)),
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
      fontSize: b.type === "habit" ? 14 : api.project().fontSize,
      bold: b.style === "heading" || b.type === "habit",
      ...cleanFormat(b),
    };
  }
  function changed() {
    api.save();
    updateToolbar();
  }
  function shiftFragments(start, end, delta) {
    if (!delta) return;
    for (const node of document.querySelectorAll(
      `.worksheet [data-block="${editing.block.id}"] .rich-textbox`,
    )) {
      if (
        node === editing.node ||
        node.dataset.rich !== editing.key ||
        node.dataset.cell !== editing.node.dataset.cell
      )
        continue;
      const from = Number(node.dataset.start),
        to = Number(node.dataset.end);
      if (from >= end && from !== editing.start)
        node.dataset.start = from + delta;
      if (to > start || (to === start && from === start))
        node.dataset.end = to + delta;
    }
  }
  function insert(runs) {
    if (!editing) return;
    capture();
    const { start, end } = editing.range;
    api.checkpoint(editing.block.id + ":typing");
    editing.target[editing.runsKey] = replaceRuns(
      runsOf(editing),
      start,
      end,
      runs,
    );
    editing.target[editing.key] = editing.target[editing.runsKey]
      .map((r) => r.text)
      .join("");
    const length = runs.map((r) => r.text).join("").length;
    shiftFragments(start, end, length - (end - start));
    editing.end += length - (end - start);
    repaint(start + length);
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
      editing.target[editing.runsKey] = formatRuns(
        runsOf(editing),
        start,
        end,
        format,
      );
      repaint(start, end);
      changed();
    } else {
      const blocks = selectedBlocks().filter((b) =>
        ["text", "answer", "table", "habit"].includes(b.type),
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
            const text =
                b.type === "answer"
                  ? b.value
                  : b.type === "habit"
                    ? b.title
                    : b.text,
              runsKey = b.type === "habit" ? "titleRuns" : "runs";
            b[runsKey] = formatRuns(
              normaliseRuns(text, b[runsKey]),
              0,
              text.length,
              format,
            );
          }
          api.fixLayout?.(b);
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
          if (["text", "answer", "table", "habit"].includes(b.type)) {
            b.align = value;
            if (b.type === "table")
              for (const row of b.cells)
                for (const cell of row) cell.align = value;
            api.fixLayout?.(b);
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
          if (["text", "answer", "table", "habit"].includes(b.type)) {
            b.lineSpacing = value;
            if (b.type === "table")
              for (const row of b.cells)
                for (const cell of row) cell.lineSpacing = value;
            api.fixLayout?.(b);
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
        blocks.some((b) =>
          ["text", "answer", "table", "habit"].includes(b.type),
        );
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
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (window.BookTouchup?.isOpen()) return;
      const chrome = e.target.closest(".selection-frame,.selection-handle"),
        node =
          !chrome &&
          (e.target.closest(".rich-textbox") ||
            e.target
              .closest(".answer-block, .worksheet-table td")
              ?.querySelector(".rich-textbox"));
      if (
        editing &&
        !editing.node.contains(e.target) &&
        !e.target.closest("#format-toolbar")
      ) {
        finish({ render: false });
        // Reflow after the incoming click, so its target is not detached before
        // the browser or an inspector button gets to handle it.
        document.addEventListener(
          "pointerup",
          () => {
            setTimeout(() => {
              if (!editing) api.render({ inspector: false });
            }, 0);
          },
          { once: true },
        );
      }
      if (node && e.button === 0) {
        if (e.shiftKey && editing?.node !== node) {
          e.preventDefault();
          return;
        }
        if (
          node.dataset.activation === "double" &&
          e.detail < 2 &&
          editing?.node !== node
        )
          return;
        start(node, { pointer: !!e.target.closest(".rich-textbox") });
        if (!e.target.closest(".rich-textbox")) e.preventDefault();
      }
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    if (e.target.matches(".rich-textbox:not([data-activation=double])"))
      start(e.target);
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      const node = e.target.closest(".rich-textbox[data-activation=double]");
      if (node && e.button === 0 && e.detail >= 2 && !e.shiftKey) {
        api.cancelDrag?.();
        start(node, { pointer: true });
      }
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
        if (
          (e.inputType === "deleteContentBackward" &&
            range.start === editing.start) ||
          (e.inputType === "deleteContentForward" && range.end === editing.end)
        )
          return;
        if (e.inputType === "deleteContentBackward")
          range.start = Math.max(
            editing.start,
            range.start -
              (/[\uDC00-\uDFFF]/.test(textOf(editing)[range.start - 1] || "")
                ? 2
                : 1),
          );
        else
          range.end = Math.min(
            editing.end,
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
  function clipboardText(data, base = {}) {
    if (!data) return null;
    const html = data.getData("text/html");
    if (html) {
      const body = new DOMParser().parseFromString(html, "text/html").body;
      const runs = mergeRuns(
        [...body.childNodes].flatMap((n) => readDOM(n, cleanFormat(base))),
      );
      const text = runs.map((r) => r.text).join("");
      if (text.trim()) return { text, runs };
    }
    // Some applications supply an image-only HTML preview alongside the real
    // plain text. Keep the text (including spaces and line breaks) in that case.
    const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
    return text ? { text, runs: [{ text, ...cleanFormat(base) }] } : null;
  }
  document.addEventListener("input", (e) => {
    if (!editing || !editing.node.contains(e.target)) return;
    // Browser-managed IME, spellcheck and less common deletion operations.
    api.checkpoint(editing.block.id + ":typing");
    const runs = mergeRuns(
      [...editing.node.childNodes].flatMap((n) => readDOM(n)),
    );
    const oldEnd = editing.end;
    editing.target[editing.runsKey] = replaceRuns(
      runsOf(editing),
      editing.start,
      oldEnd,
      runs,
    );
    editing.target[editing.key] = editing.target[editing.runsKey]
      .map((r) => r.text)
      .join("");
    editing.end = editing.start + runs.map((r) => r.text).join("").length;
    shiftFragments(editing.start, oldEnd, editing.end - oldEnd);
    editing.node.dataset.end = editing.end;
    capture();
    changed();
  });
  document.addEventListener(
    "paste",
    (e) => {
      if (!editing || !editing.node.contains(e.target)) return;
      const content = clipboardText(e.clipboardData, currentFormat());
      if (!content) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      insert(content.runs);
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
              ["text", "answer", "table", "habit"].includes(b.type),
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
      if (!editing && !formInput && ["Enter", "F2"].includes(e.key)) {
        const b = selectedBlocks().length === 1 && selectedBlocks()[0];
        if (b && ["text", "answer", "table", "habit"].includes(b.type)) {
          e.preventDefault();
          start(
            document.querySelector(
              `.worksheet [data-block="${b.id}"] ${b.type === "habit" ? ".habit-title" : ".rich-textbox"}`,
            ),
          );
        }
        return;
      }
      if (!editing || !editing.node.contains(e.target)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        insert([{ text: "\n", ...currentFormat() }]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        const id = editing.block.id;
        finish();
        document
          .querySelector(`.worksheet [data-block="${id}"]`)
          ?.focus({ preventScroll: true });
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
    clipboardText,
    apply,
    align,
    copyFormat,
    pasteFormat,
    updateToolbar,
    isEditing: () => !!editing,
  };
}
