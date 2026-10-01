// Reuse Ans Key's existing protected paths. The index lives in the account's
// adminSettings document; full projects live beside its large annotation files.
// Other apps' settings and pdfAnnotator worksheets are never overwritten.
export const cloudIndexPath = (uid) => ["adminSettings", uid];
const validId = (id) =>
  typeof id === "string" &&
  /^[\w-]{1,80}$/.test(id) &&
  !["__proto__", "constructor", "prototype"].includes(id);
export function cloudEntries(data, ownerUid) {
  return Object.entries(data?.bookStudioProjects || {})
    .filter(
      ([id, entry]) =>
        validId(id) &&
        entry &&
        entry.ownerUid === ownerUid &&
        entry.id === id &&
        typeof entry.revision === "string" &&
        typeof entry.storagePath === "string" &&
        entry.storagePath.startsWith(`pdf-annotator/book-${ownerUid}-${id}-`),
    )
    .map(([, entry]) => entry)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function contentStamp(text) {
  const bytes = new TextEncoder().encode(text),
    digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function packProject(project) {
  const text = JSON.stringify(project),
    raw = new Blob([text], { type: "application/json" });
  const blob =
    typeof CompressionStream === "function"
      ? await new Response(
          raw.stream().pipeThrough(new CompressionStream("gzip")),
        ).blob()
      : raw;
  return { blob, stamp: await contentStamp(text), compressed: blob !== raw };
}
export async function unpackProject(blob, compressed) {
  if (blob.size > 160 * 1024 * 1024)
    throw new Error("This cloud project exceeds the 160 MB limit.");
  if (compressed && typeof DecompressionStream !== "function")
    throw new Error(
      "This browser cannot open compressed projects. Use an up-to-date browser.",
    );
  const response = compressed
    ? new Response(blob.stream().pipeThrough(new DecompressionStream("gzip")))
    : new Response(blob);
  const text = await response.text();
  if (text.length > 220000000)
    throw new Error("This cloud project is too large to open.");
  return JSON.parse(text);
}
export function createCloudRepository({
  db,
  firestore,
  storage,
  storageSDK,
  uid: ownerUid,
  isCurrent = () => true,
}) {
  const index = firestore.doc(db, ...cloudIndexPath(ownerUid));
  const guard = () => {
    if (!isCurrent())
      throw new Error("The signed-in account changed. This save was stopped.");
  };
  async function list() {
    guard();
    const snapshot = await firestore.getDoc(index);
    guard();
    return cloudEntries(snapshot.exists() ? snapshot.data() : {}, ownerUid);
  }
  async function save(project, expectedRevision = "") {
    guard();
    const packed = await packProject(project);
    guard();
    if (packed.blob.size > 160 * 1024 * 1024)
      throw new Error(
        "This book exceeds the 160 MB cloud limit. Save a project file or split the book first.",
      );
    const id = project.id;
    if (!validId(id)) throw new Error("Invalid book identity.");
    const revision = crypto.randomUUID(),
      path = `pdf-annotator/book-${ownerUid}-${id}-${revision}.book.json${packed.compressed ? ".gz" : ""}`;
    const reference = storageSDK.ref(storage, path);
    const metadata = {
      id,
      ownerUid,
      revision,
      stamp: packed.stamp,
      storagePath: path,
      compressed: packed.compressed,
      bytes: packed.blob.size,
      title: String(project.title || "Untitled book").slice(0, 100),
      level: String(project.level || "").slice(0, 100),
      pages: project.pages.length,
      updatedAt: new Date().toISOString(),
    };
    let previousPath;
    try {
      await storageSDK.uploadBytes(reference, packed.blob, {
        contentType: packed.compressed
          ? "application/gzip"
          : "application/json",
        cacheControl: "private,no-store",
      });
      guard();
      await firestore.runTransaction(db, async (tx) => {
        guard();
        const snapshot = await tx.get(index),
          data = snapshot.exists() ? snapshot.data() : {};
        const books = data.bookStudioProjects || {},
          previous = books[id];
        if ((previous?.revision || "") !== expectedRevision) {
          const error = new Error(
            "This book was changed on another device. Open its cloud version or save your draft as a new cloud book.",
          );
          error.code = "book/conflict";
          throw error;
        }
        if (!previous && Object.keys(books).length >= 500)
          throw new Error(
            "This account's Book Studio index is full. Save a project file for this book.",
          );
        previousPath = previous?.storagePath;
        tx.set(
          index,
          { bookStudioProjects: { [id]: metadata }, bookStudioLastProject: id },
          { merge: true },
        );
      });
    } catch (error) {
      await storageSDK.deleteObject(reference).catch(() => {});
      throw error;
    }
    if (previousPath && previousPath !== path)
      storageSDK
        .deleteObject(storageSDK.ref(storage, previousPath))
        .catch(() => {});
    return metadata;
  }
  async function load(entry) {
    guard();
    if (
      !cloudEntries({ bookStudioProjects: { [entry.id]: entry } }, ownerUid)
        .length
    )
      throw new Error("Invalid cloud book.");
    const blob = await storageSDK.getBlob(
      storageSDK.ref(storage, entry.storagePath),
    );
    guard();
    const project = await unpackProject(blob, entry.compressed);
    if (project.id !== entry.id)
      throw new Error("The cloud book identity does not match its index.");
    if ((await contentStamp(JSON.stringify(project))) !== entry.stamp)
      throw new Error(
        "The cloud download is incomplete. Refresh the books list and open it again.",
      );
    return project;
  }
  return { list, save, load };
}
