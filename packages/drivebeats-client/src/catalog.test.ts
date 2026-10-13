import { FOLDER_MIME } from "@drivebeats/core/types";
import { expect, it } from "vitest";
import { buildCatalog, catalogPage, type LibraryReader } from "./catalog";

const folder = (id: string, name = id) => ({ id, name, mimeType: FOLDER_MIME });
const track = (id: string, name = `${id}.mp3`) => ({
  id,
  name,
  mimeType: "audio/mpeg",
});
it("indexes every page and subtree, including tracks absent from cloud collections, without leaving imports", async () => {
  const reads: string[] = [];
  const reader: LibraryReader = {
    async readItem(id) {
      return id === "root-a" ? folder(id) : track(id);
    },
    async readFolder(id, token) {
      reads.push(id);
      return id === "root-a"
        ? token
          ? { files: [track("hidden", "night drive.mp3")] }
          : { files: [folder("nested")], nextPageToken: "page-2" }
        : { files: [track("deep")] };
    },
  };
  const catalog = await buildCatalog(
    "account-a",
    ["root-a"],
    ["single"],
    reader,
  );
  expect(reads).toEqual(["root-a", "root-a", "nested"]);
  expect(
    catalogPage(catalog, { query: "DRIVE night" }).items.map((file) => file.id),
  ).toEqual(["hidden"]);
  expect(catalogPage(catalog, { folderId: "nested" }).items[0]?.path).toBe(
    "root-a/nested/deep.mp3",
  );
  expect(catalogPage(catalog, { limit: 1 }).nextCursor).toContain(catalog.id);
  expect(() => catalogPage(catalog, { cursor: "stale:1" })).toThrow(
    "Library changed",
  );
});
it("never publishes a partial generation when a later folder read fails or cancellation occurs", async () => {
  const reader: LibraryReader = {
    async readItem(id) {
      return folder(id);
    },
    async readFolder(_id, token) {
      if (token) throw new Error("access expired");
      return { files: [track("first")], nextPageToken: "next" };
    },
  };
  await expect(buildCatalog("a", ["root-a"], [], reader)).rejects.toThrow(
    "access expired",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    buildCatalog("a", ["root-a"], [], reader, controller.signal),
  ).rejects.toThrow();
});
it("bounds pages and preserves explicit roots when imports overlap", async () => {
  const catalog = await buildCatalog("a", ["outer", "inner"], [], {
    async readItem(id) {
      return folder(id);
    },
    async readFolder(id) {
      return {
        files:
          id === "outer"
            ? [
                folder("inner"),
                ...Array.from({ length: 120 }, (_, index) =>
                  track(String(index)),
                ),
              ]
            : [track("child")],
      };
    },
  });
  expect(catalog.entries.filter((entry) => entry.id === "inner")).toHaveLength(
    1,
  );
  expect(catalog.entries.find((entry) => entry.id === "inner")?.parentId).toBe(
    "root",
  );
  expect(catalogPage(catalog, { limit: 900 }).items).toHaveLength(100);
});
it("paginates by UTF-8 byte budget for long paths and resumes after the actual emitted item count", () => {
  const catalog = {
    id: "generation",
    accountId: "a",
    rootIds: [],
    standaloneIds: [],
    entries: Array.from({ length: 100 }, (_, index) => ({
      ...track(String(index), "音".repeat(500)),
      parentId: "root",
      path: "音".repeat(3000),
    })),
  };
  const page = catalogPage(catalog, { limit: 100 });
  expect(
    new TextEncoder().encode(JSON.stringify(page)).byteLength,
  ).toBeLessThan(24000);
  expect(page.items.length).toBeGreaterThan(0);
  expect(page.items.length).toBeLessThan(100);
  const next = catalogPage(catalog, {
    limit: 100,
    cursor: page.nextCursor ?? undefined,
  });
  expect(next.items[0]?.id).toBe(String(page.items.length));
});
it("binds cursors to the filename query and folder, rejects unsafe offsets", () => {
  const catalog = {
    id: "g",
    accountId: "a",
    rootIds: [],
    standaloneIds: [],
    entries: [
      { ...track("one"), parentId: "root", path: "one.mp3" },
      { ...track("two"), parentId: "root", path: "two.mp3" },
    ],
  };
  const searched = catalogPage(catalog, { query: "mp3", limit: 1 });
  expect(() =>
    catalogPage(catalog, {
      query: "one",
      cursor: searched.nextCursor ?? undefined,
    }),
  ).toThrow("another search");
  const browsed = catalogPage(catalog, { folderId: "root", limit: 1 });
  expect(() =>
    catalogPage(catalog, {
      folderId: "elsewhere",
      cursor: browsed.nextCursor ?? undefined,
    }),
  ).toThrow("another search");
  const cursor = `g:${btoa(JSON.stringify(["mp3", null, Number.MAX_SAFE_INTEGER + 1]))}`;
  expect(() => catalogPage(catalog, { query: "mp3", cursor })).toThrow(
    "another search",
  );
  const outside = `g:${btoa(JSON.stringify(["mp3", null, 99]))}`;
  expect(() => catalogPage(catalog, { query: "mp3", cursor: outside })).toThrow(
    "outside",
  );
});
it("includes supported filenames with generic provider MIME types for folder and standalone imports", async () => {
  const catalog = await buildCatalog("account", ["music"], ["single"], {
    async readItem(id) {
      return id === "music"
        ? folder(id)
        : { id, name: "Standalone.mp3", mimeType: "application/octet-stream" };
    },
    async readFolder() {
      return {
        files: [
          {
            id: "nested-track",
            name: "Nested.m4a",
            mimeType: "application/octet-stream",
          },
          { id: "unsupported", name: "Notes.txt", mimeType: "text/plain" },
        ],
      };
    },
  });
  expect(
    catalogPage(catalog, { query: "" })
      .items.map((file) => file.id)
      .toSorted(),
  ).toEqual(["nested-track", "single"]);
});
