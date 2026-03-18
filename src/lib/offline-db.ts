import { type DBSchema, type IDBPDatabase, openDB } from "idb";

interface OfflineTrackRecord {
  blob: Blob;
  sizeBytes: number;
  mimeType: string;
  name: string;
  modifiedTime: string | undefined;
  downloadedAt: number;
}

interface OfflineCollectionRecord {
  enabled: boolean;
  trackFileIds: string[];
  totalBytes: number;
  downloadedCount: number;
  totalCount: number;
  lastSyncedAt: number;
}

interface OfflineDbSchema extends DBSchema {
  offline_tracks: {
    key: string;
    value: OfflineTrackRecord;
  };
  offline_collections: {
    key: string;
    value: OfflineCollectionRecord;
  };
}

const DB_NAME = "drivebeats-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("offline_tracks")) {
          db.createObjectStore("offline_tracks");
        }
        if (!db.objectStoreNames.contains("offline_collections")) {
          db.createObjectStore("offline_collections");
        }
      },
    });
  }
  return dbPromise;
}

export async function getTrack(
  fileId: string,
): Promise<OfflineTrackRecord | undefined> {
  const db = await getDb();
  return db.get("offline_tracks", fileId);
}

export async function putTrack(
  fileId: string,
  record: OfflineTrackRecord,
): Promise<void> {
  const db = await getDb();
  await db.put("offline_tracks", record, fileId);
}

export async function deleteTrack(fileId: string): Promise<void> {
  const db = await getDb();
  await db.delete("offline_tracks", fileId);
}

export async function getCollection(
  collectionId: string,
): Promise<OfflineCollectionRecord | undefined> {
  const db = await getDb();
  return db.get("offline_collections", collectionId);
}

export async function putCollection(
  collectionId: string,
  record: OfflineCollectionRecord,
): Promise<void> {
  const db = await getDb();
  await db.put("offline_collections", record, collectionId);
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const db = await getDb();
  await db.delete("offline_collections", collectionId);
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["offline_tracks", "offline_collections"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("offline_tracks").clear(),
    tx.objectStore("offline_collections").clear(),
    tx.done,
  ]);
}

export async function getAllTrackSizes(): Promise<
  { fileId: string; sizeBytes: number }[]
> {
  const db = await getDb();
  const tx = db.transaction("offline_tracks", "readonly");
  const store = tx.objectStore("offline_tracks");
  const results: { fileId: string; sizeBytes: number }[] = [];

  let cursor = await store.openCursor();
  while (cursor) {
    results.push({ fileId: cursor.key, sizeBytes: cursor.value.sizeBytes });
    cursor = await cursor.continue();
  }

  return results;
}

export async function getTrackCount(): Promise<number> {
  const db = await getDb();
  return db.count("offline_tracks");
}
