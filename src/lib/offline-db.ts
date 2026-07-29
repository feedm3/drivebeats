import {
  type DBSchema,
  type IDBPDatabase,
  type OpenDBCallbacks,
  openDB,
} from "idb";

export interface OfflineTrackRecord {
  blob: Blob;
  sizeBytes: number;
  mimeType: string;
  name: string;
  modifiedTime: string | undefined;
  downloadedAt: number;
}

export interface OfflineCollectionRecord {
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

type OpenOfflineDatabase = (
  name: string,
  version: number,
  callbacks: OpenDBCallbacks<OfflineDbSchema>,
) => Promise<IDBPDatabase<OfflineDbSchema>>;

export interface OfflineDatabase {
  getTrack(fileId: string): Promise<OfflineTrackRecord | undefined>;
  putTrack(fileId: string, record: OfflineTrackRecord): Promise<void>;
  deleteTrack(fileId: string): Promise<void>;
  getCollection(
    collectionId: string,
  ): Promise<OfflineCollectionRecord | undefined>;
  putCollection(
    collectionId: string,
    record: OfflineCollectionRecord,
  ): Promise<void>;
  deleteCollection(collectionId: string): Promise<void>;
  clearAll(): Promise<void>;
  getAllTrackSizes(): Promise<{ fileId: string; sizeBytes: number }[]>;
  getTrackCount(): Promise<number>;
  resetConnection(): void;
}

export interface OfflineDatabaseDependencies {
  openDatabase: OpenOfflineDatabase;
}

export function createOfflineDatabase({
  openDatabase,
}: OfflineDatabaseDependencies): OfflineDatabase {
  let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;
  let currentDb: IDBPDatabase<OfflineDbSchema> | null = null;

  const resetConnection = (close = true) => {
    const connection = currentDb;
    currentDb = null;
    dbPromise = null;
    if (close) {
      connection?.close();
    }
  };

  const getDb = () => {
    if (dbPromise) return dbPromise;

    let opening!: Promise<IDBPDatabase<OfflineDbSchema>>;
    opening = openDatabase(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("offline_tracks")) {
          db.createObjectStore("offline_tracks");
        }
        if (!db.objectStoreNames.contains("offline_collections")) {
          db.createObjectStore("offline_collections");
        }
      },
      blocked() {
        if (dbPromise === opening) {
          dbPromise = null;
        }
      },
      blocking() {
        resetConnection();
      },
      terminated() {
        resetConnection(false);
      },
    }).then(
      (db) => {
        if (dbPromise !== opening) {
          db.close();
          return getDb();
        }
        currentDb = db;
        return db;
      },
      (error) => {
        if (dbPromise === opening) {
          dbPromise = null;
        }
        throw error;
      },
    );
    dbPromise = opening;
    return opening;
  };

  return {
    getTrack: async (fileId) => {
      const db = await getDb();
      const tx = db.transaction("offline_tracks", "readonly");
      const record = await tx.objectStore("offline_tracks").get(fileId);
      await tx.done;
      return record;
    },

    putTrack: async (fileId, record) => {
      const db = await getDb();
      const tx = db.transaction("offline_tracks", "readwrite");
      await tx.objectStore("offline_tracks").put(record, fileId);
      await tx.done;
    },

    deleteTrack: async (fileId) => {
      const db = await getDb();
      const tx = db.transaction("offline_tracks", "readwrite");
      await tx.objectStore("offline_tracks").delete(fileId);
      await tx.done;
    },

    getCollection: async (collectionId) => {
      const db = await getDb();
      const tx = db.transaction("offline_collections", "readonly");
      const record = await tx
        .objectStore("offline_collections")
        .get(collectionId);
      await tx.done;
      return record;
    },

    putCollection: async (collectionId, record) => {
      const db = await getDb();
      const tx = db.transaction("offline_collections", "readwrite");
      await tx.objectStore("offline_collections").put(record, collectionId);
      await tx.done;
    },

    deleteCollection: async (collectionId) => {
      const db = await getDb();
      const tx = db.transaction("offline_collections", "readwrite");
      await tx.objectStore("offline_collections").delete(collectionId);
      await tx.done;
    },

    clearAll: async () => {
      const db = await getDb();
      const tx = db.transaction(
        ["offline_tracks", "offline_collections"],
        "readwrite",
      );
      await Promise.all([
        tx.objectStore("offline_tracks").clear(),
        tx.objectStore("offline_collections").clear(),
      ]);
      await tx.done;
    },

    getAllTrackSizes: async () => {
      const db = await getDb();
      const tx = db.transaction("offline_tracks", "readonly");
      const store = tx.objectStore("offline_tracks");
      const results: { fileId: string; sizeBytes: number }[] = [];

      let cursor = await store.openCursor();
      while (cursor) {
        results.push({
          fileId: cursor.key,
          sizeBytes: cursor.value.sizeBytes,
        });
        cursor = await cursor.continue();
      }

      await tx.done;
      return results;
    },

    getTrackCount: async () => {
      const db = await getDb();
      const tx = db.transaction("offline_tracks", "readonly");
      const count = await tx.objectStore("offline_tracks").count();
      await tx.done;
      return count;
    },

    resetConnection,
  };
}

const productionDatabase = createOfflineDatabase({
  openDatabase: (name, version, callbacks) =>
    openDB<OfflineDbSchema>(name, version, callbacks),
});

export const getTrack = productionDatabase.getTrack;
export const putTrack = productionDatabase.putTrack;
export const deleteTrack = productionDatabase.deleteTrack;
export const getCollection = productionDatabase.getCollection;
export const putCollection = productionDatabase.putCollection;
export const deleteCollection = productionDatabase.deleteCollection;
export const clearAll = productionDatabase.clearAll;
export const getAllTrackSizes = productionDatabase.getAllTrackSizes;
export const getTrackCount = productionDatabase.getTrackCount;
export const resetConnection = productionDatabase.resetConnection;
