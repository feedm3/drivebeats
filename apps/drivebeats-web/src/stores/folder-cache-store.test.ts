import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FolderListingInput,
  FolderListingRecord,
} from "@/lib/folder-cache-db";
import type { DriveFile } from "@/types";

// Stands in for IndexedDB: it outlives `vi.resetModules()`, so re-importing the
// store simulates a cold start of the PWA against the same device storage.
// Records are held under the same composite `${userId}\0${folderId}` key the
// real object store uses.
const persisted = new Map<string, FolderListingRecord>();
let storageThrows = false;

function failIfBroken() {
  if (storageThrows) throw new Error("IndexedDB unavailable");
}

function keyFor(userId: string, folderId: string) {
  return `${userId}\u0000${folderId}`;
}

vi.mock("@/lib/folder-cache-db", () => ({
  loadFolderListingsForUser: async (userId: string) => {
    failIfBroken();
    return [...persisted.values()]
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record }));
  },
  putFolderListing: async (record: FolderListingInput) => {
    failIfBroken();
    const key = keyFor(record.userId, record.folderId);
    persisted.set(key, { ...record, key });
  },
  deleteFolderListings: async (userId: string, folderIds: string[]) => {
    failIfBroken();
    for (const folderId of folderIds)
      persisted.delete(keyFor(userId, folderId));
  },
  clearFolderListingsForUser: async (userId: string) => {
    failIfBroken();
    for (const [key, record] of persisted) {
      if (record.userId === userId) persisted.delete(key);
    }
  },
  clearFolderListingsForOtherUsers: async (userId: string) => {
    failIfBroken();
    for (const [key, record] of persisted) {
      if (record.userId !== userId) persisted.delete(key);
    }
  },
  clearFolderListings: async () => {
    failIfBroken();
    persisted.clear();
  },
}));

const USER_A = "111111111111111111111";
const USER_B = "222222222222222222222";

function makeFile(id: string): DriveFile {
  return { id, name: `${id}.mp3`, mimeType: "audio/mpeg" } as DriveFile;
}

// The store estimates ~160 bytes of overhead plus two bytes per name code
// unit, so a 920-character name makes each file cost exactly 2,000 bytes and
// listing sizes easy to reason about in tests.
const PADDED_NAME_LENGTH = 920;
const BYTES_PER_PADDED_FILE = 2_000;

function makePaddedFile(id: string): DriveFile {
  return {
    id,
    name: id.padEnd(PADDED_NAME_LENGTH, "x"),
    mimeType: "audio/mpeg",
  } as DriveFile;
}

function makeListing(count: number, prefix: string): DriveFile[] {
  return Array.from({ length: count }, (_, index) =>
    makePaddedFile(`${prefix}-${index}`),
  );
}

function persistedFor(userId: string, folderId: string) {
  return persisted.get(keyFor(userId, folderId));
}

const ACTIVE_USER_STORAGE_KEY = "drivebeats-folder-cache-user";

function rememberedUserId() {
  return window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
}

function userFor(id: string) {
  return { id, email: `${id}@example.com`, name: null, picture: null };
}

/**
 * Re-imports both stores in a fresh module registry. The auth user is set
 * before the folder cache module evaluates, mirroring a page load where the
 * session is already known; passing `null` mirrors an offline launch with no
 * live session at all.
 */
async function prepareModules(userId: string | null) {
  vi.resetModules();
  const { useAuthStore } = await import("@/stores/auth-store");
  if (userId) {
    useAuthStore.setState({
      user: userFor(userId),
      authStatus: "authenticated",
    });
  }
  const { useFolderCacheStore } = await import("@/stores/folder-cache-store");
  return { authStore: useAuthStore, store: useFolderCacheStore };
}

async function loadStore(userId: string | null = USER_A) {
  const modules = await prepareModules(userId);
  await modules.store.getState().hydrate();
  return modules;
}

/** Lets the best-effort background persistence promises settle. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe("useFolderCacheStore persistence", () => {
  beforeEach(() => {
    persisted.clear();
    storageThrows = false;
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes listings to storage under the signed-in account", async () => {
    const { store } = await loadStore();

    store.getState().setFiles("folder-a", [makeFile("1")]);

    expect(store.getState().getFiles("folder-a")?.files).toHaveLength(1);
    expect(persistedFor(USER_A, "folder-a")?.files[0].id).toBe("1");
    expect(persistedFor(USER_A, "folder-a")?.fetchedAt).toBe(Date.now());
    expect(persistedFor(USER_A, "folder-a")?.userId).toBe(USER_A);
  });

  it("restores listings after a restart without refetching", async () => {
    const { store: first } = await loadStore();
    first.getState().setFiles("folder-a", [makeFile("1"), makeFile("2")]);

    const { store: restarted } = await loadStore();

    expect(restarted).not.toBe(first);
    const entry = restarted.getState().getFiles("folder-a");
    expect(entry?.files.map((file) => file.id)).toEqual(["1", "2"]);
    expect(restarted.getState().hydrated).toBe(true);
  });

  it("keeps the 5-minute staleness window across a restart", async () => {
    const { store: first } = await loadStore();
    first.getState().setFiles("folder-a", [makeFile("1")]);

    vi.setSystemTime(Date.now() + 4 * MINUTE);
    let restarted = (await loadStore()).store;
    expect(restarted.getState().getFiles("folder-a")).not.toBeNull();
    expect(restarted.getState().isStale("folder-a")).toBe(false);

    vi.setSystemTime(Date.now() + 2 * MINUTE);
    restarted = (await loadStore()).store;
    // Stale-while-revalidate: content is still served, it just needs a refresh.
    expect(restarted.getState().getFiles("folder-a")?.files).toHaveLength(1);
    expect(restarted.getState().isStale("folder-a")).toBe(true);
  });

  it("does not overwrite listings fetched while hydration is in flight", async () => {
    persisted.set(keyFor(USER_A, "folder-a"), {
      key: keyFor(USER_A, "folder-a"),
      userId: USER_A,
      folderId: "folder-a",
      files: [makeFile("old")],
      fetchedAt: Date.now() - 10 * MINUTE,
      lastAccessedAt: Date.now() - 10 * MINUTE,
    });

    const { store } = await prepareModules(USER_A);
    store.getState().setFiles("folder-a", [makeFile("fresh")]);
    await store.getState().hydrate();

    expect(store.getState().getFiles("folder-a")?.files[0].id).toBe("fresh");
  });

  it("drops entries that were invalidated while hydration was in flight", async () => {
    persisted.set(keyFor(USER_A, "folder-a"), {
      key: keyFor(USER_A, "folder-a"),
      userId: USER_A,
      folderId: "folder-a",
      files: [makeFile("1")],
      fetchedAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    const { store } = await prepareModules(USER_A);
    store.getState().invalidate("folder-a");
    await store.getState().hydrate();
    await flush();

    expect(store.getState().getFiles("folder-a")).toBeNull();
    expect(persistedFor(USER_A, "folder-a")).toBeUndefined();
  });

  it("evicts the least recently used folder past the cap", async () => {
    const { store } = await loadStore();

    // 200 folders is the cap; write them one minute apart so folder-0 is the
    // least recently used.
    for (let i = 0; i < 200; i += 1) {
      vi.setSystemTime(Date.now() + MINUTE);
      store.getState().setFiles(`folder-${i}`, [makeFile(String(i))]);
    }
    expect(store.getState().cache.size).toBe(200);

    // Reading folder-0 makes folder-1 the least recently used instead.
    vi.setSystemTime(Date.now() + MINUTE);
    expect(store.getState().getFiles("folder-0")).not.toBeNull();

    vi.setSystemTime(Date.now() + MINUTE);
    store.getState().setFiles("folder-new", [makeFile("new")]);
    await flush();

    expect(store.getState().cache.size).toBe(200);
    expect(store.getState().getFiles("folder-1")).toBeNull();
    expect(persistedFor(USER_A, "folder-1")).toBeUndefined();
    expect(store.getState().getFiles("folder-0")).not.toBeNull();
    expect(persistedFor(USER_A, "folder-0")).toBeDefined();
    expect(persistedFor(USER_A, "folder-new")).toBeDefined();
  });

  it("evicts entries that have not been used for two weeks", async () => {
    persisted.set(keyFor(USER_A, "folder-old"), {
      key: keyFor(USER_A, "folder-old"),
      userId: USER_A,
      folderId: "folder-old",
      files: [makeFile("1")],
      fetchedAt: Date.now() - 20 * DAY,
      lastAccessedAt: Date.now() - 15 * DAY,
    });
    persisted.set(keyFor(USER_A, "folder-recent"), {
      key: keyFor(USER_A, "folder-recent"),
      userId: USER_A,
      folderId: "folder-recent",
      files: [makeFile("2")],
      fetchedAt: Date.now() - 20 * DAY,
      lastAccessedAt: Date.now() - 13 * DAY,
    });

    const { store } = await loadStore();
    await flush();

    expect(store.getState().getFiles("folder-old")).toBeNull();
    expect(persistedFor(USER_A, "folder-old")).toBeUndefined();
    // Old but still used recently: stale, kept, revalidated on next open.
    expect(store.getState().getFiles("folder-recent")).not.toBeNull();
    expect(store.getState().isStale("folder-recent")).toBe(true);
  });

  it("clears memory and storage", async () => {
    const { store } = await loadStore();
    store.getState().setFiles("folder-a", [makeFile("1")]);

    store.getState().clear();
    await flush();

    expect(store.getState().cache.size).toBe(0);
    expect(persisted.size).toBe(0);
  });

  it("keeps working in memory when storage throws", async () => {
    storageThrows = true;

    const { store } = await loadStore();
    expect(store.getState().hydrated).toBe(true);

    store.getState().setFiles("folder-a", [makeFile("1")]);
    expect(store.getState().getFiles("folder-a")?.files).toHaveLength(1);
    expect(store.getState().isStale("folder-a")).toBe(false);

    store.getState().invalidate("folder-a");
    expect(store.getState().getFiles("folder-a")).toBeNull();
  });
});

describe("useFolderCacheStore account scoping", () => {
  beforeEach(() => {
    persisted.clear();
    storageThrows = false;
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never serves another account's cached listings", async () => {
    const { store: first } = await loadStore(USER_A);
    first.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();
    expect(persistedFor(USER_A, "folder-a")).toBeDefined();

    // A different Google account signs in on the same device.
    const { store: second } = await loadStore(USER_B);
    await flush();

    expect(second.getState().getFiles("folder-a")).toBeNull();
    expect(second.getState().cache.size).toBe(0);
    // The previous account's records are evicted, not just hidden.
    expect(persistedFor(USER_A, "folder-a")).toBeUndefined();
  });

  it("keeps the two accounts' listings on separate keys", async () => {
    const { store: a } = await loadStore(USER_A);
    a.getState().setFiles("folder-a", [makeFile("a")]);
    await flush();

    // Simulate a device where the eviction sweep has not run yet by writing
    // the other account's record directly.
    persisted.set(keyFor(USER_B, "folder-a"), {
      key: keyFor(USER_B, "folder-a"),
      userId: USER_B,
      folderId: "folder-a",
      files: [makeFile("b")],
      fetchedAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    expect(persistedFor(USER_A, "folder-a")?.files[0].id).toBe("a");
    expect(persistedFor(USER_B, "folder-a")?.files[0].id).toBe("b");
  });

  it("evicts the previous account when a new one signs in mid-session", async () => {
    const { store, authStore } = await loadStore(USER_A);
    store.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();

    // The authoritative-401 path only calls `logout()`; it deliberately does
    // not run `clearLocalData()`, so the listings are still on disk here.
    authStore.getState().clearTokens();
    expect(store.getState().getFiles("folder-a")).not.toBeNull();
    expect(persistedFor(USER_A, "folder-a")).toBeDefined();

    // Signing in with a different account must drop the previous cache.
    authStore.setState({
      user: userFor(USER_B),
      authStatus: "authenticated",
    });
    await store.getState().hydrate();
    await flush();

    expect(store.getState().getFiles("folder-a")).toBeNull();
    expect(persistedFor(USER_A, "folder-a")).toBeUndefined();
    expect(store.getState().hydrated).toBe(true);
  });

  it("serves the last signed-in account's cache with no live session", async () => {
    const { store: online } = await loadStore(USER_A);
    online.getState().setFiles("folder-a", [makeFile("1")]);
    await flush();

    // Offline launch: AuthGuard grants access with no live session at all, so
    // the remembered account id is the only identity available.
    const { store: offline } = await loadStore(null);

    expect(offline.getState().getFiles("folder-a")?.files).toHaveLength(1);
    expect(offline.getState().hydrated).toBe(true);
  });

  it("hydrates without deadlocking when no account is ever known", async () => {
    const { store } = await prepareModules(null);

    await expect(store.getState().hydrate()).resolves.toBeUndefined();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().cache.size).toBe(0);

    // Browsing still works; the listing is simply not attributable to anyone,
    // so it stays in memory only.
    store.getState().setFiles("folder-a", [makeFile("1")]);
    await flush();

    expect(store.getState().getFiles("folder-a")?.files).toHaveLength(1);
    expect(persisted.size).toBe(0);
  });
});

describe("useFolderCacheStore logout safety", () => {
  beforeEach(() => {
    persisted.clear();
    storageThrows = false;
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Replays the ordering of `logoutAndRedirect` in
   * `src/lib/clear-local-data.ts`: the logging-out flag goes up first, the
   * folder cache is wiped next, and the auth user is only cleared afterwards.
   * The window this leaves open — wiped storage, live-looking user, page not
   * navigated yet — is what every test below exercises.
   */
  async function beginLogout(
    store: Awaited<ReturnType<typeof loadStore>>["store"],
    authStore: Awaited<ReturnType<typeof loadStore>>["authStore"],
  ) {
    authStore.getState().setLoggingOut(true);
    store.getState().clear();
    await flush();
  }

  it("wipes the remembered account id along with the listings", async () => {
    const { store } = await loadStore(USER_A);
    store.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();
    expect(rememberedUserId()).toBe(USER_A);

    store.getState().clear();
    await flush();

    expect(persisted.size).toBe(0);
    expect(rememberedUserId()).toBeNull();
  });

  it("drops a listing that lands after the wipe while the user still looks signed in", async () => {
    const { store, authStore } = await loadStore(USER_A);
    store.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();

    await beginLogout(store, authStore);
    expect(persisted.size).toBe(0);
    expect(rememberedUserId()).toBeNull();

    // `clearLocalData()` has finished but `logout()` has not run yet, so the
    // auth store still reports the account that is on its way out.
    expect(authStore.getState().user?.id).toBe(USER_A);

    // A Drive listing request that was already in flight resolves right here.
    store.getState().setFiles("folder-b", [makeFile("leaked")]);
    await flush();

    // Nothing may reach disk: neither the file names nor the account id that
    // would scope them to the previous user on this shared device.
    expect(persisted.size).toBe(0);
    expect(rememberedUserId()).toBeNull();

    // And nothing renderable survives, so the listing cannot flash on screen
    // in the moment before `logoutAndRedirect` navigates away.
    expect(store.getState().cache.size).toBe(0);
    expect(store.getState().getFiles("folder-b")).toBeNull();
  });

  it("drops a listing that lands between the logout flag and the wipe", async () => {
    const { store, authStore } = await loadStore(USER_A);

    authStore.getState().setLoggingOut(true);
    store.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();

    // Not merely "wiped a moment later": never written in the first place.
    expect(persisted.size).toBe(0);
    expect(store.getState().cache.size).toBe(0);
  });

  it("stays closed when a mid-logout token refresh clears the logging-out flag", async () => {
    const { store, authStore } = await loadStore(USER_A);
    await beginLogout(store, authStore);

    // `refreshAccessToken()` and `hydrateServerSession()` both set
    // `isLoggingOut` back to false, and a refresh started before the user hit
    // log out can resolve exactly here. The wipe must still be final.
    authStore.setState({
      user: userFor(USER_A),
      authStatus: "authenticated",
      isLoggingOut: false,
    });

    store.getState().setFiles("folder-a", [makeFile("leaked")]);
    await flush();

    expect(persisted.size).toBe(0);
    expect(rememberedUserId()).toBeNull();
    expect(store.getState().cache.size).toBe(0);
  });

  it("does not rewrite the LRU timestamp on a read once logout has begun", async () => {
    const { store, authStore } = await loadStore(USER_A);
    store.getState().setFiles("folder-a", [makeFile("1")]);
    await flush();
    const writtenAt = persistedFor(USER_A, "folder-a")?.lastAccessedAt;

    authStore.getState().setLoggingOut(true);
    vi.setSystemTime(Date.now() + 5 * MINUTE);

    // Reads stay open on purpose: the authoritative-401 `logout()` raises the
    // same flag without wiping anything, and offline mode then runs the whole
    // app with no live session, serving listings from this cache.
    expect(store.getState().getFiles("folder-a")?.files).toHaveLength(1);
    await flush();

    expect(persistedFor(USER_A, "folder-a")?.lastAccessedAt).toBe(writtenAt);
  });

  it("still persists normally while no logout is in progress", async () => {
    const { store } = await loadStore(USER_A);

    store.getState().setFiles("folder-a", [makeFile("1")]);
    await flush();

    expect(rememberedUserId()).toBe(USER_A);
    expect(persistedFor(USER_A, "folder-a")?.files[0].id).toBe("1");
    expect(store.getState().cache.size).toBe(1);
  });
});

describe("useFolderCacheStore size bounds", () => {
  beforeEach(() => {
    persisted.clear();
    storageThrows = false;
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an oversized listing in memory but off disk", async () => {
    const { store } = await loadStore();

    // 300 * 2,000 bytes = 600 KB, above the 512 KB per-listing cap.
    const huge = makeListing(300, "huge");
    store.getState().setFiles("folder-huge", huge);
    store.getState().setFiles("folder-small", [makeFile("1")]);
    await flush();

    // Browsing the big folder must not regress.
    expect(store.getState().getFiles("folder-huge")?.files).toHaveLength(300);
    expect(store.getState().isStale("folder-huge")).toBe(false);

    expect(persistedFor(USER_A, "folder-huge")).toBeUndefined();
    expect(persistedFor(USER_A, "folder-small")).toBeDefined();
  });

  it("deletes the persisted record when a folder grows past the per-listing cap", async () => {
    const { store } = await loadStore();

    // Small enough to persist: the record the user will later outgrow.
    store.getState().setFiles("folder-grows", [makeFile("1")]);
    await flush();
    expect(persistedFor(USER_A, "folder-grows")).toBeDefined();

    // The user adds a lot of files in Drive and the refreshed listing no longer
    // fits the per-listing cap. It stays in memory, and the superseded record
    // must not survive on disk.
    vi.setSystemTime(Date.now() + MINUTE);
    store.getState().setFiles("folder-grows", makeListing(300, "grown"));
    await flush();

    expect(persistedFor(USER_A, "folder-grows")).toBeUndefined();
    // Same session: the corrected listing still serves from memory.
    expect(store.getState().getFiles("folder-grows")?.files).toHaveLength(300);
    expect(store.getState().isStale("folder-grows")).toBe(false);
  });

  it("does not hydrate the superseded record after a restart", async () => {
    const { store } = await loadStore();
    store.getState().setFiles("folder-grows", [makeFile("stale")]);
    await flush();

    store.getState().setFiles("folder-grows", makeListing(300, "grown"));
    await flush();

    const { store: restarted } = await loadStore();

    // The one-file listing is known to be wrong; serving it again — without
    // revalidation while it still looks fresh, or forever while offline — is
    // worse than refetching.
    expect(restarted.getState().getFiles("folder-grows")).toBeNull();
  });

  it("keeps browsing working when the superseding delete fails", async () => {
    const { store } = await loadStore();
    store.getState().setFiles("folder-grows", [makeFile("1")]);
    await flush();

    storageThrows = true;
    store.getState().setFiles("folder-grows", makeListing(300, "grown"));
    await flush();

    expect(store.getState().getFiles("folder-grows")?.files).toHaveLength(300);
    store.getState().setFiles("folder-other", [makeFile("2")]);
    await flush();
    expect(store.getState().getFiles("folder-other")?.files).toHaveLength(1);
  });

  it("does not carry an oversized listing across a restart", async () => {
    const { store } = await loadStore();
    store.getState().setFiles("folder-huge", makeListing(300, "huge"));
    await flush();

    const { store: restarted } = await loadStore();

    expect(restarted.getState().getFiles("folder-huge")).toBeNull();
  });

  it("evicts least recently used listings once the total byte budget is full", async () => {
    const { store } = await loadStore();

    // 128 * 2,000 bytes = 256 KB per listing, so 16 listings sit just under the
    // 4 MB total budget and the 17th pushes it over.
    for (let i = 0; i < 16; i += 1) {
      vi.setSystemTime(Date.now() + MINUTE);
      store.getState().setFiles(`folder-${i}`, makeListing(128, `f${i}`));
    }
    await flush();

    expect(store.getState().cache.size).toBe(16);
    expect(persisted.size).toBe(16);

    vi.setSystemTime(Date.now() + MINUTE);
    store.getState().setFiles("folder-16", makeListing(128, "f16"));
    await flush();

    // The oldest listing makes room for the newest; everything else stays.
    expect(store.getState().getFiles("folder-0")).toBeNull();
    expect(persistedFor(USER_A, "folder-0")).toBeUndefined();
    expect(store.getState().getFiles("folder-16")?.files).toHaveLength(128);
    expect(persistedFor(USER_A, "folder-16")).toBeDefined();
    expect(store.getState().cache.size).toBe(16);
    expect(persisted.size).toBe(16);
  });

  it("does not count memory-only listings against the byte budget", async () => {
    const { store } = await loadStore();

    // An oversized, memory-only listing occupies no origin quota, so it must
    // not push persisted listings out of the cache.
    vi.setSystemTime(Date.now() + MINUTE);
    store.getState().setFiles("folder-huge", makeListing(400, "huge"));

    for (let i = 0; i < 16; i += 1) {
      vi.setSystemTime(Date.now() + MINUTE);
      store.getState().setFiles(`folder-${i}`, makeListing(128, `f${i}`));
    }
    await flush();

    expect(persisted.size).toBe(16);
    expect(store.getState().getFiles("folder-huge")?.files).toHaveLength(400);
    expect(store.getState().getFiles("folder-0")).not.toBeNull();
  });

  it("estimates listing size without serialising the listing", async () => {
    const { store } = await loadStore();

    store.getState().setFiles("folder-a", makeListing(10, "a"));

    expect(store.getState().cache.get("folder-a")?.estimatedBytes).toBe(
      10 * BYTES_PER_PADDED_FILE,
    );
  });
});
