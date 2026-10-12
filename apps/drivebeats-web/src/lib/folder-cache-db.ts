import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { DriveFile } from "@/types";

/**
 * A cached listing always belongs to exactly one signed-in Google account.
 * `userId` is the `AuthUser.id` of the account the listing was fetched with,
 * and `key` is the composite primary key that keeps two accounts on the same
 * device from colliding on the same Drive folder id.
 */
export interface FolderListingRecord {
  key: string;
  userId: string;
  folderId: string;
  files: DriveFile[];
  fetchedAt: number;
  lastAccessedAt: number;
}

export type FolderListingInput = Omit<FolderListingRecord, "key">;

interface FolderCacheDbSchema extends DBSchema {
  folder_listings: {
    key: string;
    value: FolderListingRecord;
    indexes: { by_user: string };
  };
}

// Deliberately a separate database from `drivebeats-offline`. public/sw.js
// opens that database itself through raw `indexedDB.open(name, 1)` with a
// hardcoded `OFFLINE_DB_VERSION = 1` and an `onupgradeneeded` that only creates
// `offline_tracks`. Adding a store there would need a version bump from the app
// side, after which the worker's open call fails with a VersionError (or blocks
// behind an open app connection) and offline media playback breaks. Keeping the
// folder listing cache in its own database removes that coupling entirely.
const DB_NAME = "drivebeats-folder-cache";
// v2 replaced the `folderId` primary key with a `${userId}\0${folderId}`
// composite so that listings are scoped to the account that fetched them.
const DB_VERSION = 2;
const STORE_NAME = "folder_listings";
const USER_INDEX = "by_user";

// A Google account id is decimal digits, so NUL can never appear inside one and
// the prefix below is unambiguous.
const KEY_SEPARATOR = "\u0000";

export function folderListingKey(userId: string, folderId: string): string {
  return `${userId}${KEY_SEPARATOR}${folderId}`;
}

function userKeyPrefix(userId: string): string {
  return `${userId}${KEY_SEPARATOR}`;
}

let dbPromise: Promise<IDBPDatabase<FolderCacheDbSchema>> | null = null;
// Safari private mode and blocked storage reject the open call. Remember that
// so every later call short-circuits instead of retrying a hopeless open.
let storageUnavailable = false;

function getDb(): Promise<IDBPDatabase<FolderCacheDbSchema>> | null {
  if (storageUnavailable) return null;

  if (typeof indexedDB === "undefined") {
    storageUnavailable = true;
    return null;
  }

  if (!dbPromise) {
    dbPromise = openDB<FolderCacheDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // v1 records were keyed by `folderId` alone and carry no owner, so
        // there is no way to attribute them to an account. Drop them rather
        // than risk showing one account's Drive file names to another; they
        // are a revalidatable cache, not user data.
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }

        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex(USER_INDEX, "userId");
      },
    }).catch((error) => {
      storageUnavailable = true;
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

/**
 * Loads only the listings owned by `userId`. Reads never touch another
 * account's records, so a signed-in user can only ever see their own cache.
 */
export async function loadFolderListingsForUser(
  userId: string,
): Promise<FolderListingRecord[]> {
  if (!userId) return [];

  try {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllFromIndex(STORE_NAME, USER_INDEX, userId);
  } catch {
    // Browsing must keep working without persistence.
    return [];
  }
}

export async function putFolderListing(
  record: FolderListingInput,
): Promise<void> {
  if (!record.userId) return;

  try {
    const db = await getDb();
    if (!db) return;
    await db.put(STORE_NAME, {
      ...record,
      key: folderListingKey(record.userId, record.folderId),
    });
  } catch {
    // Quota exceeded or storage blocked: the in-memory cache still holds it.
  }
}

export async function deleteFolderListings(
  userId: string,
  folderIds: string[],
): Promise<void> {
  if (!userId || folderIds.length === 0) return;

  try {
    const db = await getDb();
    if (!db) return;
    await Promise.all(
      folderIds.map((folderId) =>
        db.delete(STORE_NAME, folderListingKey(userId, folderId)),
      ),
    );
  } catch {
    // Best effort.
  }
}

async function deleteKeysMatching(
  matches: (key: string) => boolean,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const keys = await db.getAllKeys(STORE_NAME);
    await Promise.all(
      keys
        .filter((key) => matches(key))
        .map((key) => db.delete(STORE_NAME, key)),
    );
  } catch {
    // Best effort.
  }
}

/** Removes every listing owned by `userId` and leaves other accounts alone. */
export async function clearFolderListingsForUser(
  userId: string,
): Promise<void> {
  if (!userId) return;

  const prefix = userKeyPrefix(userId);
  await deleteKeysMatching((key) => key.startsWith(prefix));
}

/**
 * Evicts every listing that does not belong to `userId`. Called when a
 * different account signs in on this device, so the previous account's cached
 * Drive file names cannot survive on disk.
 */
export async function clearFolderListingsForOtherUsers(
  userId: string,
): Promise<void> {
  if (!userId) return;

  const prefix = userKeyPrefix(userId);
  await deleteKeysMatching((key) => !key.startsWith(prefix));
}

/** Full wipe across every account. Used by the logout/clear-local-data path. */
export async function clearFolderListings(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.clear(STORE_NAME);
  } catch {
    // Best effort.
  }
}
