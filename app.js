import {
  PX_PER_MM,
  PAGE_W,
  PAGE_H,
  CONTENT_W,
  CONTENT_H,
  uid,
  clamp,
  clone,
  blankProject,
  makeBlock,
  validateProject,
  validateSvg,
  wrapText,
  snapPosition,
  dotDiagram,
  escapeXml,
  buildPdf,
} from "./core.js";
const $ = (id) => document.getElementById(id),
  el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
let project = blankProject(),
  activePage = project.pages[0].id,
  selected = [],
  zoom = 1,
  history = [],
  future = [],
  drag = null,
  typingGroup = null,
  saveTimer,
  db,
  renderedSheets = [],
  contextTarget = null;
const labelOf = (b) =>
  ({
    text: (b.text || "").slice(0, 55) || "Text",
    habit: b.title || "Math Habit",
    image: b.name || "Image",
    working: "Working space",
    answer: b.text,
    divider: "Divider",
  })[b.type];
const pageOf = (id) =>
  project.pages.find((p) => p.blocks.some((b) => b.id === id));
const blockOf = (id) => pageOf(id)?.blocks.find((b) => b.id === id);
const currentPage = () =>
  project.pages.find((p) => p.id === activePage) || project.pages[0];
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").style.display = "none"), 4200);
}
window.addEventListener("book-toast", (e) => toast(e.detail));
function snapshot() {
  return { project: clone(project), activePage, selected: [...selected] };
}
function checkpoint(group = null) {
  if (group && typingGroup === group) return;
  history.push(snapshot());
  if (history.length > 40) history.shift();
  future = [];
  typingGroup = group;
}
function finishChange({ inspector = true } = {}) {
  render({ inspector });
  scheduleSave();
}
function mutate(fn) {
  checkpoint();
  fn();
  finishChange();
}
function restore(s) {
  project = s.project;
  activePage = s.activePage;
  selected = s.selected.filter((id) => blockOf(id));
  syncSettings();
  finishChange();
}
function undo() {
  if (!history.length) return;
  future.push(snapshot());
  const s = history.pop();
  typingGroup = null;
  restore(s);
}
function redo() {
  if (!future.length) return;
  history.push(snapshot());
  const s = future.pop();
  typingGroup = null;
  restore(s);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  $("save-status").textContent = "Saving…";
  saveTimer = setTimeout(saveDraft, 500);
}
async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("polymath-book-studio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("drafts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveDraft() {
  try {
    if (!db) db = await openDb();
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put(clone(project), "current");
    await new Promise((r, j) => {
      tx.oncomplete = r;
      tx.onerror = () => j(tx.error);
      tx.onabort = () => j(tx.error);
    });
    $("save-status").textContent = "Draft saved on this device";
  } catch (e) {
    $("save-status").textContent = "Save project to keep your work";
    toast(
      "Your browser could not save this draft. Use Save project to keep your images and layout.",
    );
  }
}
async function loadDraft() {
  try {
    db = await openDb();
    const value = await new Promise((r, j) => {
      const q = db.transaction("drafts").objectStore("drafts").get("current");
      q.onsuccess = () => r(q.result);
      q.onerror = () => j(q.error);
    });
    if (value) {
      project = validateProject(value);
      activePage = project.pages[0].id;
    }
  } catch {}
}
function syncSettings() {
  for (const [id, key] of [
    ["book-title", "title"],
    ["level", "level"],
    ["subject", "subject"],
    ["page-number", "firstPage"],
    ["font-size", "fontSize"],
  ])
    $(id).value = project[key];
  $("snap-grid").checked = project.snap;
}
function select(id, extend = false) {
  typingGroup = null;
  if (!id) selected = [];
  else if (extend)
    selected = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
  else selected = [id];
  if (id) activePage = pageOf(id).id;
  render({ sheets: false });
  applySelection();
}
function applySelection() {
  document.body.classList.toggle("has-selection", selected.length > 0);
  document
    .querySelectorAll("[data-block]")
    .forEach((n) =>
      n.classList.toggle("selected", selected.includes(n.dataset.block)),
    );
  document.querySelectorAll(".selection-handle").forEach((n) => n.remove());
  for (const id of selected) {
    const b = blockOf(id);
    if (!b || !b.floating || b.locked) continue;
    const n = document.querySelector(`.sheet-block[data-block="${id}"]`);
    if (n)
      for (const corner of ["nw", "ne", "sw", "se"]) {
        const h = el("span", "selection-handle " + corner);
        h.dataset.corner = corner;
        h.setAttribute("aria-hidden", "true");
        n.append(h);
      }
  }
}
function createBlock(b, fragment = null) {
  const n = el("div", `sheet-block ${b.type}-block`);
  n.dataset.block = b.id;
  n.dataset.type = b.type;
  n.tabIndex = 0;
  n.setAttribute("aria-label", `${b.type}: ${labelOf(b)}`);
  if (b.type === "text") {
    n.classList.add(b.style || "body");
    n.style.textAlign = b.align || "left";
    n.textContent = fragment ?? b.text;
  }
  if (b.type === "habit") {
    n.append(
      el("span", "habit-number", b.number),
      el("span", "habit-label", "MATH HABIT"),
      el("span", "habit-title", b.title),
    );
  }
  if (b.type === "image") {
    const img = el("img");
    img.src = b.src;
    img.alt = b.caption || b.name || "Question image";
    img.draggable = false;
    img.style.width = "100%";
    img.style.height = `${(b.w * b.naturalHeight) / b.naturalWidth}px`;
    n.append(img);
    n.style.width = `${b.w}px`;
    if (b.caption) n.append(el("div", "image-caption", b.caption));
  }
  if (b.type === "working") {
    n.style.height = `${b.height}px`;
    const l = el("div", "working-label");
    l.append(
      el("span", "", b.label || "SHOW YOUR WORKING"),
      el("span", "working-rule"),
    );
    n.append(l);
    if (b.ruled)
      for (let i = 0; i < Math.floor((b.height - 20) / 26); i++)
        n.append(el("div", "ruled-line"));
  }
  if (b.type === "answer") {
    n.append(el("span", "", b.text || "Answer"), el("span", "answer-line"));
  }
  if (b.type === "divider") n.append(el("span", "divider-line"));
  if (b.floating) {
    n.classList.add("floating");
    n.style.left = `${b.x}px`;
    n.style.top = `${b.y}px`;
    n.style.width = `${b.w || 300}px`;
    n.style.zIndex = String(
      10 + Math.max(0, pageOf(b.id)?.blocks.indexOf(b) ?? 0),
    );
  }
  if (b.rotation) n.style.transform = `rotate(${b.rotation}deg)`;
  if (b.locked) n.classList.add("locked");
  return n;
}
const measureBox = el("div", "worksheet-content measure-box");
measureBox.style.width = CONTENT_W + "px";
document.body.append(measureBox);
function heightOf(b, fragment) {
  const n = createBlock(b, fragment);
  if (b.floating) {
    n.classList.remove("floating");
    n.style.position = "relative";
  }
  measureBox.replaceChildren(n);
  return n.offsetHeight;
}
function textFragments(b) {
  const size = project.fontSize,
    ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${b.style === "heading" ? "700" : "400"} ${size}px Arial`;
  const w = CONTENT_W - (b.style === "prompt" ? 16 : 0);
  const lines = wrapText(b.text, w, (t) => ctx.measureText(t).width);
  const max = Math.floor((CONTENT_H - 4) / (size * 1.6));
  if (lines.length <= max) return [null];
  const out = [];
  for (let i = 0; i < lines.length; i += max)
    out.push(lines.slice(i, i + max).join("\n"));
  return out;
}
function paginate() {
  measureBox.style.fontSize = project.fontSize + "px";
  const pages = [];
  for (const page of project.pages) {
    let sheet = { pageId: page.id, items: [] },
      height = 0;
    pages.push(sheet);
    for (const b of page.blocks.filter((b) => !b.floating)) {
      for (const fragment of b.type === "text" ? textFragments(b) : [null]) {
        let h = heightOf(b, fragment);
        if (h > CONTENT_H && b.type === "image") {
          // fit its display frame, preserve the source image
          const captionHeight = h - (b.w * b.naturalHeight) / b.naturalWidth;
          b.w = Math.min(
            b.w,
            (Math.max(1, CONTENT_H - captionHeight) * b.naturalWidth) /
              b.naturalHeight,
          );
          h = heightOf(b, fragment);
        }
        if (height && height + h + 14 > CONTENT_H) {
          sheet = { pageId: page.id, items: [] };
          pages.push(sheet);
          height = 0;
        }
        sheet.items.push({ block: b, fragment });
        height += (height ? 14 : 0) + h;
      }
    }
    const floats = page.blocks.filter((b) => b.floating);
    pages
      .find((s) => s.pageId === page.id)
      .items.push(...floats.map((b) => ({ block: b, fragment: null })));
  }
  measureBox.replaceChildren();
  return pages;
}
function updateZoom() {
  const width = $("preview-scroll").clientWidth - 56;
  zoom =
    $("zoom").value === "fit"
      ? clamp(width / PAGE_W, 0.3, 1)
      : Number($("zoom").value);
  for (const wrap of document.querySelectorAll(".sheet-wrap")) {
    wrap.style.width = PAGE_W * zoom + "px";
    wrap.style.height = PAGE_H * zoom + "px";
    wrap.firstElementChild.style.transform = `scale(${zoom})`;
  }
}
function render({ inspector = true, sheets = true } = {}) {
  $("undo").disabled = !history.length;
  $("redo").disabled = !future.length;
  $("page-list").replaceChildren(
    ...project.pages.map((p, i) => {
      const n = el(
        "button",
        "page-tab" + (p.id === activePage ? " active" : ""),
        String(i + 1).padStart(2, "0"),
      );
      n.title = "Edit page " + (i + 1);
      n.onclick = () => {
        activePage = p.id;
        selected = [];
        render();
        document
          .querySelector(`[data-page="${p.id}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      return n;
    }),
  );
  $("block-count").textContent = currentPage().blocks.length;
  $("block-list").replaceChildren(
    ...currentPage().blocks.map((b) => {
      const n = el(
        "button",
        "block-row" + (selected.includes(b.id) ? " selected" : ""),
      );
      n.dataset.listBlock = b.id;
      n.append(
        el(
          "span",
          "block-icon",
          {
            text: "Aa",
            habit: "MH",
            image: "IMG",
            working: "···",
            answer: "ANS",
            divider: "—",
          }[b.type],
        ),
        el("span", "block-description", labelOf(b)),
      );
      n.onclick = (e) => select(b.id, e.shiftKey);
      n.oncontextmenu = (e) => openContext(e, b.id);
      n.draggable = true;
      n.ondragstart = (e) =>
        e.dataTransfer.setData("application/x-book-block", b.id);
      n.ondragover = (e) => e.preventDefault();
      n.ondrop = (e) => {
        e.preventDefault();
        const source = e.dataTransfer.getData("application/x-book-block");
        if (!source || source === b.id) return;
        mutate(() => {
          const p = pageOf(source),
            from = p.blocks.findIndex((x) => x.id === source),
            [item] = p.blocks.splice(from, 1);
          currentPage().blocks.splice(
            currentPage().blocks.findIndex((x) => x.id === b.id),
            0,
            item,
          );
        });
      };
      return n;
    }),
  );
  if (sheets) {
    renderedSheets = paginate();
    $("sheet-count").textContent =
      `${renderedSheets.length} A4 ${renderedSheets.length === 1 ? "page" : "pages"}`;
    $("sheets").replaceChildren(
      ...renderedSheets.map((s, index) => {
        const wrap = el("div", "sheet-wrap"),
          sheet = el("article", "worksheet");
        sheet.dataset.page = s.pageId;
        sheet.dataset.sheet = index;
        sheet.style.fontSize = project.fontSize + "px";
        const header = el("div", "worksheet-masthead");
        header.append(
          el("span", "", `${project.level}   ·   ${project.subject}`),
          el("span", "worksheet-title", project.title),
        );
        const content = el("div", "worksheet-content");
        content.append(
          ...s.items.map((item) => createBlock(item.block, item.fragment)),
        );
        if (!s.items.length)
          content.append(
            el(
              "div",
              "empty-page",
              "Paste a question or add a Math Habit to begin.",
            ),
          );
        const footer = el("div", "worksheet-footer"),
          logo = el("img");
        logo.src = "assets/logo.png";
        logo.alt = "Polymath sticker logo";
        footer.append(
          logo,
          el("span", "footer-name", "POLYMATH LEARNING CENTRE"),
          el("span", "footer-page", String(project.firstPage + index)),
        );
        sheet.append(header, content, footer);
        wrap.append(sheet);
        sheet.onclick = (e) => {
          const b = e.target.closest(".sheet-block");
          if (b) {
            const item = blockOf(b.dataset.block);
            // Free elements select on pointer-down so a group can start dragging
            // immediately. Do not toggle a Shift selection a second time here.
            if (!item?.floating || item.locked)
              select(b.dataset.block, e.shiftKey);
          } else if (!drag) select(null);
        };
        sheet.oncontextmenu = (e) => {
          const b = e.target.closest(".sheet-block");
          if (b) openContext(e, b.dataset.block);
        };
        content.addEventListener("pointerdown", startDrag);
        content.ondragover = (e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
          }
        };
        content.ondrop = async (e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          activePage = s.pageId;
          await addFiles(e.dataTransfer.files, {
            x: (e.clientX - content.getBoundingClientRect().left) / zoom,
            y: (e.clientY - content.getBoundingClientRect().top) / zoom,
          });
        };
        return wrap;
      }),
    );
    updateZoom();
    applySelection();
  }
  if (inspector) renderInspector();
}
function field(label, type, value, key, options) {
  const l = el("label", "", label),
    input = el(
      type === "textarea" ? "textarea" : type === "select" ? "select" : "input",
    );
  if (type === "select")
    for (const [v, text] of options) {
      const o = el("option", "", text);
      o.value = v;
      input.append(o);
    }
  else if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  input.dataset.field = key;
  l.append(input);
  return l;
}
function inspectorUpdate(input) {
  const b = blockOf(selected[0]);
  if (!b) return;
  const key = input.dataset.field;
  checkpoint(b.id + ":" + key);
  if (["x", "y", "w", "height", "rotation"].includes(key)) {
    let value = Number(input.value);
    if (!Number.isFinite(value)) return;
    if (key !== "rotation") value *= PX_PER_MM;
    b[key] =
      key === "rotation"
        ? clamp(value, -180, 180)
        : clamp(
            value,
            key === "w" ? 40 : 0,
            key === "y" || key === "height" ? CONTENT_H : CONTENT_W,
          );
  } else if (key === "floating" || key === "ruled" || key === "locked")
    b[key] = input.checked;
  else b[key] = input.value;
  if (b.floating) clampBlock(b);
  finishChange({ inspector: false });
}
function button(label, action, cls = "") {
  const b = el("button", cls, label);
  b.onclick = action;
  return b;
}
function renderInspector() {
  const root = $("inspector-content");
  root.replaceChildren();
  if (!selected.length) {
    root.append(
      el(
        "div",
        "empty-state",
        "Select an element to edit it. Drag pictures anywhere on the page. Shift-click to select several, then align them together.",
      ),
      el(
        "p",
        "footer-note",
        "Tip: paste with Ctrl+V / ⌘V. Right-click a picture for CER touch-up. Arrow keys nudge; Shift moves 10 pixels.",
      ),
    );
    const row = el("div", "inspector-actions");
    row.append(
      button("Duplicate page", duplicatePage),
      button("Delete page", deletePage, "danger"),
    );
    root.append(row);
    return;
  }
  if (selected.length > 1) {
    root.append(
      el("h2", "", `${selected.length} elements`),
      el(
        "p",
        "small-help",
        "Alignment works on freely placed elements. Use Free placement first for items in the text flow.",
      ),
    );
    addAlignment(root, true);
    const actions = el("div", "inspector-actions");
    actions.append(
      button("Free placement", () => makeFree(selected)),
      button("Duplicate", duplicateSelected),
      button("Delete", deleteSelected, "danger"),
    );
    root.append(actions);
    return;
  }
  const b = blockOf(selected[0]);
  if (!b) {
    selected = [];
    return;
  }
  root.append(
    el(
      "h2",
      "",
      {
        text: "Text",
        habit: "Math Habit",
        image: "Image",
        working: "Working space",
        answer: "Answer line",
        divider: "Divider",
      }[b.type],
    ),
  );
  if (b.type === "text")
    root.append(
      field("Question / text", "textarea", b.text, "text"),
      field("Text style", "select", b.style, "style", [
        ["body", "Body text"],
        ["prompt", "Question prompt"],
        ["heading", "Heading"],
      ]),
      field("Text alignment", "select", b.align, "align", [
        ["left", "Left"],
        ["center", "Centre"],
        ["right", "Right"],
        ["justify", "Justify"],
      ]),
    );
  if (b.type === "habit")
    root.append(
      field("Habit number", "text", b.number, "number"),
      field("Habit title", "text", b.title, "title"),
      el(
        "p",
        "small-help",
        "Add as many Math Habit banners as this question needs.",
      ),
    );
  if (b.type === "image") {
    root.append(
      field("Caption (optional)", "textarea", b.caption, "caption"),
      el(
        "p",
        "field-value",
        `Original: ${b.originalWidth || b.naturalWidth} × ${b.originalHeight || b.naturalHeight} px · Source stored at full quality`,
      ),
    );
    root.append(button("CER touch-up", () => touchUp(b.id), "primary full"));
    if (b.src !== b.originalSrc)
      root.append(
        button("Restore original image", () =>
          mutate(() => {
            b.src = b.originalSrc;
            b.naturalWidth = b.originalWidth;
            b.naturalHeight = b.originalHeight;
            clampBlock(b);
          }),
        ),
      );
    root.append(
      button("Replace image", () => {
        replacementId = b.id;
        $("image-input").click();
      }),
    );
  }
  if (b.type === "working") {
    root.append(
      field(
        "Height (mm)",
        "number",
        (b.height / PX_PER_MM).toFixed(1),
        "height",
      ),
      field("Working label", "text", b.label, "label"),
    );
    addCheck(root, "Ruled lines", "ruled", b.ruled);
  }
  if (b.type === "answer") root.append(field("Label", "text", b.text, "text"));
  addCheck(root, "Free placement", "floating", b.floating, () =>
    makeFree([b.id], !b.floating),
  );
  if (b.type === "image" || b.floating) {
    root.append(
      field(
        "Width (mm)",
        "number",
        ((b.w || CONTENT_W) / PX_PER_MM).toFixed(1),
        "w",
      ),
    );
  }
  if (b.floating) {
    const pair = el("div", "field-pair");
    pair.append(
      field("X (mm)", "number", (b.x / PX_PER_MM).toFixed(1), "x"),
      field("Y (mm)", "number", (b.y / PX_PER_MM).toFixed(1), "y"),
    );
    root.append(
      pair,
      field("Rotation (°)", "number", b.rotation || 0, "rotation"),
    );
    addAlignment(root);
    addCheck(root, "Lock position", "locked", b.locked);
  }
  const pageField = field(
    "Move to page",
    "select",
    pageOf(b.id).id,
    "page",
    project.pages.map((p, i) => [p.id, "Page " + (i + 1)]),
  );
  pageField.querySelector("select").onchange = (e) =>
    mutate(() => {
      const source = pageOf(b.id);
      source.blocks = source.blocks.filter((x) => x.id !== b.id);
      activePage = e.target.value;
      currentPage().blocks.push(b);
    });
  root.append(pageField);
  const actions = el("div", "inspector-actions");
  actions.append(
    button("↑ Earlier", () => reorder(b.id, -1)),
    button("↓ Later", () => reorder(b.id, 1)),
    button("Duplicate", duplicateSelected),
    button("Delete", deleteSelected, "danger"),
  );
  root.append(actions);
  for (const input of root.querySelectorAll("[data-field]")) {
    if (input.dataset.field === "page") continue;
    input.addEventListener(
      input.tagName === "SELECT" ? "change" : "input",
      () => inspectorUpdate(input),
    );
  }
}
function addCheck(root, text, key, value, custom) {
  const l = el("label", "check-field"),
    i = el("input");
  i.type = "checkbox";
  i.checked = !!value;
  i.dataset.field = key;
  l.append(i, document.createTextNode(text));
  if (custom) {
    delete i.dataset.field;
    i.onchange = custom;
  }
  root.append(l);
  if (!custom) i.onchange = () => inspectorUpdate(i);
}
function addAlignment(root, multi = false) {
  const row = el("div", "alignment-grid");
  for (const [label, key] of [
    ["Left", "left"],
    ["Centre", "center"],
    ["Right", "right"],
    ["Top", "top"],
    ["Middle", "middle"],
    ["Bottom", "bottom"],
  ])
    row.append(button(label, () => alignSelected(key)));
  if (multi)
    row.append(
      button("Space ↔", () => distribute("x")),
      button("Space ↕", () => distribute("y")),
    );
  root.append(el("span", "eyebrow", "ALIGN"), row);
}
function displayRect(id) {
  const n = document.querySelector(`.sheet-block[data-block="${id}"]`);
  const b = blockOf(id);
  return {
    x: b?.x || 0,
    y: b?.y || 0,
    w: n?.offsetWidth || b?.w || 300,
    h: n?.offsetHeight || 50,
  };
}
function clampBlock(b) {
  const h =
    b.type === "image"
      ? (b.w * b.naturalHeight) / b.naturalWidth + (b.caption ? 28 : 0)
      : heightOf(b);
  if (h > CONTENT_H && b.type === "image")
    b.w = Math.min(
      b.w,
      ((CONTENT_H - (b.caption ? 28 : 0)) * b.naturalWidth) / b.naturalHeight,
    );
  b.x = clamp(b.x || 0, 0, Math.max(0, CONTENT_W - b.w));
  b.y = clamp(
    b.y || 0,
    0,
    Math.max(
      0,
      CONTENT_H -
        (b.type === "image"
          ? (b.w * b.naturalHeight) / b.naturalWidth + (b.caption ? 28 : 0)
          : h),
    ),
  );
}
function makeFree(ids, on = true) {
  if (
    on &&
    ids.some((id) => {
      const b = blockOf(id);
      return b?.type === "text" && heightOf(b) > CONTENT_H;
    })
  ) {
    toast(
      "This question spans several pages. Keep it in text flow so every line is included.",
    );
    renderInspector();
    return;
  }
  const rects = new Map(
    ids.map((id) => {
      const n = document.querySelector(`.sheet-block[data-block="${id}"]`),
        c = n?.parentElement;
      return [
        id,
        n
          ? {
              x:
                (n.getBoundingClientRect().left -
                  c.getBoundingClientRect().left) /
                zoom,
              y:
                (n.getBoundingClientRect().top -
                  c.getBoundingClientRect().top) /
                zoom,
              w: n.offsetWidth,
            }
          : null,
      ];
    }),
  );
  mutate(() => {
    for (const id of ids) {
      const b = blockOf(id);
      if (!b) continue;
      if (on && !b.floating) {
        const r = rects.get(id);
        Object.assign(b, { x: r?.x || 0, y: r?.y || 0, w: r?.w || CONTENT_W });
      }
      b.floating = on;
      clampBlock(b);
    }
  });
}
function alignSelected(direction) {
  const items = selected
    .map((id) => blockOf(id))
    .filter((b) => b?.floating && !b.locked);
  if (!items.length) {
    toast("Turn on Free placement to align an element.");
    return;
  }
  const rects = items.map((b) => displayRect(b.id)),
    samePage = new Set(items.map((b) => pageOf(b.id).id));
  if (samePage.size > 1) {
    toast("Select elements on the same page to align together.");
    return;
  }
  const box =
    items.length === 1
      ? { x: 0, y: 0, w: CONTENT_W, h: CONTENT_H }
      : {
          x: Math.min(...rects.map((r) => r.x)),
          y: Math.min(...rects.map((r) => r.y)),
          w:
            Math.max(...rects.map((r) => r.x + r.w)) -
            Math.min(...rects.map((r) => r.x)),
          h:
            Math.max(...rects.map((r) => r.y + r.h)) -
            Math.min(...rects.map((r) => r.y)),
        };
  mutate(() =>
    items.forEach((b, i) => {
      const r = rects[i];
      if (direction === "left") b.x = box.x;
      if (direction === "center") b.x = box.x + (box.w - r.w) / 2;
      if (direction === "right") b.x = box.x + box.w - r.w;
      if (direction === "top") b.y = box.y;
      if (direction === "middle") b.y = box.y + (box.h - r.h) / 2;
      if (direction === "bottom") b.y = box.y + box.h - r.h;
      clampBlock(b);
    }),
  );
}
function distribute(axis) {
  const items = selected.map(blockOf).filter((b) => b?.floating && !b.locked);
  if (items.length < 3) {
    toast("Select at least three freely placed elements.");
    return;
  }
  if (new Set(items.map((b) => pageOf(b.id).id)).size > 1) {
    toast("Select elements on the same page.");
    return;
  }
  const size = axis === "x" ? "w" : "h";
  items.sort((a, b) => a[axis] - b[axis]);
  const rs = items.map((b) => displayRect(b.id)),
    start = rs[0][axis],
    end = rs.at(-1)[axis] + rs.at(-1)[size],
    gap =
      (end - start - rs.reduce((n, r) => n + r[size], 0)) / (items.length - 1);
  mutate(() => {
    let pos = start;
    items.forEach((b, i) => {
      b[axis] = pos;
      pos += rs[i][size] + gap;
      clampBlock(b);
    });
  });
}
function reorder(id, direction) {
  mutate(() => {
    const p = pageOf(id),
      i = p.blocks.findIndex((b) => b.id === id),
      j = clamp(i + direction, 0, p.blocks.length - 1);
    [p.blocks[i], p.blocks[j]] = [p.blocks[j], p.blocks[i]];
  });
}
function duplicateSelected() {
  mutate(() => {
    const ids = [];
    for (const id of selected) {
      const b = blockOf(id);
      if (!b) continue;
      const copy = clone(b);
      copy.id = uid();
      if (copy.floating) {
        copy.x += 16;
        copy.y += 16;
        clampBlock(copy);
      }
      const p = pageOf(id);
      p.blocks.splice(p.blocks.indexOf(b) + 1, 0, copy);
      ids.push(copy.id);
    }
    selected = ids;
  });
}
function deleteSelected() {
  mutate(() => {
    for (const p of project.pages)
      p.blocks = p.blocks.filter((b) => !selected.includes(b.id));
    selected = [];
  });
}
function addPage() {
  mutate(() => {
    const p = { id: uid(), blocks: [] };
    project.pages.push(p);
    activePage = p.id;
    selected = [];
  });
  document
    .querySelector(`[data-page="${activePage}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function duplicatePage() {
  mutate(() => {
    const p = clone(currentPage());
    p.id = uid();
    p.blocks.forEach((b) => (b.id = uid()));
    project.pages.splice(
      project.pages.findIndex((x) => x.id === activePage) + 1,
      0,
      p,
    );
    activePage = p.id;
    selected = [];
  });
}
async function confirmAction(title, message) {
  $("confirm-title").textContent = title;
  $("confirm-message").textContent = message;
  $("confirm-dialog").showModal();
  return new Promise((resolve) => {
    const done = (value) => {
      $("confirm-dialog").close();
      $("confirm-ok").onclick = null;
      $("confirm-cancel").onclick = null;
      resolve(value);
    };
    $("confirm-ok").onclick = () => done(true);
    $("confirm-cancel").onclick = () => done(false);
    $("confirm-dialog").oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
  });
}
async function deletePage() {
  if (
    !(await confirmAction(
      "Delete page?",
      "The elements on this page will be removed. You can undo this change.",
    ))
  )
    return;
  mutate(() => {
    if (project.pages.length === 1) currentPage().blocks = [];
    else project.pages = project.pages.filter((p) => p.id !== activePage);
    activePage = project.pages[0].id;
    selected = [];
  });
}
function addBlock(b) {
  mutate(() => {
    currentPage().blocks.push(b);
    selected = [b.id];
  });
  return b;
}
function startDrag(e) {
  const n = e.target.closest(".sheet-block");
  if (!n || e.button !== 0 || window.BookTouchup?.isOpen()) return;
  const id = n.dataset.block,
    b = blockOf(id);
  if (!b.floating || b.locked) return;
  if (e.shiftKey) {
    select(id, true);
    if (!selected.includes(id)) return;
  } else if (!selected.includes(id)) select(id);
  e.preventDefault();
  const corner = e.target.dataset.corner,
    ids = corner
      ? [id]
      : selected.filter(
          (x) =>
            blockOf(x)?.floating &&
            !blockOf(x).locked &&
            pageOf(x).id === pageOf(id).id,
        );
  const starts = ids.map((id) => ({ id, ...displayRect(id) }));
  drag = {
    id,
    ids,
    starts,
    pointer: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    corner,
    changed: false,
    content: n.parentElement,
    offsetX:
      (e.clientX - n.parentElement.getBoundingClientRect().left) / zoom - b.x,
    offsetY:
      (e.clientY - n.parentElement.getBoundingClientRect().top) / zoom - b.y,
  };
  document.body.classList.add("dragging");
  try {
    n.setPointerCapture(e.pointerId);
  } catch {}
}
function drawGuides(content, guides) {
  content.querySelectorAll(".alignment-guide").forEach((n) => n.remove());
  for (const g of guides) {
    const n = el("div", "alignment-guide " + g.axis);
    n.style[g.axis === "x" ? "left" : "top"] = g.value + "px";
    content.append(n);
  }
}
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  const dx = (e.clientX - drag.startX) / zoom,
    dy = (e.clientY - drag.startY) / zoom;
  if (!drag.changed && Math.hypot(dx, dy) < 2) return;
  if (!drag.changed) {
    checkpoint();
    drag.changed = true;
  }
  const base = drag.starts[0],
    b = blockOf(drag.id);
  if (drag.corner) {
    const left = drag.corner.includes("w"),
      top = drag.corner.includes("n");
    const raw = base.w + (left ? -dx : dx),
      maxByHeight =
        b.type === "image"
          ? ((CONTENT_H - (b.caption ? 28 : 0)) * b.naturalWidth) /
            b.naturalHeight
          : CONTENT_W;
    b.w = clamp(raw, 40, Math.min(CONTENT_W, maxByHeight));
    const h =
      b.type === "image"
        ? (b.w * b.naturalHeight) / b.naturalWidth + (b.caption ? 28 : 0)
        : heightOf(b);
    b.x = base.x + (left ? base.w - b.w : 0);
    b.y = base.y + (top ? base.h - h : 0);
    clampBlock(b);
  } else {
    const others = currentPage()
      .blocks.filter((x) => x.floating && !drag.ids.includes(x.id))
      .map((x) => displayRect(x.id));
    const pos = snapPosition(
      base.x + dx,
      base.y + dy,
      base.w,
      base.h,
      others,
      project.snap && !e.altKey,
    );
    for (const r of drag.starts) {
      const item = blockOf(r.id);
      item.x = r.x + (pos.x - base.x);
      item.y = r.y + (pos.y - base.y);
      clampBlock(item);
    }
    drawGuides(drag.content, pos.guides);
  }
  for (const id of drag.ids) {
    const item = blockOf(id),
      n = document.querySelector(`.sheet-block[data-block="${id}"]`);
    if (n) {
      n.style.left = item.x + "px";
      n.style.top = item.y + "px";
      n.style.width = item.w + "px";
      const img = n.querySelector("img");
      if (img)
        img.style.height =
          (item.w * item.naturalHeight) / item.naturalWidth + "px";
    }
  }
});
function endDrag() {
  if (!drag) return;
  const changed = drag.changed;
  if (changed && !drag.corner) {
    const target = document
        .elementFromPoint(drag.lastX, drag.lastY)
        ?.closest(".worksheet-content"),
      pageId = target?.closest(".worksheet")?.dataset.page;
    if (pageId && pageId !== pageOf(drag.id).id) {
      const destination = project.pages.find((p) => p.id === pageId),
        r = target.getBoundingClientRect(),
        first = drag.starts[0];
      const x = (drag.lastX - r.left) / zoom - drag.offsetX,
        y = (drag.lastY - r.top) / zoom - drag.offsetY;
      for (const start of drag.starts) {
        const b = blockOf(start.id),
          source = pageOf(start.id);
        source.blocks = source.blocks.filter((v) => v.id !== start.id);
        destination.blocks.push(b);
        b.x = x + start.x - first.x;
        b.y = y + start.y - first.y;
        clampBlock(b);
      }
      activePage = pageId;
    }
  }
  drag.content.querySelectorAll(".alignment-guide").forEach((n) => n.remove());
  drag = null;
  document.body.classList.remove("dragging");
  if (changed) finishChange();
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
const menu = el("div", "context-menu");
menu.hidden = true;
menu.setAttribute("role", "menu");
document.body.append(menu);
function openContext(e, id) {
  e.preventDefault();
  select(id);
  contextTarget = id;
  menu.replaceChildren();
  const b = blockOf(id);
  const entries = [];
  if (b.type === "image")
    entries.push(
      ["CER touch-up", () => touchUp(id)],
      [
        "Download original image",
        () => downloadData(b.originalSrc, b.name || "original.png"),
      ],
    );
  if (b.type === "text" || b.type === "habit")
    entries.push([
      "Edit text",
      () => {
        $("inspector-content").querySelector("textarea,input")?.focus();
      },
    ]);
  entries.push(
    [
      b.floating ? "Return to text flow" : "Free placement",
      () => makeFree([id], !b.floating),
    ],
    [
      "Bring to front",
      () =>
        mutate(() => {
          const p = pageOf(id);
          p.blocks = p.blocks.filter((x) => x.id !== id);
          p.blocks.push(b);
        }),
    ],
    [
      "Send to back",
      () =>
        mutate(() => {
          const p = pageOf(id);
          p.blocks = p.blocks.filter((x) => x.id !== id);
          p.blocks.unshift(b);
        }),
    ],
    ["Duplicate", duplicateSelected],
    [
      b.locked ? "Unlock position" : "Lock position",
      () => mutate(() => (b.locked = !b.locked)),
    ],
    ["Delete", deleteSelected],
  );
  for (const [title, fn] of entries) {
    const n = button(title, () => {
      menu.hidden = true;
      fn();
    });
    n.setAttribute("role", "menuitem");
    menu.append(n);
  }
  menu.hidden = false;
  menu.style.left = clamp(e.clientX, 8, innerWidth - 220) + "px";
  menu.style.top =
    clamp(e.clientY, 8, innerHeight - menu.offsetHeight - 8) + "px";
  menu.querySelector("button").focus();
}
document.addEventListener("pointerdown", (e) => {
  if (!menu.contains(e.target)) menu.hidden = true;
});
function touchUp(id) {
  const b = blockOf(id);
  if (b?.type !== "image") return;
  window.BookTouchup.open(b.src, (result) => {
    if (!blockOf(id)) return;
    mutate(() => {
      b.src = result.src;
      b.naturalWidth = result.width;
      b.naturalHeight = result.height;
      clampBlock(b);
    });
    toast("CER touch-ups applied. Restore original is available.");
  });
}
let replacementId = null;
const fileData = (file) =>
  new Promise((r, j) => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result);
    reader.onerror = () => j(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
const loadImage = (src) =>
  new Promise((r, j) => {
    const img = new Image();
    img.onload = () => r(img);
    img.onerror = () => j(new Error("This image could not be opened"));
    img.src = src;
  });
async function addFiles(files, at = null) {
  const pageId = activePage;
  for (const file of Array.from(files)) {
    try {
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type))
        throw new Error("Choose a PNG, JPG, WEBP, GIF or SVG image.");
      if (file.size > 30 * 1024 * 1024)
        throw new Error(
          "Image exceeds 30 MB. Choose a smaller file; images are never silently compressed.",
        );
      if (file.type === "image/svg+xml") validateSvg(await file.text());
      const src = await fileData(file),
        img = await loadImage(src);
      const w = clamp(
        Math.min(
          img.naturalWidth,
          CONTENT_W * 0.65,
          (CONTENT_H * 0.65 * img.naturalWidth) / img.naturalHeight,
        ),
        40,
        CONTENT_W,
      );
      activePage = project.pages.some((p) => p.id === pageId)
        ? pageId
        : project.pages[0].id;
      const b = makeBlock("image", {
        src,
        originalSrc: src,
        name: file.name || "Pasted image.png",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        originalWidth: img.naturalWidth,
        originalHeight: img.naturalHeight,
        w,
        x: at?.x ?? (CONTENT_W - w) / 2,
        y: at?.y ?? nextFreeY(),
      });
      clampBlock(b);
      if (replacementId && blockOf(replacementId)) {
        const target = blockOf(replacementId);
        mutate(() => {
          Object.assign(target, {
            src,
            originalSrc: src,
            name: b.name,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            originalWidth: img.naturalWidth,
            originalHeight: img.naturalHeight,
          });
          clampBlock(target);
        });
        replacementId = null;
      } else addBlock(b);
    } catch (e) {
      toast(e.message);
    }
  }
}
function nextFreeY() {
  const c = document.querySelector(
    `[data-page="${activePage}"] .worksheet-content`,
  );
  let y = 20;
  if (c)
    for (const n of c.querySelectorAll(".sheet-block"))
      y = Math.max(y, n.offsetTop + n.offsetHeight + 18);
  return Math.min(y, CONTENT_H * 0.6);
}
document.addEventListener("paste", (e) => {
  if (window.BookTouchup?.isOpen()) return;
  const files = Array.from(e.clipboardData?.items || [])
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (files.length) {
    e.preventDefault();
    addFiles(files);
    return;
  }
  if (e.target.closest("input,textarea,[contenteditable]")) return;
  const text = e.clipboardData?.getData("text/plain");
  if (text?.trim()) {
    e.preventDefault();
    addBlock(makeBlock("text", { text: text.trim() }));
  }
});
$("image-input").onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = "";
};
$("image-input").oncancel = () => (replacementId = null);
const dropZone = $("drop-zone");
dropZone.onclick = () => {
  $("image-input").click();
};
dropZone.onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    dropZone.click();
  }
};
dropZone.ondragover = (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
};
dropZone.ondragleave = () => dropZone.classList.remove("dragging");
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  addFiles(e.dataTransfer.files);
};
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = el("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadData(src, name) {
  fetch(src)
    .then((r) => r.blob())
    .then((b) => download(b, name));
}
const filename = () =>
  project.title
    .replace(/[^a-z0-9 _-]/gi, "")
    .trim()
    .replace(/\s+/g, "-") || "Polymath-worksheet";
$("export-project").onclick = () =>
  download(
    new Blob([JSON.stringify(project)], { type: "application/json" }),
    filename() + ".book.json",
  );
$("import-project").onclick = () => $("project-input").click();
$("project-input").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 160 * 1024 * 1024)
      throw new Error("Project file exceeds 160 MB.");
    const value = validateProject(JSON.parse(await file.text()));
    if (
      !(await confirmAction(
        "Open project?",
        "Replace the current draft with this project? You can undo this change.",
      ))
    )
      return;
    checkpoint();
    project = value;
    activePage = project.pages[0].id;
    selected = [];
    syncSettings();
    finishChange();
    toast("Project opened.");
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.value = "";
  }
};
$("add-text").onclick = () => {
  const text = $("paste-input").value.trim();
  if (!text) {
    toast("Paste or type your question first.");
    $("paste-input").focus();
    return;
  }
  addBlock(makeBlock("text", { text }));
  $("paste-input").value = "";
};
$("add-image").onclick = () => {
  replacementId = null;
  $("image-input").click();
};
$("add-habit").onclick = () =>
  addBlock(
    makeBlock("habit", {
      number: String(
        currentPage().blocks.filter((b) => b.type === "habit").length + 1,
      ).padStart(2, "0"),
    }),
  );
$("add-working").onclick = () => addBlock(makeBlock("working"));
$("add-answer").onclick = () => addBlock(makeBlock("answer"));
$("add-divider").onclick = () => addBlock(makeBlock("divider"));
$("add-page").onclick = addPage;
$("add-hexagon").onclick = () => {
  const d = dotDiagram();
  addBlock(
    makeBlock("image", {
      src: d.src,
      originalSrc: d.src,
      naturalWidth: d.width,
      naturalHeight: d.height,
      originalWidth: d.width,
      originalHeight: d.height,
      w: 320,
      x: (CONTENT_W - 320) / 2,
      y: nextFreeY(),
      name: "Hexagon — 24 dots.svg",
    }),
  );
};
$("undo").onclick = undo;
$("redo").onclick = redo;
$("zoom").onchange = updateZoom;
new ResizeObserver(updateZoom).observe($("preview-scroll"));
$("snap-grid").onchange = (e) => {
  project.snap = e.target.checked;
  scheduleSave();
};
$("preview-only").onclick = () => {
  document.body.classList.toggle("focus-preview");
  $("preview-only").textContent = document.body.classList.contains(
    "focus-preview",
  )
    ? "Editor view"
    : "Focus view";
  setTimeout(updateZoom, 0);
};
for (const [id, key] of [
  ["book-title", "title"],
  ["level", "level"],
  ["subject", "subject"],
  ["page-number", "firstPage"],
  ["font-size", "fontSize"],
])
  $(id).addEventListener("input", (e) => {
    checkpoint("settings:" + key);
    project[key] = ["firstPage", "fontSize"].includes(key)
      ? clamp(Number(e.target.value) || 1, 1, key === "fontSize" ? 20 : 9999)
      : e.target.value;
    finishChange({ inspector: false });
  });
$("new-project").onclick = async () => {
  if (
    !(await confirmAction(
      "Start a new book?",
      "Save project first if you want a separate copy. You can undo this change.",
    ))
  )
    return;
  checkpoint();
  project = blankProject();
  activePage = project.pages[0].id;
  selected = [];
  syncSettings();
  finishChange();
};
function example() {
  const p = blankProject();
  p.title = "Thinking in patterns";
  const d = dotDiagram();
  p.pages[0].blocks = [
    makeBlock("habit", { number: "04", title: "Double counting" }),
    makeBlock("text", {
      text: "Each side of a hexagon has 5 dots, including the dots at its corners. How many dots are there altogether?",
      style: "prompt",
    }),
    makeBlock("image", {
      src: d.src,
      originalSrc: d.src,
      naturalWidth: 360,
      naturalHeight: 330,
      originalWidth: 360,
      originalHeight: 330,
      w: 320,
      floating: false,
      name: "Hexagon — 24 dots.svg",
    }),
    makeBlock("habit", { number: "09", title: "Check shared parts" }),
    makeBlock("text", {
      text: "Think about which dots belong to two sides. Show how you count each dot once.",
    }),
    makeBlock("working", { height: 220 }),
    makeBlock("answer"),
  ];
  return p;
}
$("load-example").onclick = async () => {
  if (
    currentPage().blocks.length &&
    !(await confirmAction(
      "Load the example?",
      "This replaces the current book. You can undo it.",
    ))
  )
    return;
  checkpoint();
  project = example();
  activePage = project.pages[0].id;
  selected = [];
  syncSettings();
  finishChange();
};
document.addEventListener("keydown", (e) => {
  if (window.BookTouchup?.isOpen()) return;
  if (e.key === "Escape") {
    menu.hidden = true;
    select(null);
    return;
  }
  if (e.target.closest("input,textarea,[contenteditable]")) return;
  const command = e.ctrlKey || e.metaKey;
  if (command && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (command && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (command && e.key.toLowerCase() === "d" && selected.length) {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (command && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selected = currentPage().blocks.map((b) => b.id);
    render({ sheets: false });
    applySelection();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
    selected.length
  ) {
    e.preventDefault();
    const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0,
      dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0,
      step = e.shiftKey ? 10 : 1;
    mutate(() => {
      for (const id of selected) {
        const b = blockOf(id);
        if (b?.floating && !b.locked) {
          b.x += dx * step;
          b.y += dy * step;
          clampBlock(b);
        }
      }
    });
  }
});
// Export the actual laid-out page. Text is placed from browser line positions,
// and each image uses its untouched embedded source, including in SVG exports.
let logoData;
async function ensureImages() {
  await Promise.all(
    Array.from(document.querySelectorAll(".worksheet img")).map((img) =>
      img.decode().catch(() => {}),
    ),
  );
  if (!logoData) {
    const blob = await (await fetch("assets/logo.png")).blob();
    logoData = await fileData(blob);
  }
}
function pageSvg(sheet) {
  const base = sheet.getBoundingClientRect(),
    scale = base.width / PAGE_W;
  const rect = (n) => {
    const r = n.getBoundingClientRect();
    return {
      x: (r.left - base.left) / scale,
      y: (r.top - base.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  };
  const ctx = document.createElement("canvas").getContext("2d");
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="100%" height="100%" fill="white"/>`;
  function paint(n) {
    if (
      n.classList.contains("selection-handle") ||
      n.classList.contains("alignment-guide") ||
      n.classList.contains("empty-page")
    )
      return;
    const s = getComputedStyle(n),
      r = rect(n);
    if (s.display === "none") return;
    const rotation = n.classList.contains("sheet-block")
      ? Number(blockOf(n.dataset.block)?.rotation || 0)
      : 0;
    let cx, cy;
    if (rotation) {
      n.style.transform = "none";
      const rr = rect(n);
      cx = rr.x + rr.w / 2;
      cy = rr.y + rr.h / 2;
      out += `<g transform="rotate(${rotation} ${cx} ${cy})">`;
    }
    const box = rect(n);
    const contentClip = n.classList.contains("worksheet-content");
    if (contentClip)
      out += `<defs><clipPath id="contentClip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs><g clip-path="url(#contentClip)">`;
    if (
      s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      s.backgroundColor !== "transparent"
    )
      out += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${parseFloat(s.borderTopLeftRadius) || 0}" fill="${s.backgroundColor}"/>`;
    for (const edge of ["Top", "Right", "Bottom", "Left"]) {
      const width = parseFloat(s["border" + edge + "Width"]);
      if (!width || s["border" + edge + "Style"] === "none") continue;
      const color = s["border" + edge + "Color"];
      if (n.classList.contains("footer-page")) {
        if (edge === "Top")
          out += `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2 - width / 2}" ry="${box.h / 2 - width / 2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
        continue;
      }
      const x1 = box.x + (edge === "Right" ? box.w : 0),
        y1 = box.y + (edge === "Bottom" ? box.h : 0),
        x2 = x1 + (["Top", "Bottom"].includes(edge) ? box.w : 0),
        y2 = y1 + (["Left", "Right"].includes(edge) ? box.h : 0);
      out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
    }
    if (n.tagName === "IMG") {
      const src = n.closest(".worksheet-footer") ? logoData : n.src;
      out += `<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid meet"/>`;
    } else
      for (const child of n.childNodes) {
        if (child.nodeType === 1) paint(child);
        else if (child.nodeType === 3 && child.textContent.trim()) {
          const fontSize = parseFloat(s.fontSize),
            family = "Arial",
            weight = s.fontWeight;
          ctx.font = `${weight} ${fontSize}px ${family}`;
          const ascent =
            ctx.measureText("Mg").fontBoundingBoxAscent || fontSize * 0.86;
          const text = child.textContent,
            range = document.createRange();
          let runs = [],
            run = null;
          for (let i = 0; i < text.length; i++) {
            range.setStart(child, i);
            range.setEnd(child, i + 1);
            const cr = range.getBoundingClientRect();
            if (!cr.height || text[i] === "\n") {
              run = null;
              continue;
            }
            const x = (cr.left - base.left) / scale,
              y = (cr.top - base.top) / scale + ascent;
            const spaced = parseFloat(s.letterSpacing) || 0;
            if (s.textAlign === "justify" || spaced) {
              runs.push({
                x,
                y,
                text:
                  s.textTransform === "uppercase"
                    ? text[i].toUpperCase()
                    : s.textTransform === "lowercase"
                      ? text[i].toLowerCase()
                      : text[i],
              });
              continue;
            }
            if (!run || Math.abs(run.y - y) > 0.5) {
              run = { x, y, text: "" };
              runs.push(run);
            }
            run.text +=
              s.textTransform === "uppercase"
                ? text[i].toUpperCase()
                : s.textTransform === "lowercase"
                  ? text[i].toLowerCase()
                  : text[i];
          }
          for (const t of runs)
            out += `<text x="${t.x}" y="${t.y}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${s.color}" xml:space="preserve">${escapeXml(t.text)}</text>`;
        }
      }
    if (contentClip) out += "</g>";
    if (rotation) {
      out += "</g>";
      n.style.transform = `rotate(${rotation}deg)`;
    }
  }
  paint(sheet);
  return out + "</svg>";
}
async function raster(svg, dpi = 300) {
  const img = await loadImage(
    "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((210 / 25.4) * dpi);
  canvas.height = Math.round((297 / 25.4) * dpi);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function exportPages(kind) {
  const buttons = [$("export-pdf"), $("export-png"), $("export-svg")];
  buttons.forEach((b) => (b.disabled = true));
  toast("Preparing your " + kind.toUpperCase() + "…");
  try {
    await ensureImages();
    document.body.classList.add("exporting");
    const sheets = Array.from(document.querySelectorAll(".worksheet"));
    if (kind === "pdf") {
      const pages = [];
      for (let i = 0; i < sheets.length; i++) {
        const canvas = await raster(pageSvg(sheets[i])),
          rgba = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
          rgb = new Uint8Array(canvas.width * canvas.height * 3);
        for (let p = 0, j = 0; p < rgba.length; p += 4) {
          rgb[j++] = rgba[p];
          rgb[j++] = rgba[p + 1];
          rgb[j++] = rgba[p + 2];
        }
        const stream = new Blob([rgb])
          .stream()
          .pipeThrough(new CompressionStream("deflate"));
        pages.push({
          width: canvas.width,
          height: canvas.height,
          bytes: new Uint8Array(await new Response(stream).arrayBuffer()),
        });
        canvas.width = 1;
        canvas.height = 1;
        toast(`Preparing PDF: page ${i + 1} of ${sheets.length}`);
        await new Promise((r) => setTimeout(r, 0));
      }
      download(buildPdf(pages), filename() + ".pdf");
    } else {
      for (let i = 0; i < sheets.length; i++) {
        const svg = pageSvg(sheets[i]);
        if (kind === "svg")
          download(
            new Blob([svg], { type: "image/svg+xml" }),
            filename() + `-${i + 1}.svg`,
          );
        else {
          const canvas = await raster(svg);
          download(
            await new Promise((r) => canvas.toBlob(r, "image/png")),
            filename() + `-${i + 1}.png`,
          );
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    toast(kind.toUpperCase() + " downloaded.");
  } catch (e) {
    console.error(e);
    toast("Export could not finish: " + e.message);
  } finally {
    document.body.classList.remove("exporting");
    buttons.forEach((b) => (b.disabled = false));
  }
}
$("export-pdf").onclick = () => exportPages("pdf");
$("export-png").onclick = () => exportPages("png");
$("export-svg").onclick = () => exportPages("svg");
$("print").onclick = async () => {
  await ensureImages();
  window.print();
};
await loadDraft();
syncSettings();
render();
$("save-status").textContent = "Draft saved on this device";
// Read-only helpers make the real layout and native pixel preservation testable.
window.BookStudio = {
  getProject: () => clone(project),
  getLayout: () =>
    renderedSheets.map((s) => ({
      pageId: s.pageId,
      ids: s.items.map((i) => i.block.id),
    })),
  exportPages,
};
