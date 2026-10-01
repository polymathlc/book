import {
  pageContext,
  answerPrompt,
  parseAnswerResult,
  pageFingerprint,
} from "./ai-core.js";
import { makeBlock, uid } from "./core.js";

import {
  polymathServices as services,
  FIREBASE_SDK as SDK,
} from "./polymath-services.js";
async function sharedGrounding(s, project, context) {
  const { doc, getDoc, collection, getDocs } = s.storeSDK;
  const chunks = [];
  let status = "";
  try {
    const config = await getDoc(doc(s.db, "config", "admin"));
    const owner = config.exists() && config.data().uid;
    if (!owner)
      return {
        text: "",
        status:
          "No shared teaching-notes owner is configured. The page and your instructions are used.",
      };
    const results = await Promise.allSettled([
      getDocs(collection(s.db, "users", owner, "teachingNotes")),
      getDoc(doc(s.db, "users", owner, "aiTraining", "answerStyle")),
      getDoc(doc(s.db, "users", owner, "settings", "answerStyle")),
    ]);
    const normal = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const subject = normal(project.subject),
      level = normal(project.level)
        .replace("primary", "p")
        .replace("secondary", "s");
    const compatible = (item) => {
      const sub = normal(item.subject),
        lvl = normal(item.level)
          .replace("primary", "p")
          .replace("secondary", "s");
      return (
        (!sub ||
          sub === subject ||
          (sub === "math" && subject === "mathematics")) &&
        (!lvl || lvl === level)
      );
    };
    if (results[0].status === "fulfilled")
      results[0].value.forEach((record) => {
        const note = record.data();
        if (!compatible(note)) return;
        const guidance = String(note.guidance || "").trim();
        const keywords = Array.isArray(note.keywords) ? note.keywords : [];
        const relevant = keywords.some(
          (k) =>
            String(k).length > 2 &&
            context.text.toLowerCase().includes(String(k).toLowerCase()),
        );
        if (guidance)
          chunks.push(
            `Standing instruction (${note.title || "Teaching note"}): ${guidance}`,
          );
        if (relevant)
          for (const key of ["markingStandards", "keyFacts"])
            if (note[key])
              chunks.push(
                `${note.title || "Relevant note"}: ${String(note[key])}`,
              );
      });
    for (const result of results.slice(1))
      if (result.status === "fulfilled" && result.value.exists()) {
        const style = result.value.data(),
          profiles = style.profiles || {};
        const matching = Object.entries(profiles).find(
          ([key]) =>
            normal(key).includes(level) &&
            normal(key).includes(subject === "mathematics" ? "math" : subject),
        );
        const profile = matching?.[1] || profiles._global || style.profile;
        if (profile)
          for (const key of ["styleRules", "phrasing"])
            if (profile[key])
              chunks.push(`Teacher answer style: ${String(profile[key])}`);
        if (Array.isArray(style.edits))
          for (const edit of style.edits.filter(compatible).slice(-6)) {
            if (edit.lesson)
              chunks.push(`Teacher correction lesson: ${String(edit.lesson)}`);
            if (
              edit.q &&
              edit.a &&
              context.text.toLowerCase().includes(String(edit.q).toLowerCase())
            )
              chunks.push(`Matching teacher correction: ${edit.a}`);
          }
      }
    if (results.some((r) => r.status === "rejected"))
      status =
        "Some shared teaching notes could not be read with this account. Available notes, page context and your instructions are used.";
    else
      status = chunks.length
        ? "Shared Polymath teaching notes and answer style included."
        : "No matching shared notes. The page and your instructions are used.";
  } catch {
    status =
      "Shared teaching notes could not be read with this account. The page and your instructions are used.";
  }
  const text = chunks.join("\n");
  if (text.length > 60000)
    throw new Error(
      "The shared instructions are too long for one request. Shorten the teaching notes before generating.",
    );
  return { text, status };
}
async function callAI(s, prompt, media, isCurrent) {
  if (!s.auth.currentUser)
    throw new Error(
      "Sign in with your Polymath account to generate an answer.",
    );
  const failures = [];
  for (const [name, vendor] of [
    ["askOpenAi", "ChatGPT"],
    ["askKimi", "Kimi"],
  ]) {
    if (!isCurrent()) throw new Error("Generation cancelled.");
    try {
      const data = { prompt, media, json: true, maxOutputTokens: 8192 };
      if (name === "askOpenAi")
        Object.assign(data, {
          model: "gpt-6.1-sol",
          reasoningEffort: "medium",
        });
      const response = await s.fnsSDK.httpsCallable(s.functions, name, {
        timeout: 240000,
      })(data);
      if (!isCurrent()) throw new Error("Generation cancelled.");
      if (typeof response.data?.text !== "string" || !response.data.text.trim())
        throw new Error("Empty AI response.");
      return {
        text: response.data.text,
        route: response.data.model || vendor,
        fallback: failures.length > 0,
      };
    } catch (error) {
      if (!isCurrent()) throw new Error("Generation cancelled.");
      if (/unauthenticated|permission-denied/.test(error.code || ""))
        throw new Error(
          "This Polymath account is not authorised for the AI service. Sign in with your teacher account.",
        );
      failures.push(`${vendor}: ${error.message}`);
    }
  }
  if (!isCurrent()) throw new Error("Generation cancelled.");
  try {
    const aiSDK = await import(SDK + "firebase-ai.js");
    const model = aiSDK.getGenerativeModel(
      aiSDK.getAI(s.app, { backend: new aiSDK.GoogleAIBackend() }),
      { model: "gemini-3.8-flash" },
    );
    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, ...media.map((m) => ({ inlineData: m }))],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "medium" },
      },
    });
    if (!isCurrent()) throw new Error("Generation cancelled.");
    return { text: response.response.text(), route: "Gemini", fallback: true };
  } catch (error) {
    if (!isCurrent()) throw new Error("Generation cancelled.");
    throw new Error(
      "The shared AI services could not answer. " +
        [...failures, `Gemini: ${error.message}`].join(" · "),
    );
  }
}
async function pageMedia(svg) {
  const img = new Image(),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 1323;
    c.height = 1871;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // A separate reading copy; the worksheet's original image is never changed.
    const data = c.toDataURL("image/png").split(",")[1];
    c.width = c.height = 1;
    return { mimeType: "image/png", data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function createAIStudio(api) {
  const $ = (id) => document.getElementById(id),
    node = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
  let focusId = "",
    sourcePageId = "",
    generation = 0,
    busy = false,
    result = null,
    generatedFingerprint = "",
    generatedPageId = "";
  const sourcePage = () =>
    api.project().pages.find((p) => p.id === sourcePageId);
  function account(s) {
    const user = s.auth.currentUser;
    $("ai-account").textContent = user
      ? `Connected as ${user.email || "your Polymath account"}. Uses the same server AI connection as CER, Ans Key and Tutor.`
      : "Sign in with the same Polymath account you use in CER, Ans Key or Tutor.";
    $("ai-login").hidden = !!user;
  }
  function refreshContext() {
    const page = sourcePage();
    if (!page) return;
    focusId = $("ai-focus").value;
    $("ai-context").textContent = pageContext(
      api.project(),
      page,
      focusId,
    ).text;
    $("ai-images").replaceChildren(
      ...page.blocks
        .filter((b) => b.type === "image")
        .map((b) => {
          const img = node("img");
          img.src = b.src;
          img.alt = b.caption || b.name;
          return img;
        }),
    );
  }
  async function open(id = "") {
    api.finishText();
    sourcePageId = api.page().id;
    focusId = id || api.selected()[0] || "";
    result = null;
    $("ai-output").replaceChildren();
    $("ai-insert-actions").hidden = true;
    $("ai-status").textContent = "";
    $("ai-guidance").value = api.project().aiGuidance || "";
    $("ai-focus").replaceChildren();
    const all = node("option", "", "All questions on this page");
    all.value = "";
    $("ai-focus").append(all);
    for (const b of sourcePage().blocks.filter((b) =>
      ["text", "image", "answer", "table"].includes(b.type),
    )) {
      const option = node(
        "option",
        "",
        `${b.part ? `(${b.part}) ` : ""}${b.type === "text" ? b.text.slice(0, 80) || "Question text" : b.type === "image" ? b.name : b.type === "answer" ? b.text : "Table"}`,
      );
      option.value = b.id;
      $("ai-focus").append(option);
    }
    $("ai-focus").value = focusId;
    refreshContext();
    $("ai-dialog").showModal();
    $("ai-account").textContent = "Connecting to Polymath…";
    try {
      const s = await services();
      if ($("ai-dialog").open) account(s);
    } catch (error) {
      $("ai-account").textContent = error.message;
    }
  }
  function close() {
    generation++;
    busy = false;
    busyControls(false);
    $("ai-generate").disabled = false;
    $("ai-cancel").hidden = true;
    $("ai-dialog").close();
    $("ai-password").value = "";
  }
  function field(container, label, value, oninput) {
    const l = node("label", "", label),
      input = node("textarea");
    input.value = value;
    input.rows = label === "Working" ? 5 : 3;
    input.oninput = () => oninput(input.value);
    l.append(input);
    container.append(l);
  }
  function paintResult() {
    $("ai-output").replaceChildren();
    if (result.clarification)
      $("ai-output").append(node("p", "ai-warning", result.clarification));
    if (result.warnings.length)
      $("ai-output").append(
        node("p", "ai-warning", result.warnings.join("\n")),
      );
    if (result.verification)
      $("ai-output").append(
        node("p", "small-help", "Check: " + result.verification),
      );
    for (const answer of result.answers) {
      const box = node("section", "ai-result");
      box.append(
        node(
          "h3",
          "",
          answer.part ? `Part / question (${answer.part})` : "Answer",
        ),
      );
      field(
        box,
        "Part label",
        answer.part,
        (v) => (answer.part = v.slice(0, 12)),
      );
      for (const key of [
        "answer",
        "working",
        "explanation",
        "claim",
        "evidence",
        "reasoning",
      ])
        if (answer[key] || ["answer", "working", "explanation"].includes(key))
          field(
            box,
            {
              answer: "Answer",
              working: "Working",
              explanation: "Explanation",
              claim: "Claim",
              evidence: "Evidence",
              reasoning: "Reasoning",
            }[key],
            answer[key],
            (v) => (answer[key] = v),
          );
      $("ai-output").append(box);
    }
    for (const habit of result.habits) {
      const box = node("section", "ai-result");
      field(box, "Math Habit", habit.title, (v) => (habit.title = v));
      $("ai-output").append(box);
    }
    $("ai-insert-actions").hidden =
      !!result.clarification ||
      (!result.answers.length && !result.habits.length);
  }
  function busyControls(value) {
    for (const id of ["ai-focus", "ai-task", "ai-guidance"])
      $(id).disabled = value;
  }
  async function generate() {
    if (busy) return;
    if (
      !sourcePage()?.blocks.some((b) =>
        ["text", "image", "table"].includes(b.type),
      )
    ) {
      $("ai-status").textContent =
        "Add your question as text, a picture or a table first.";
      return;
    }
    const run = ++generation;
    busy = true;
    busyControls(true);
    result = null;
    $("ai-generate").disabled = true;
    $("ai-cancel").hidden = false;
    $("ai-output").replaceChildren();
    $("ai-insert-actions").hidden = true;
    const current = () => run === generation && $("ai-dialog").open;
    try {
      $("ai-status").textContent =
        "Reading the page text, questions, diagrams and existing answers…";
      const s = await services();
      if (!current()) return;
      account(s);
      if (!s.auth.currentUser)
        throw new Error("Sign in with your Polymath account first.");
      api.mutate(() => (api.project().aiGuidance = $("ai-guidance").value));
      const project = api.project(),
        page = sourcePage();
      const fingerprint = pageFingerprint(project, page),
        context = pageContext(project, page, $("ai-focus").value);
      const svgs = await api.pageImage(page.id);
      if (svgs.length > 12)
        throw new Error(
          "This page continues over more than 12 sheets. Divide the questions between manual pages to generate accurate answers.",
        );
      const media = await Promise.all(svgs.map(pageMedia));
      if (media.reduce((n, m) => n + m.data.length, 0) > 18000000)
        throw new Error(
          "These page images are too large for one AI request. Split the questions across manual pages first.",
        );
      const grounding = await sharedGrounding(s, project, context);
      if (!current()) return;
      $("ai-status").textContent =
        `Thinking through the arithmetic and checking the answer… ${grounding.status}`;
      const response = await callAI(
        s,
        answerPrompt(
          context,
          $("ai-task").value,
          project.aiGuidance,
          grounding.text,
        ),
        media,
        current,
      );
      if (!current()) return;
      if (pageFingerprint(api.project(), sourcePage()) !== fingerprint)
        throw new Error(
          "The question changed while AI was working. Generate again for the current page.",
        );
      result = parseAnswerResult(response.text);
      generatedFingerprint = fingerprint;
      generatedPageId = page.id;
      paintResult();
      $("ai-status").textContent =
        `Generated by ${response.route}${response.fallback ? " using a backup engine" : ""}. ${grounding.status} Review or edit the fields before adding them.`;
    } catch (error) {
      if (current()) $("ai-status").textContent = error.message;
    } finally {
      if (current()) {
        busy = false;
        busyControls(false);
        $("ai-generate").disabled = false;
        $("ai-cancel").hidden = true;
      }
    }
  }
  function resultText() {
    if (!result) return "";
    return [
      result.clarification,
      ...result.warnings,
      result.verification ? "Check: " + result.verification : "",
      ...result.answers.map((a) =>
        [
          a.part ? `(${a.part})` : "",
          a.answer,
          a.working,
          a.explanation,
          ...["claim", "evidence", "reasoning"]
            .filter((k) => a[k])
            .map((k) => `${k[0].toUpperCase() + k.slice(1)}: ${a[k]}`),
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      ...result.habits.map((h) => "Math Habit: " + h.title),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  function insert(newPage = false) {
    if (!result || result.clarification) return;
    const page = api.project().pages.find((p) => p.id === generatedPageId);
    if (
      !page ||
      pageFingerprint(api.project(), page) !== generatedFingerprint
    ) {
      $("ai-status").textContent =
        "The source question changed. Generate again before inserting.";
      return;
    }
    const blocks = [];
    if (newPage)
      blocks.push(makeBlock("text", { text: "Answer key", style: "heading" }));
    for (const a of result.answers) {
      if (a.answer)
        blocks.push(
          makeBlock("answer", {
            part: a.part.replace(/[()]/g, ""),
            value: a.answer,
            showLine: false,
          }),
        );
      if (a.working)
        blocks.push(
          makeBlock("text", {
            part: a.part.replace(/[()]/g, ""),
            text: a.working,
          }),
        );
      if (a.explanation)
        blocks.push(makeBlock("text", { text: a.explanation }));
      for (const key of ["claim", "evidence", "reasoning"])
        if (a[key])
          blocks.push(
            makeBlock("text", {
              text: `${key[0].toUpperCase() + key.slice(1)}: ${a[key]}`,
            }),
          );
    }
    for (const h of result.habits)
      if (h.title.trim())
        blocks.push(
          makeBlock("habit", {
            number: String(
              blocks.filter((b) => b.type === "habit").length + 1,
            ).padStart(2, "0"),
            title: h.title.trim(),
          }),
        );
    api.insertBlocks(blocks, newPage, generatedPageId);
    close();
    api.toast(
      newPage
        ? "Answer key added on a new page."
        : "Answers and workings added. You can edit every field.",
    );
  }
  $("ai-tools").onclick = () => open();
  $("ai-close").onclick = close;
  $("ai-dialog").addEventListener("cancel", close);
  $("ai-focus").onchange = () => {
    result = null;
    $("ai-output").replaceChildren();
    $("ai-insert-actions").hidden = true;
    refreshContext();
  };
  $("ai-generate").onclick = generate;
  $("ai-cancel").onclick = () => {
    generation++;
    busy = false;
    busyControls(false);
    $("ai-generate").disabled = false;
    $("ai-cancel").hidden = true;
    $("ai-status").textContent =
      "Generation cancelled. A request already sent to the server may finish there, but its result will not be added.";
  };
  $("ai-insert").onclick = () => insert(false);
  $("ai-new-page").onclick = () => insert(true);
  $("ai-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(resultText());
      api.toast("AI answer copied.");
    } catch {
      api.toast("Select and copy the answer text in the fields.");
    }
  };
  async function signIn(action) {
    try {
      const s = await services();
      await action(s);
      account(s);
      $("ai-password").value = "";
      $("ai-status").textContent =
        "Connected. Choose Generate to read this page.";
    } catch (error) {
      $("ai-status").textContent = "Sign-in failed: " + error.message;
    }
  }
  $("ai-google").onclick = () =>
    signIn((s) =>
      s.authSDK.signInWithPopup(s.auth, new s.authSDK.GoogleAuthProvider()),
    );
  $("ai-email-signin").onclick = () =>
    signIn((s) =>
      s.authSDK.signInWithEmailAndPassword(
        s.auth,
        $("ai-email").value.trim(),
        $("ai-password").value,
      ),
    );
  return { open };
}
