const assert = require("node:assert/strict");

module.exports = async function textPaste(browser, base) {
  const page = await browser.newPage({
    viewport: { width: 1660, height: 1250 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
  const state = () => page.evaluate(() => window.BookStudio.getProject());
  const blocks = async () => (await state()).pages.flatMap((p) => p.blocks);
  const block = async (id) => (await blocks()).find((b) => b.id === id);
  const box = (id) =>
    page.locator(`.worksheet [data-block="${id}"] .rich-textbox`);
  let imageSrc;
  async function paste(selector, data) {
    return page.evaluate(
      ({ selector, data, imageSrc }) => {
        const clipboardData = new DataTransfer();
        if (data.plain !== undefined)
          clipboardData.setData("text/plain", data.plain);
        if (data.html !== undefined)
          clipboardData.setData("text/html", data.html);
        if (data.image) {
          const bytes = Uint8Array.from(atob(imageSrc.split(",")[1]), (c) =>
            c.charCodeAt(0),
          );
          clipboardData.items.add(
            new File([bytes], "preview.png", { type: "image/png" }),
          );
        }
        const target = selector
          ? document.querySelector(selector)
          : document.activeElement;
        return target.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { selector, data, imageSrc },
    );
  }
  async function nativeClipboard(plain) {
    await page.evaluate(
      async ({ plain, imageSrc }) => {
        const image = await (await fetch(imageSrc)).blob();
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "image/png": image,
          }),
        ]);
      },
      { plain, imageSrc },
    );
  }
  async function range(locator, start, end = start) {
    await locator.evaluate(
      (node, { start, end }) => {
        node.focus();
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
        const r = document.createRange();
        r.setStart(...point(start));
        r.setEnd(...point(end));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        document.dispatchEvent(new Event("selectionchange"));
      },
      { start, end },
    );
  }
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.BookStudio);
    await page.click("#new-project");
    await page.click("#confirm-ok");
    imageSrc = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 40;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#239ba5";
      ctx.fillRect(0, 0, 80, 40);
      return c.toDataURL("image/png");
    });

    // Actual Ctrl+V with both text and a picture creates one editable text box.
    const question = "  Mei has 12 beads.\n\nHow many groups of 3?  ";
    await nativeClipboard(question);
    await page.locator(".worksheet-masthead").click();
    await page.keyboard.press("Control+V");
    await page.waitForFunction(
      () => window.BookStudio.getProject().pages[0].blocks.length === 1,
    );
    const q = (await blocks())[0];
    assert.equal(q.type, "text");
    assert.equal(q.text, question);
    assert.equal(
      await box(q.id).evaluate(
        (n) => n.isContentEditable && document.activeElement === n,
      ),
      true,
    );

    // A mixed rich clipboard replaces only the selection and retains safe style.
    await range(box(q.id), 2, 5);
    assert.equal(
      await paste(null, {
        plain: "Siti",
        image: true,
        html: '<script>window.__pasteAttack = 1</script><b style="color:#ad2468">Siti</b><img src="invalid" onerror="window.__pasteAttack = 2">',
      }),
      false,
    );
    let updated = "  Siti has 12 beads.\n\nHow many groups of 3?  ";
    assert.equal((await block(q.id)).text, updated);
    assert.ok(
      (await block(q.id)).runs.some(
        (r) => r.text === "Siti" && r.bold && r.color === "#ad2468",
      ),
    );
    assert.equal((await blocks()).length, 1);
    assert.equal(await box(q.id).locator("img,script").count(), 0);
    assert.equal(await page.evaluate(() => window.__pasteAttack), undefined);
    await page.keyboard.press("Control+Z");
    assert.equal((await block(q.id)).text, question);
    await page.keyboard.press("Control+Shift+Z");
    assert.equal((await block(q.id)).text, updated);

    // Image-only HTML must fall back to the real plain text, including newlines.
    await range(box(q.id), updated.length);
    await paste(null, {
      plain: "\nPart (b)\r\nFind the remainder.",
      html: '<div><img src="invalid"></div>',
      image: true,
    });
    updated += "\nPart (b)\nFind the remainder.";
    assert.equal((await block(q.id)).text, updated);
    assert.equal((await blocks()).length, 1);

    // HTML-only textual content plus an image preview is also editable text.
    await page.keyboard.press("Escape");
    await page.locator(".worksheet-masthead").click();
    await paste("body", {
      html: "<p><b>Question 2</b></p><p><u>Show your method.</u></p>",
      image: true,
    });
    const htmlBox = (await blocks()).at(-1);
    assert.equal(htmlBox.type, "text");
    assert.equal(htmlBox.text, "Question 2\nShow your method.");
    assert.ok(htmlBox.runs.some((r) => r.text === "Question 2" && r.bold));
    assert.ok(
      htmlBox.runs.some((r) => r.text === "Show your method." && r.underline),
    );
    assert.equal(
      await box(htmlBox.id).evaluate((n) => n.isContentEditable),
      true,
    );

    // Answers, cells and Math Habits use the same text-first insertion.
    await page.click("#add-answer");
    const answer = (await blocks()).at(-1);
    await page
      .locator(`.worksheet [data-block="${answer.id}"] .answer-line`)
      .click();
    await paste(null, { plain: "4 groups", image: true });
    assert.equal((await block(answer.id)).value, "4 groups");
    await page.click("#add-table");
    await page.locator("#table-rows").fill("1");
    await page.locator("#table-cols").fill("2");
    await page.click("#table-insert");
    const table = (await blocks()).at(-1);
    await box(table.id).first().click();
    await paste(null, { plain: "12 beads", image: true });
    assert.equal((await block(table.id)).cells[0][0].text, "12 beads");
    assert.equal((await block(table.id)).cells[0][1].text, "");
    await page.click("#add-habit");
    const habit = (await blocks()).at(-1);
    const title = page.locator(
      `.worksheet [data-block="${habit.id}"] .habit-title`,
    );
    await title.dblclick();
    await page.keyboard.press("Control+A");
    await paste(null, { plain: "Check equal groups", image: true });
    assert.equal((await block(habit.id)).title, "Check equal groups");
    assert.equal((await blocks()).filter((b) => b.type === "image").length, 0);

    // A normal input keeps native text paste even if the clipboard has a picture.
    await nativeClipboard("Input text");
    await page.locator("#paste-input").fill("Draft ");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+V");
    await page.waitForFunction(
      () => document.getElementById("paste-input").value === "Draft Input text",
    );
    assert.equal((await blocks()).length, 5);

    // Genuine image-only paste retains the original bytes, including while editing.
    await range(box(q.id), 0);
    await paste(null, {
      image: true,
      html: '<p><img src="invalid" alt="A diagram"></p>',
    });
    await page.waitForFunction(() =>
      window.BookStudio.getProject().pages[0].blocks.some(
        (b) => b.type === "image",
      ),
    );
    const image = (await blocks()).at(-1);
    assert.equal(image.type, "image");
    assert.equal(image.originalSrc, imageSrc);
    assert.equal(image.naturalWidth, 80);
    assert.equal((await block(q.id)).text, updated);
    await paste("body", { image: true });
    await page.waitForFunction(
      () =>
        window.BookStudio.getProject().pages[0].blocks.filter(
          (b) => b.type === "image",
        ).length === 2,
    );

    await page.waitForFunction(() =>
      document
        .getElementById("save-status")
        .textContent.includes("Draft saved"),
    );
    await page.reload();
    await page.waitForFunction(() => window.BookStudio);
    assert.equal((await block(q.id)).text, updated);
    assert.equal((await block(htmlBox.id)).text, htmlBox.text);
    assert.deepEqual((await block(htmlBox.id)).runs, htmlBox.runs);
    assert.equal((await block(answer.id)).value, "4 groups");

    // A long new box opens at its final continuation so the next paste appends.
    await page.click("#add-page");
    const long = Array.from(
      { length: 100 },
      (_, i) => `Working step ${i + 1}.`,
    ).join("\n");
    await paste("body", { plain: long, image: true });
    const longBox = (await blocks()).at(-1);
    assert.equal(longBox.type, "text");
    assert.ok((await box(longBox.id).count()) > 1);
    await nativeClipboard("\nFinal answer.");
    await page.keyboard.press("Control+V");
    await page.waitForFunction(
      (id) =>
        window.BookStudio.getProject()
          .pages.flatMap((p) => p.blocks)
          .find((b) => b.id === id)
          .text.endsWith("\nFinal answer."),
      longBox.id,
    );
    assert.equal((await block(longBox.id)).text, long + "\nFinal answer.");
    await page.keyboard.press("Escape");
    assert.equal(
      (await box(longBox.id).allTextContents()).join(""),
      long + "\nFinal answer.",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Text-paste acceptance passed: real mixed-clipboard Ctrl+V, editable new boxes, selected-word replacement and formatting, HTML/plain fallbacks, answers/cells/banners, native inputs, image-only fidelity, autosave and continuation insertion.",
    );
  } finally {
    await page.close();
  }
};
