import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySearchCatalogRecord } from "@/lib/library-search-catalog-db";

const records = new Map<string, LibrarySearchCatalogRecord>();
let storageFails = false;

vi.mock("idb", () => ({
  openDB: () => {
    if (storageFails) {
      return Promise.reject(new Error("storage unavailable"));
    }
    return Promise.resolve({
      get: async (_store: string, key: string) => records.get(key),
      getAllKeys: async () => [...records.keys()],
      put: async (_store: string, record: LibrarySearchCatalogRecord) => {
        records.set(record.userId, structuredClone(record));
      },
      delete: async (_store: string, key: string) => records.delete(key),
      clear: async () => records.clear(),
    });
  },
}));

function generation(
  userId: string,
  trackId: string,
): LibrarySearchCatalogRecord {
  return {
    userId,
    fetchedAt: 1_000,
    importsSignature: "music",
    tracks: [
      {
        id: trackId,
        name: `${trackId}.mp3`,
        mimeType: "audio/mpeg",
        contextLabel: "Music",
        folderStack: [
          { id: "root", name: "Library" },
          { id: "music", name: "Music" },
        ],
        importedRootId: "music",
        importedRootPaths: [
          {
            contextLabel: "Music",
            folderStack: [
              { id: "root", name: "Library" },
              { id: "music", name: "Music" },
            ],
            importedRootId: "music",
            relativePath: "",
          },
        ],
        relativePath: "",
      },
    ],
  };
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/library-search-catalog-db");
}

describe("Library Search catalog persistence", () => {
  beforeEach(() => {
    records.clear();
    storageFails = false;
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      configurable: true,
    });
  });

  it("atomically replaces one account generation without exposing another", async () => {
    const db = await loadModule();
    await expect(
      db.replaceLibrarySearchCatalog(generation("a", "old")),
    ).resolves.toBe(true);
    await expect(
      db.replaceLibrarySearchCatalog(generation("b", "other")),
    ).resolves.toBe(true);
    await expect(
      db.replaceLibrarySearchCatalog(generation("a", "fresh")),
    ).resolves.toBe(true);

    expect((await db.loadLibrarySearchCatalog("a"))?.tracks[0].id).toBe(
      "fresh",
    );
    expect((await db.loadLibrarySearchCatalog("b"))?.tracks[0].id).toBe(
      "other",
    );
  });

  it("can clear one account, other accounts, or every generation", async () => {
    const db = await loadModule();
    await db.replaceLibrarySearchCatalog(generation("a", "one"));
    await db.replaceLibrarySearchCatalog(generation("b", "two"));

    await db.clearLibrarySearchCatalogsForOtherUsers("b");
    expect(await db.loadLibrarySearchCatalog("a")).toBeNull();
    expect(await db.loadLibrarySearchCatalog("b")).not.toBeNull();

    await db.clearLibrarySearchCatalogForUser("b");
    expect(await db.loadLibrarySearchCatalog("b")).toBeNull();

    await db.replaceLibrarySearchCatalog(generation("a", "again"));
    await db.clearLibrarySearchCatalogs();
    expect(records.size).toBe(0);
  });

  it("reports unavailable durable storage so callers can keep a session catalog", async () => {
    storageFails = true;
    const db = await loadModule();

    await expect(
      db.replaceLibrarySearchCatalog(generation("a", "one")),
    ).resolves.toBe(false);
    await expect(db.loadLibrarySearchCatalog("a")).resolves.toBeNull();
  });
});
