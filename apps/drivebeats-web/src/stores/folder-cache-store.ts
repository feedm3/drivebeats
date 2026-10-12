import { create } from "zustand";
import {
  clearFolderListings,
  clearFolderListingsForOtherUsers,
  clearFolderListingsForUser,
  deleteFolderListings,
  loadFolderListingsForUser,
  putFolderListing,
} from "@/lib/folder-cache-db";
import { useAuthStore } from "@/stores/auth-store";
import type { DriveFile } from "@/types";

const STALE_MS = 5 * 60 * 1000; // 5 minutes

// Disk bounds for the persisted listing cache. Staleness only decides when a
// listing gets revalidated in the background; these decide how much a device
// keeps around.
//
// A listing is not a single Drive page: `fetchFromApi` in
// `src/hooks/use-folder-contents.ts` follows every `nextPageToken` at
// `pageSize=1000` and caches the concatenated result, so one folder can hold
// tens of thousands of file records and weigh several megabytes. A cap on the
// number of folders therefore bounds nothing on its own, which is why the
// cache is bounded by estimated bytes first and entry count second.
//
// MAX_LISTING_BYTES: 512 KB, which is roughly 2,500 Drive file records. A
// listing above that is an outlier directory that would evict a large share of
// the cache to make room for itself, so it is never written to disk — it stays
// in memory for the session instead, and browsing it is unaffected. A folder
// that grows past the cap also has its earlier, smaller record deleted, so disk
// never keeps a listing the app has already superseded.
//
// MAX_TOTAL_CACHED_BYTES: 4 MB across every persisted listing. The origin
// quota is shared with the offline audio downloads in `offline-db`, which are
// the storage the user actually cares about and can run to gigabytes; a
// listing cache that can never exceed single-digit megabytes can never be the
// reason a download write fails. `navigator.storage.estimate()` (already used
// in `src/lib/offline-download-manager.ts`) was considered as the bound
// instead, but it is async, coarse, browser-throttled, and a quota-relative
// budget would still let listings grow into the space downloads need. A small
// fixed ceiling is the stronger guarantee, and 4 MB still holds hundreds of
// ordinary album-sized folders.
//
// MAX_CACHED_FOLDERS: a secondary bound so a device that only ever browses
// tiny folders still stops accumulating entries.
//
// MAX_ENTRY_AGE_MS: far beyond the 5-minute staleness window on purpose. A
// stale entry is still worth showing instantly before revalidating; eviction is
// only about not hoarding disk for folders the user stopped visiting. Two weeks
// keeps a returning-from-holiday user fully warm.
const MAX_LISTING_BYTES = 512 * 1024;
const MAX_TOTAL_CACHED_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_FOLDERS = 200;
const MAX_ENTRY_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// The structured-clone size of a record is not observable, so approximate it.
// Every DriveFile carries an id, a mimeType and usually size, modifiedTime and
// parents, which together are close to constant; only the name really varies,
// and JS strings are counted at two bytes per code unit.
const ESTIMATED_BYTES_PER_FILE = 160;

// Reads bump the LRU timestamp, but writing the whole listing back on every
// read would rewrite the record on each navigation. One write per minute per
// folder keeps the LRU order accurate enough to pick eviction victims.
const TOUCH_THROTTLE_MS = 60 * 1000;

function estimateListingBytes(files: DriveFile[]): number {
  let bytes = 0;
  for (const file of files) {
    bytes += ESTIMATED_BYTES_PER_FILE + (file.name?.length ?? 0) * 2;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// User scoping
//
// A listing is a list of someone's Drive file names, so it must never leak
// between accounts on a shared device. Records are keyed by
// `${userId}\0${folderId}` in IndexedDB and reads only ever ask for the active
// user's records, which is what makes an authoritative-401 logout safe: that
// path calls `useAuthStore.getState().logout()` without running
// `clearLocalData()`, on purpose, because a spurious 401 must not delete the
// user's offline downloads. Scoping means it does not have to delete anything.
//
// The active user id is resolved as:
//   1. `useAuthStore.getState().user?.id`, when a session is known, else
//   2. the last signed-in id remembered in localStorage.
//
// Step 2 exists for two cases that have no live user:
//   - This module hydrates at evaluation time, before `AuthBootstrap` has set
//     the user, so a cold start would otherwise read nothing.
//   - Offline mode (`offlineAccessAllowed` in `src/components/auth-guard.tsx`)
//     runs the entire app with no live session, possibly forever. Listings
//     cached by that same account must stay readable there.
//
// Hydration never waits for a user to appear, so there is no deadlock: with no
// remembered id it resolves immediately against an empty cache and the account
// is adopted later, at the cost of one extra Drive fetch on a brand new device.
//
// When a *different* account becomes known, `syncActiveUser` drops the
// in-memory cache, evicts every record that is not theirs, and re-hydrates.
// Reads call it too, so a live session can never read another account's record
// even in the window before the store subscription fires. A user going *away*
// (logout, offline) is never treated as an account change — it is not a
// verdict about who owns the cache.
// ---------------------------------------------------------------------------
const ACTIVE_USER_STORAGE_KEY = "drivebeats-folder-cache-user";

let activeUserId: string | null = null;

// ---------------------------------------------------------------------------
// Closing the cache on logout
//
// `clearLocalData()` wipes this cache and only afterwards calls
// `useAuthStore.getState().logout()`, so between the wipe and the redirect the
// auth store still reports a live user. A Drive listing response that resolves
// in that window used to reach `setFiles`, which resolved `activeUserId` from
// that stale user, re-adopted the account, and wrote both the listing to
// IndexedDB and the remembered account id back to localStorage — after the
// wipe meant to remove them. On a shared device that leaves the previous
// account's Drive file names on disk, and `logoutAndRedirect` navigates away
// before anything could clean up.
//
// Two conditions close the cache to writes:
//
//   1. `isLoggingOut` on the auth store. `logoutAndRedirect` sets it as its
//      very first step, before `clearLocalData()` runs at all, so no write is
//      even issued from the moment logout begins.
//   2. `cacheSealed`, set by `clear()` and never unset. `isLoggingOut` alone is
//      not sufficient because it is not monotonic: `refreshAccessToken()` and
//      `hydrateServerSession()` both set it back to false, and a refresh
//      started before logout can resolve mid-logout — which would re-open the
//      cache after the wipe. `cacheSealed` cannot be undone, and nothing needs
//      to undo it: `clear()` is only reached from `clearLocalData()`, which is
//      only reached from `logoutAndRedirect()`, which always navigates to `/`.
//      That also makes a numbered "clear generation" unnecessary; the counter
//      would only ever hold two distinguishable values.
//
// Reads deliberately stay open while only `isLoggingOut` is set. That flag is
// also raised by the authoritative-401 `logout()` path, which does not wipe
// anything on purpose, and offline mode then runs the whole app with no live
// session; closing reads there would break offline browsing of already-cached
// listings. Once `cacheSealed` is set the in-memory map is empty and can no
// longer be refilled, so reads return nothing anyway.
// ---------------------------------------------------------------------------
let cacheSealed = false;

function isCacheClosed(): boolean {
  return cacheSealed || useAuthStore.getState().isLoggingOut;
}

function readRememberedUserId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
  } catch {
    // Blocked storage: scoping still holds for this session.
    return null;
  }
}

function rememberUserId(userId: string | null) {
  // Forgetting the account is always allowed — `clear()` depends on it.
  // Remembering one is a write, so it is closed along with the rest.
  if (userId && isCacheClosed()) return;

  try {
    if (userId) {
      window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, userId);
    } else {
      window.localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    }
  } catch {
    // Best effort.
  }
}

interface CacheEntry {
  files: DriveFile[];
  fetchedAt: number;
  lastAccessedAt: number;
  /** Approximate cost of this listing in IndexedDB. */
  estimatedBytes: number;
  /**
   * Whether this listing is (or should be) on disk. False for listings too
   * large to persist and for listings fetched before an account was known;
   * those still serve reads from memory.
   */
  persisted: boolean;
}

interface FolderCacheState {
  cache: Map<string, CacheEntry>;
  hydrated: boolean;
  /**
   * Loads persisted listings from IndexedDB into `cache`. Idempotent: every
   * caller shares the same in-flight promise. Callers that need to know whether
   * a folder is cached must await this first, otherwise a cold start reads an
   * empty map and refetches folders it already has on disk.
   */
  hydrate: () => Promise<void>;
  getFiles: (folderId: string) => CacheEntry | null;
  setFiles: (folderId: string, files: DriveFile[]) => void;
  isStale: (folderId: string) => boolean;
  invalidate: (folderId?: string) => void;
  clear: () => void;
}

/**
 * Returns the folder ids that must leave the cache: anything past the maximum
 * age first, then the least recently used entries while the cache is over the
 * folder cap or over the total byte budget.
 *
 * Memory-only entries count against the folder cap but contribute no bytes,
 * since they are not occupying any origin quota.
 */
function selectEvictedFolderIds(
  cache: Map<string, CacheEntry>,
  now: number,
): string[] {
  const evicted: string[] = [];
  const live: { folderId: string; lastAccessedAt: number; bytes: number }[] =
    [];
  let totalBytes = 0;

  for (const [folderId, entry] of cache) {
    if (now - entry.lastAccessedAt > MAX_ENTRY_AGE_MS) {
      evicted.push(folderId);
      continue;
    }

    const bytes = entry.persisted ? entry.estimatedBytes : 0;
    totalBytes += bytes;
    live.push({ folderId, lastAccessedAt: entry.lastAccessedAt, bytes });
  }

  // Least recently used first, so the entry that was just written (it carries
  // the newest timestamp) is the last candidate. A single persistable listing
  // is capped well below the total budget, so it can never evict itself.
  live.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  let liveCount = live.length;
  let index = 0;
  while (
    index < live.length &&
    (liveCount > MAX_CACHED_FOLDERS || totalBytes > MAX_TOTAL_CACHED_BYTES)
  ) {
    const victim = live[index];
    evicted.push(victim.folderId);
    totalBytes -= victim.bytes;
    liveCount -= 1;
    index += 1;
  }

  return evicted;
}

/**
 * Persistence is best effort: a failed write must never surface as an
 * unhandled rejection or interrupt browsing.
 *
 * Operations reach IndexedDB in the order they are started here. Every
 * `folder-cache-db` entry point runs synchronously up to a single
 * `await getDb()` on one shared promise, so the resumption order matches the
 * call order, and `db.put`/`db.clear` create their readwrite transaction
 * synchronously on resumption. IndexedDB runs overlapping readwrite
 * transactions in creation order, so an earlier call always commits first.
 *
 * That is what makes the wipe in `clear()` final: a write issued before it
 * commits before it and is erased by it, and a write issued after it is
 * impossible because `clear()` seals the cache first.
 */
function persistInBackground(operation: Promise<void>) {
  void operation.catch(() => {
    // Ignored on purpose; the in-memory cache stays authoritative.
  });
}

// Invalidation that happens while hydration is still in flight must not be
// undone by the records that hydration is about to merge in.
const invalidatedDuringHydration = new Set<string>();
let invalidatedAllDuringHydration = false;

let hydrationPromise: Promise<void> | null = null;
let hydrationInFlight = false;

async function loadUserCache(userId: string | null) {
  if (!userId) return { persisted: new Map<string, CacheEntry>(), evicted: [] };

  try {
    const records = await loadFolderListingsForUser(userId);
    const now = Date.now();
    const persisted = new Map<string, CacheEntry>();

    for (const record of records) {
      persisted.set(record.folderId, {
        files: record.files,
        fetchedAt: record.fetchedAt,
        lastAccessedAt: record.lastAccessedAt ?? record.fetchedAt,
        estimatedBytes: estimateListingBytes(record.files),
        persisted: true,
      });
    }

    const evicted = selectEvictedFolderIds(persisted, now);
    for (const folderId of evicted) {
      persisted.delete(folderId);
    }

    return { persisted, evicted };
  } catch {
    // Persistence is optional; fall back to the in-memory cache.
    return { persisted: new Map<string, CacheEntry>(), evicted: [] };
  }
}

async function runHydration(): Promise<void> {
  hydrationInFlight = true;

  try {
    for (;;) {
      // Captured up front: if the account changes while the read is in flight,
      // the records belong to the wrong user and are reloaded instead of
      // published.
      const userId = activeUserId;
      const { persisted, evicted } = await loadUserCache(userId);

      if (activeUserId !== userId) continue;

      const state = useFolderCacheStore.getState();
      const merged = new Map<string, CacheEntry>();

      if (!invalidatedAllDuringHydration) {
        for (const [folderId, entry] of persisted) {
          if (invalidatedDuringHydration.has(folderId)) continue;
          merged.set(folderId, entry);
        }
      }

      // Anything fetched while hydration was in flight is newer than disk.
      for (const [folderId, entry] of state.cache) {
        merged.set(folderId, entry);
      }

      invalidatedDuringHydration.clear();
      invalidatedAllDuringHydration = false;

      useFolderCacheStore.setState({ cache: merged, hydrated: true });

      // `evicted` was computed from the disk snapshot taken before the await
      // above. A folder that `setFiles` persisted in the meantime is live in
      // `merged`, so deleting its fresh record would only cost a needless
      // refetch on the next restart.
      const staleEvicted = evicted.filter((folderId) => !merged.has(folderId));

      if (userId && staleEvicted.length > 0) {
        persistInBackground(deleteFolderListings(userId, staleEvicted));
      }
      return;
    }
  } finally {
    hydrationInFlight = false;
  }
}

/**
 * Makes `userId` the owner of the cache: forgets everything the previous owner
 * had in memory, evicts every record on disk that is not theirs, and hydrates
 * this account's listings instead.
 */
function adoptUser(userId: string) {
  activeUserId = userId;
  rememberUserId(userId);

  invalidatedDuringHydration.clear();
  invalidatedAllDuringHydration = false;
  useFolderCacheStore.setState({ cache: new Map(), hydrated: false });

  persistInBackground(clearFolderListingsForOtherUsers(userId));

  // A hydration that is still in flight notices `activeUserId` changed and
  // reloads for this account before publishing anything, so restarting it here
  // would only duplicate the work — and replacing the promise other callers are
  // already awaiting is exactly how a hydration deadlock gets built.
  if (!hydrationInFlight) {
    hydrationPromise = null;
    void useFolderCacheStore.getState().hydrate();
  }
}

function syncActiveUser() {
  // During logout the auth store's `user` is stale: it survives the wipe and is
  // only cleared afterwards. Adopting it would re-arm every write path below.
  if (isCacheClosed()) return;

  const liveUserId = useAuthStore.getState().user?.id ?? null;

  // No live user is not a verdict about ownership: it is the normal state
  // before `AuthBootstrap` runs, after a 401 logout, and throughout offline
  // mode. Keep the cache exactly as it is.
  if (!liveUserId || liveUserId === activeUserId) return;

  adoptUser(liveUserId);
}

function noteInvalidation(folderId?: string) {
  if (useFolderCacheStore.getState().hydrated) return;
  if (folderId) {
    invalidatedDuringHydration.add(folderId);
  } else {
    invalidatedAllDuringHydration = true;
  }
}

export const useFolderCacheStore = create<FolderCacheState>((set, get) => ({
  cache: new Map(),
  hydrated: false,

  hydrate: () => {
    if (!hydrationPromise) {
      hydrationPromise = runHydration();
    }
    return hydrationPromise;
  },

  getFiles: (folderId) => {
    // No-op once the cache is closed, so a read cannot adopt the stale
    // logging-out user and re-arm persistence.
    syncActiveUser();
    const userId = activeUserId;

    const entry = get().cache.get(folderId) ?? null;
    if (!entry) return null;

    // Mutated in place on purpose: `lastAccessedAt` is LRU bookkeeping that
    // nothing renders, so keeping the entry reference stable avoids re-rendering
    // every subscriber on a plain read.
    //
    // The touch is a disk write, so it is closed on logout like any other. A
    // slightly stale LRU timestamp only costs a suboptimal eviction choice.
    const now = Date.now();
    if (!isCacheClosed() && now - entry.lastAccessedAt >= TOUCH_THROTTLE_MS) {
      entry.lastAccessedAt = now;
      if (entry.persisted && userId) {
        persistInBackground(
          putFolderListing({
            userId,
            folderId,
            files: entry.files,
            fetchedAt: entry.fetchedAt,
            lastAccessedAt: now,
          }),
        );
      }
    }

    return entry;
  },

  setFiles: (folderId, files) => {
    // A listing that arrives once logout has begun is dropped outright, memory
    // included. Keeping it in memory would let the folder view re-render the
    // signed-out account's file names in the moment before
    // `logoutAndRedirect` navigates away, and would leave it there for
    // hydration to merge back in.
    if (isCacheClosed()) return;

    syncActiveUser();
    const userId = activeUserId;

    const now = Date.now();
    const estimatedBytes = estimateListingBytes(files);
    // Oversized listings, and listings fetched before an account is known,
    // live in memory only. Browsing must not regress just because the listing
    // is not worth writing to disk.
    const shouldPersist =
      Boolean(userId) && estimatedBytes <= MAX_LISTING_BYTES;
    const entry: CacheEntry = {
      files,
      fetchedAt: now,
      lastAccessedAt: now,
      estimatedBytes,
      persisted: shouldPersist,
    };

    const next = new Map(get().cache);
    next.set(folderId, entry);

    const evicted = selectEvictedFolderIds(next, now);
    for (const evictedId of evicted) {
      next.delete(evictedId);
    }

    set({ cache: next });

    if (userId) {
      // Everything this call takes off disk goes through one delete, issued
      // after the write above. Persistence calls reach IndexedDB in the order
      // they are started here — `putFolderListing` and `deleteFolderListings`
      // both await the same shared `getDb()` promise once before opening their
      // transaction — so a delete can never overtake a write for the same
      // folder, and a later `setFiles` for that folder always writes last.
      const removedFromDisk = new Set(evicted);

      if (shouldPersist) {
        persistInBackground(
          putFolderListing({
            userId,
            folderId,
            files,
            fetchedAt: now,
            lastAccessedAt: now,
          }),
        );
      } else {
        // A refreshed listing that is too large to persist still supersedes
        // whatever this folder had on disk: that record is a listing the app
        // already knows is wrong. Leaving it there would let hydration serve it
        // after a restart — without revalidation while its `fetchedAt` is still
        // fresh, and indefinitely while offline.
        removedFromDisk.add(folderId);
      }

      if (removedFromDisk.size > 0) {
        persistInBackground(deleteFolderListings(userId, [...removedFromDisk]));
      }
    }
  },

  isStale: (folderId) => {
    const entry = get().cache.get(folderId);
    if (!entry) return true;
    return Date.now() - entry.fetchedAt > STALE_MS;
  },

  invalidate: (folderId?) => {
    noteInvalidation(folderId);
    const userId = activeUserId;

    if (folderId) {
      const next = new Map(get().cache);
      next.delete(folderId);
      set({ cache: next });
      if (userId) {
        persistInBackground(deleteFolderListings(userId, [folderId]));
      }
    } else {
      set({ cache: new Map() });
      if (userId) {
        persistInBackground(clearFolderListingsForUser(userId));
      }
    }
  },

  clear: () => {
    // Sealed first, and before anything else in the store mutates: from here on
    // no write can be issued, so the wipe below is the last thing that ever
    // touches this cache's storage. See the "Closing the cache on logout" note.
    cacheSealed = true;

    noteInvalidation();
    set({ cache: new Map() });

    // This is the `clearLocalData()` wipe, so it removes every account's
    // listings rather than only the active one, and forgets which account owned
    // the cache. Sign-in after a logout always goes through a full page load,
    // which starts a fresh, empty, unsealed cache.
    activeUserId = null;
    rememberUserId(null);
    persistInBackground(clearFolderListings());
  },
}));

if (typeof window !== "undefined") {
  activeUserId = useAuthStore.getState().user?.id ?? readRememberedUserId();

  if (activeUserId) {
    rememberUserId(activeUserId);
    // Key-only scan, so it costs nothing next to the listing read below. It
    // guarantees the device never keeps listings for an account other than the
    // one that owns the cache, even when a previous session ended without
    // going through `adoptUser` — for example a 401 logout followed by signing
    // in as somebody else in a freshly loaded tab.
    persistInBackground(clearFolderListingsForOtherUsers(activeUserId));
  }

  // `AuthBootstrap` sets the user in an effect, after this module is evaluated,
  // and a different account may sign in later in the same session.
  useAuthStore.subscribe(syncActiveUser);

  // Start hydration as early as the client bundle evaluates this module so the
  // listings are usually in memory before the first folder view mounts.
  // Consumers still await `hydrate()` rather than assuming it finished.
  void useFolderCacheStore.getState().hydrate();
}
