import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";

export interface LibrarySearchCatalogRecord {
  fetchedAt: number;
  importsSignature: string;
  tracks: LibrarySearchTrack[];
  userId: string;
}

interface LibrarySearchCatalogDbSchema extends DBSchema {
  catalogs: {
    key: string;
    value: LibrarySearchCatalogRecord;
  };
}

const DB_NAME = "drivebeats-library-search";
const DB_VERSION = 1;
const STORE_NAME = "catalogs";

let dbPromise: Promise<IDBPDatabase<LibrarySearchCatalogDbSchema>> | null =
  null;
let storageUnavailable = false;

function getDb(): Promise<IDBPDatabase<LibrarySearchCatalogDbSchema>> | null {
  if (storageUnavailable || typeof indexedDB === "undefined") {
    storageUnavailable = true;
    return null;
  }

  if (!dbPromise) {
    dbPromise = openDB<LibrarySearchCatalogDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "userId" });
        }
      },
    }).catch((error) => {
      storageUnavailable = true;
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

export async function loadLibrarySearchCatalog(
  userId: string,
): Promise<LibrarySearchCatalogRecord | null> {
  if (!userId) return null;

  try {
    const db = await getDb();
    if (!db) return null;
    return (await db.get(STORE_NAME, userId)) ?? null;
  } catch {
    return null;
  }
}

/** One object-store put replaces the complete generation atomically. */
export async function replaceLibrarySearchCatalog(
  record: LibrarySearchCatalogRecord,
): Promise<boolean> {
  if (!record.userId) return false;

  try {
    const db = await getDb();
    if (!db) return false;
    await db.put(STORE_NAME, record);
    return true;
  } catch {
    return false;
  }
}

export async function clearLibrarySearchCatalogForUser(userId: string) {
  if (!userId) return;

  try {
    const db = await getDb();
    if (!db) return;
    await db.delete(STORE_NAME, userId);
  } catch {
    // Best effort.
  }
}

export async function clearLibrarySearchCatalogsForOtherUsers(userId: string) {
  if (!userId) return;

  try {
    const db = await getDb();
    if (!db) return;
    const userIds = await db.getAllKeys(STORE_NAME);
    await Promise.all(
      userIds
        .filter((candidateUserId) => candidateUserId !== userId)
        .map((candidateUserId) => db.delete(STORE_NAME, candidateUserId)),
    );
  } catch {
    // Best effort.
  }
}

export async function clearLibrarySearchCatalogs() {
  try {
    const db = await getDb();
    if (!db) return;
    await db.clear(STORE_NAME);
  } catch {
    // Best effort.
  }
}

export function estimateLibrarySearchCatalogBytes(
  record: LibrarySearchCatalogRecord,
) {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}
