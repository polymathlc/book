import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudRepository,
  packProject,
  unpackProject,
  cloudEntries,
} from "../cloud-store.js";
import { blankProject, makeBlock, dotDiagram, validateProject } from "../core.js";
import { drawingFixtures, drawingGeometry } from "./draw-roundtrip-fixtures.mjs";
function fixture() {
  let data = {
    aiEngine: "openai",
    unrelatedPreference: true,
    bookStudioProjects: {},
  };
  const files = new Map();
  const firestore = {
    doc: (_, ...parts) => parts.join("/"),
    getDoc: async () => ({
      exists: () => true,
      data: () => structuredClone(data),
    }),
    runTransaction: async (_, fn) =>
      fn({
        get: async () => ({
          exists: () => true,
          data: () => structuredClone(data),
        }),
        set: (_, patch) => {
          data = {
            ...data,
            ...patch,
            bookStudioProjects: {
              ...data.bookStudioProjects,
              ...patch.bookStudioProjects,
            },
          };
        },
      }),
  };
  const storageSDK = {
    ref: (_, path) => path,
    uploadBytes: async (path, blob) => files.set(path, blob),
    getBlob: async (path) => files.get(path),
    deleteObject: async (path) => files.delete(path),
  };
  return {
    repository: createCloudRepository({
      db: {},
      firestore,
      storage: {},
      storageSDK,
      uid: "teacher",
    }),
    files,
    data: () => data,
  };
}
test("compressed cloud projects retain full original image bytes and formatting", async () => {
  const p = blankProject(),
    d = dotDiagram();
  p.pages[0].blocks = [
    makeBlock("image", {
      src: d.src,
      originalSrc: d.src,
      naturalWidth: 360,
      naturalHeight: 330,
    }),
    makeBlock("answer", {
      part: "b",
      value: "24 dots",
      fontFamily: "Roboto",
      underline: true,
    }),
  ];
  const packed = await packProject(p),
    q = await unpackProject(packed.blob, packed.compressed);
  assert.deepEqual(q, p);
  const f = fixture(),
    entry = await f.repository.save(p),
    loaded = await f.repository.load(entry);
  assert.deepEqual(loaded, p);
  assert.equal(f.data().aiEngine, "openai");
  assert.equal(f.data().unrelatedPreference, true);
  p.pages[0].blocks[1].value = "(b) 24 dots";
  const entry2 = await f.repository.save(p, entry.revision);
  assert.notEqual(entry2.revision, entry.revision);
  assert.equal((await f.repository.list()).length, 1);
  assert.equal(f.files.size, 1);
});
test("a stale device cannot overwrite a newer cloud revision", async () => {
  const f = fixture(),
    p = blankProject();
  p.pages[0].blocks = [makeBlock("text", { text: "Original" })];
  const first = await f.repository.save(p);
  p.title = "Newer device";
  const newer = await f.repository.save(p, first.revision);
  const stale = { ...p, title: "Stale device" };
  await assert.rejects(
    () => f.repository.save(stale, first.revision),
    (e) => e.code === "book/conflict",
  );
  assert.equal(f.data().bookStudioProjects[p.id].title, "Newer device");
  assert.equal(f.data().bookStudioProjects[p.id].revision, newer.revision);
  assert.equal(f.files.size, 1);
});

test("cloud save and reopen preserve narrow drawing and small snapped shape geometry", async () => {
  const f = fixture();
  let project = blankProject();
  const drawings = drawingFixtures();
  project.pages[0].blocks = drawings.map(({ block }) => block);
  const expected = drawings.map(({ block }) => drawingGeometry(block));
  let revision;
  for (let round = 1; round <= 3; round++) {
    const entry = await f.repository.save(project, revision);
    project = validateProject(await f.repository.load(entry));
    revision = entry.revision;
    project.pages[0].blocks.forEach((block, index) => {
      assert.deepEqual(drawingGeometry(block), expected[index], `${drawings[index].name}, cloud reopen ${round}`);
    });
  }
  assert.equal(f.files.size, 1, "old cloud revisions are removed");
});
test("cloud listing excludes another account and unexpected storage paths", () => {
  assert.deepEqual(
    cloudEntries(
      {
        bookStudioProjects: {
          safe: {
            id: "safe",
            ownerUid: "someoneElse",
            revision: "1",
            storagePath: "pdf-annotator/book-teacher-safe-1.book.json",
          },
        },
      },
      "teacher",
    ),
    [],
  );
  assert.deepEqual(
    cloudEntries(
      {
        bookStudioProjects: {
          safe: {
            id: "safe",
            ownerUid: "teacher",
            revision: "1",
            storagePath: "outside/something",
          },
        },
      },
      "teacher",
    ),
    [],
  );
});
