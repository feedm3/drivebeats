import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FolderListingInput,
  FolderListingRecord,
} from "@/lib/folder-cache-db";

// jsdom has no IndexedDB, so `idb` is backed by a tiny in-memory fake that
// mirrors the handful of methods the module under test uses. Records are held
// under the composite primary key, exactly like the real object store.
const records = new Map<string, FolderListingRecord>();
let openShouldFail = false;
let openCallCount = 0;

vi.mock("idb", () => ({
  openDB: (_name: string, _version: number) => {
    openCallCount += 1;
    if (openShouldFail) {
      return Promise.reject(new Error("SecurityError: storage is blocked"));
    }
    return Promise.resolve({
      getAll: async () => [...records.values()],
      getAllFromIndex: async (_store: string, _index: string, userId: string) =>
        [...records.values()].filter((record) => record.userId === userId),
      getAllKeys: async () => [...records.keys()],
      put: async (_store: string, value: FolderListingRecord) => {
        records.set(value.key, value);
      },
      delete: async (_store: string, key: string) => {
        records.delete(key);
      },
      clear: async () => {
        records.clear();
      },
    });
  },
}));

function makeRecord(userId: string, folderId: string): FolderListingInput {
  return {
    userId,
    folderId,
    files: [{ id: `${folderId}-1`, name: "a.mp3", mimeType: "audio/mpeg" }],
    fetchedAt: 1_000,
    lastAccessedAt: 1_000,
  };
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/folder-cache-db");
}

const USER_A = "111111111111111111111";
const USER_B = "222222222222222222222";

describe("folder-cache-db", () => {
  beforeEach(() => {
    records.clear();
    openShouldFail = false;
    openCallCount = 0;
    // jsdom does not implement IndexedDB; the module only checks for presence.
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      writable: true,
      configurable: true,
    });
  });

  it("round-trips, deletes and clears listings", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord(USER_A, "folder-a"));
    await db.putFolderListing(makeRecord(USER_A, "folder-b"));
    expect(await db.loadFolderListingsForUser(USER_A)).toHaveLength(2);

    await db.deleteFolderListings(USER_A, ["folder-a"]);
    const remaining = await db.loadFolderListingsForUser(USER_A);
    expect(remaining.map((record) => record.folderId)).toEqual(["folder-b"]);

    await db.clearFolderListings();
    expect(await db.loadFolderListingsForUser(USER_A)).toEqual([]);
  });

  it("never returns another account's listings", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord(USER_A, "shared-folder"));
    await db.putFolderListing(makeRecord(USER_B, "shared-folder"));

    // Same Drive folder id, two accounts: the composite key keeps both.
    expect(records.size).toBe(2);

    const forA = await db.loadFolderListingsForUser(USER_A);
    expect(forA).toHaveLength(1);
    expect(forA[0].userId).toBe(USER_A);

    // An account with nothing cached reads nothing, not the other account's
    // listing that happens to share the folder id.
    expect(await db.loadFolderListingsForUser("333")).toEqual([]);
  });

  it("deletes only the addressed account's listing", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord(USER_A, "shared-folder"));
    await db.putFolderListing(makeRecord(USER_B, "shared-folder"));

    await db.deleteFolderListings(USER_A, ["shared-folder"]);

    expect(await db.loadFolderListingsForUser(USER_A)).toEqual([]);
    expect(await db.loadFolderListingsForUser(USER_B)).toHaveLength(1);
  });

  it("clears one account without touching the other", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord(USER_A, "folder-a"));
    await db.putFolderListing(makeRecord(USER_A, "folder-b"));
    await db.putFolderListing(makeRecord(USER_B, "folder-c"));

    await db.clearFolderListingsForUser(USER_A);

    expect(await db.loadFolderListingsForUser(USER_A)).toEqual([]);
    expect(await db.loadFolderListingsForUser(USER_B)).toHaveLength(1);
  });

  it("evicts every account except the current one", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord(USER_A, "folder-a"));
    await db.putFolderListing(makeRecord(USER_B, "folder-b"));
    await db.putFolderListing(makeRecord("333", "folder-c"));

    await db.clearFolderListingsForOtherUsers(USER_B);

    expect(records.size).toBe(1);
    expect(await db.loadFolderListingsForUser(USER_B)).toHaveLength(1);
    expect(await db.loadFolderListingsForUser(USER_A)).toEqual([]);
  });

  it("ignores writes and reads with no account", async () => {
    const db = await loadModule();

    await db.putFolderListing(makeRecord("", "folder-a"));

    expect(records.size).toBe(0);
    expect(await db.loadFolderListingsForUser("")).toEqual([]);
  });

  it("degrades gracefully when opening the database fails", async () => {
    openShouldFail = true;
    const db = await loadModule();

    await expect(db.loadFolderListingsForUser(USER_A)).resolves.toEqual([]);
    await expect(
      db.putFolderListing(makeRecord(USER_A, "folder-a")),
    ).resolves.toBeUndefined();
    await expect(
      db.deleteFolderListings(USER_A, ["folder-a"]),
    ).resolves.toBeUndefined();
    await expect(
      db.clearFolderListingsForUser(USER_A),
    ).resolves.toBeUndefined();
    await expect(
      db.clearFolderListingsForOtherUsers(USER_A),
    ).resolves.toBeUndefined();
    await expect(db.clearFolderListings()).resolves.toBeUndefined();

    // The failed open is remembered instead of retried on every call.
    expect(openCallCount).toBe(1);
  });

  it("degrades gracefully when IndexedDB is missing entirely", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const db = await loadModule();

    await expect(db.loadFolderListingsForUser(USER_A)).resolves.toEqual([]);
    await expect(
      db.putFolderListing(makeRecord(USER_A, "folder-a")),
    ).resolves.toBeUndefined();
    expect(openCallCount).toBe(0);
  });
});
