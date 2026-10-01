import { polymathServices, FIREBASE_SDK } from "./polymath-services.js";
import { createCloudRepository, contentStamp } from "./cloud-store.js";
import { uid, clone } from "./core.js";

export function createCloudSync(api) {
  const $ = (id) => document.getElementById(id);
  let session = null,
    repository = null,
    accountUid = "",
    timer,
    inFlight = false,
    queued = false,
    paused = false,
    sequence = 0,
    revision = "",
    bookId = "",
    lastStamp = "",
    lastJSON = "",
    stoppedAuth;
  const stateKey = () => `BookStudio:cloud:${accountUid}:${api.project().id}`;
  const status = (message) => {
    $("cloud-status").textContent = message;
  };
  function message(text) {
    $("cloud-message").textContent = text;
  }
  function restoreBinding() {
    bookId = api.project().id;
    revision = "";
    lastStamp = "";
    lastJSON = "";
    paused = false;
    try {
      const saved = JSON.parse(localStorage.getItem(stateKey()) || "null");
      if (saved) {
        revision = saved.revision || "";
        lastStamp = saved.stamp || "";
      }
    } catch {}
  }
  function persistBinding() {
    try {
      localStorage.setItem(
        stateKey(),
        JSON.stringify({ revision, stamp: lastStamp }),
      );
    } catch {}
  }
  async function attach(user) {
    sequence++;
    accountUid = user?.uid || "";
    repository = null;
    clearTimeout(timer);
    paused = false;
    $("cloud-login").hidden = !!user;
    $("cloud-signout").hidden = !user;
    $("cloud-account").textContent = user
      ? `Signed in as ${user.email || "your Polymath account"}. Cloud autosave is on.`
      : "Sign in with your Polymath account to turn on cloud autosave.";
    if (!user) {
      status("Cloud: sign in");
      return;
    }
    const active = sequence;
    try {
      const storageSDK = await import(FIREBASE_SDK + "firebase-storage.js");
      if (active !== sequence) return;
      repository = createCloudRepository({
        db: session.db,
        firestore: session.storeSDK,
        storage: storageSDK.getStorage(session.app),
        storageSDK,
        uid: user.uid,
        isCurrent: () => session.auth.currentUser?.uid === user.uid,
      });
      restoreBinding();
      status("Cloud: checking…");
      schedule();
      if ($("cloud-dialog").open) await refresh();
    } catch (error) {
      status("Cloud unavailable");
      message(error.message);
    }
  }
  async function start() {
    try {
      session = await polymathServices();
      stoppedAuth?.();
      stoppedAuth = session.authSDK.onAuthStateChanged(session.auth, attach);
    } catch (error) {
      status("Cloud: connection needed");
      message(error.message);
    }
  }
  function schedule() {
    if (!repository || paused) return;
    if (bookId !== api.project().id) restoreBinding();
    const json = JSON.stringify(api.project());
    if (json === lastJSON) return;
    status(
      navigator.onLine
        ? "Cloud: changes pending"
        : "Cloud: offline · draft kept",
    );
    clearTimeout(timer);
    timer = setTimeout(save, 2500);
  }
  async function save() {
    clearTimeout(timer);
    timer = null;
    if (!repository || paused) return false;
    if (inFlight) {
      queued = true;
      return false;
    }
    if (!navigator.onLine) {
      status("Cloud: offline · draft kept");
      return false;
    }
    if (bookId !== api.project().id) restoreBinding();
    const project = clone(api.project()),
      json = JSON.stringify(project);
    if (!project.pages.some((p) => p.blocks.length) && !revision) {
      status("Cloud: ready");
      return true;
    }
    if (json === lastJSON) {
      status("Cloud: saved");
      return true;
    }
    inFlight = true;
    const active = sequence,
      activeRepo = repository,
      expectedRevision = revision;
    status("Cloud: saving…");
    message("Saving the complete project and original images…");
    try {
      const stamp = await contentStamp(json);
      if (active !== sequence) return false;
      if (stamp === lastStamp) {
        lastJSON = json;
        status("Cloud: saved");
        return true;
      }
      const metadata = await activeRepo.save(project, expectedRevision);
      if (active !== sequence) return false;
      try {
        localStorage.setItem(
          `BookStudio:cloud:${accountUid}:${project.id}`,
          JSON.stringify({
            revision: metadata.revision,
            stamp: metadata.stamp,
          }),
        );
      } catch {}
      if (api.project().id !== project.id) {
        queued = true;
        return false;
      }
      revision = metadata.revision;
      lastStamp = metadata.stamp;
      lastJSON = json;
      persistBinding();
      status("Cloud: saved");
      message(
        "All changes saved to Firebase. Original image quality is preserved.",
      );
      if ($("cloud-dialog").open) await refresh();
      return true;
    } catch (error) {
      if (active !== sequence) return false;
      if (error.code === "book/conflict") {
        paused = true;
        status("Cloud: newer version exists");
      } else if (/unauthorized|permission-denied/.test(error.code || "")) {
        paused = true;
        status("Cloud: access denied");
      } else {
        status("Cloud: retry needed · draft kept");
        timer = setTimeout(save, 15000);
      }
      message(
        error.message +
          " Your device draft and project download are still available.",
      );
      return false;
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        schedule();
      } else if (
        active === sequence &&
        repository &&
        !paused &&
        JSON.stringify(api.project()) !== lastJSON &&
        !timer
      )
        schedule();
    }
  }
  async function refresh() {
    if (!repository) return;
    try {
      const entries = await repository.list();
      $("cloud-list").replaceChildren();
      if (!entries.length) {
        const p = document.createElement("p");
        p.className = "small-help";
        p.textContent = "Your first book appears here after autosave.";
        $("cloud-list").append(p);
      }
      for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "cloud-book";
        const info = document.createElement("div"),
          title = document.createElement("strong"),
          detail = document.createElement("span"),
          open = document.createElement("button");
        title.textContent = entry.title;
        detail.textContent = `${entry.pages} ${entry.pages === 1 ? "page" : "pages"} · ${entry.level} · ${new Date(entry.updatedAt).toLocaleString()}`;
        info.append(title, detail);
        open.textContent = "Open";
        open.onclick = () => load(entry);
        row.append(info, open);
        $("cloud-list").append(row);
      }
    } catch (error) {
      message("Could not read cloud books: " + error.message);
    }
  }
  async function load(entry) {
    if (inFlight) {
      message("Wait for the current cloud save to finish, then open the book.");
      return;
    }
    if (
      !(await api.confirm(
        "Open this cloud book?",
        "Your current device draft can be restored with Undo. Save project first if you want a separate copy.",
      ))
    )
      return;
    clearTimeout(timer);
    const active = ++sequence,
      repo = repository;
    status("Cloud: opening…");
    try {
      const project = await repo.load(entry);
      if (active !== sequence) return;
      api.openProject(project);
      bookId = api.project().id;
      revision = entry.revision;
      lastStamp = entry.stamp;
      lastJSON = JSON.stringify(api.project());
      paused = false;
      persistBinding();
      status("Cloud: saved");
      message("Cloud book opened.");
      $("cloud-dialog").close();
    } catch (error) {
      status("Cloud: open failed");
      message(error.message);
    }
  }
  async function open() {
    api.finishText();
    $("cloud-dialog").showModal();
    if (!session) await start();
    if (repository) await refresh();
  }
  async function signIn(action) {
    try {
      session = await polymathServices();
      await action(session);
      $("cloud-password").value = "";
      if (!stoppedAuth) await start();
      message("Signed in. Cloud autosave is on.");
    } catch (error) {
      message("Sign-in failed: " + error.message);
    }
  }
  $("cloud-books").onclick = open;
  $("cloud-close").onclick = () => {
    $("cloud-dialog").close();
    $("cloud-password").value = "";
  };
  $("cloud-google").onclick = () =>
    signIn((s) =>
      s.authSDK.signInWithPopup(s.auth, new s.authSDK.GoogleAuthProvider()),
    );
  $("cloud-email-signin").onclick = () =>
    signIn((s) =>
      s.authSDK.signInWithEmailAndPassword(
        s.auth,
        $("cloud-email").value.trim(),
        $("cloud-password").value,
      ),
    );
  $("cloud-signout").onclick = async () => {
    if (session) {
      await save();
      await session.authSDK.signOut(session.auth);
      message("Signed out. The device draft is still available.");
    }
  };
  $("cloud-save-now").onclick = () => {
    paused = false;
    save();
  };
  $("cloud-save-copy").onclick = async () => {
    if (inFlight) {
      message("Wait for the current save to finish first.");
      return;
    }
    api.mutate(() => (api.project().id = uid()));
    restoreBinding();
    await save();
  };
  $("cloud-refresh").onclick = refresh;
  window.addEventListener("online", () => {
    if (!paused) {
      schedule();
      message("Connection restored. Pending changes will save automatically.");
    }
  });
  window.addEventListener("offline", () =>
    status("Cloud: offline · draft kept"),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      api.saveDevice();
      save();
    }
  });
  window.addEventListener("pagehide", () => api.saveDevice());
  window.addEventListener("beforeunload", (e) => {
    if (repository && JSON.stringify(api.project()) !== lastJSON) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  return { start, schedule, save };
}
