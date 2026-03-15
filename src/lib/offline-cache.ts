import type { DriveFile } from "@/types";

const DB_NAME = "drivebeats-offline";
const DB_VERSION = 1;
const TRACK_STORE = "offline_tracks";
const MANIFEST_STORE = "offline_manifests";

export type OfflineSource = "single" | "playlist" | "folder";

export interface OfflineTrackRecord {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  cachedAt: number;
  lastAccessedAt: number;
  source: OfflineSource;
  blob: Blob;
  parents?: string[];
}

export interface OfflineManifestRecord {
  key: string;
  entityType: "track" | "playlist" | "folder";
  entityId: string;
  entityName: string;
  fileIds: string[];
  includeSubfolders?: boolean;
  createdAt: number;
}

function getManifestKey(entityType: OfflineManifestRecord["entityType"], entityId: string) {
  return `${entityType}:${entityId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: "fileId" });
      }

      if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
        db.createObjectStore(MANIFEST_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open offline DB"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  stores: string | string[],
  fn: (tx: IDBTransaction) => Promise<T> | T,
) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);

        Promise.resolve(fn(tx))
          .then((result) => {
            tx.oncomplete = () => {
              db.close();
              resolve(result);
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error ?? new Error("Offline DB transaction failed"));
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error ?? new Error("Offline DB transaction aborted"));
            };
          })
          .catch((error) => {
            tx.abort();
            db.close();
            reject(error);
          });
      }),
  );
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline DB request failed"));
  });
}

export async function getOfflineTrackRecord(fileId: string) {
  return runTransaction("readonly", TRACK_STORE, async (tx) => {
    const store = tx.objectStore(TRACK_STORE);
    const record = await requestToPromise(store.get(fileId));
    return (record as OfflineTrackRecord | undefined) ?? null;
  });
}

export async function getAllOfflineTrackRecords() {
  return runTransaction("readonly", TRACK_STORE, async (tx) => {
    const store = tx.objectStore(TRACK_STORE);
    const records = await requestToPromise(store.getAll());
    return records as OfflineTrackRecord[];
  });
}

export async function putOfflineTrackRecord(record: OfflineTrackRecord) {
  return runTransaction("readwrite", TRACK_STORE, async (tx) => {
    const store = tx.objectStore(TRACK_STORE);
    await requestToPromise(store.put(record));
  });
}

export async function removeOfflineTrackRecord(fileId: string) {
  return runTransaction("readwrite", [TRACK_STORE, MANIFEST_STORE], async (tx) => {
    await requestToPromise(tx.objectStore(TRACK_STORE).delete(fileId));
    const manifestStore = tx.objectStore(MANIFEST_STORE);
    const manifests = (await requestToPromise(manifestStore.getAll())) as OfflineManifestRecord[];

    for (const manifest of manifests) {
      if (!manifest.fileIds.includes(fileId)) continue;
      const nextFileIds = manifest.fileIds.filter((candidate) => candidate !== fileId);
      if (nextFileIds.length === 0) {
        await requestToPromise(manifestStore.delete(manifest.key));
      } else {
        await requestToPromise(
          manifestStore.put({
            ...manifest,
            fileIds: nextFileIds,
          }),
        );
      }
    }
  });
}

export async function clearOfflineData() {
  return runTransaction("readwrite", [TRACK_STORE, MANIFEST_STORE], async (tx) => {
    await requestToPromise(tx.objectStore(TRACK_STORE).clear());
    await requestToPromise(tx.objectStore(MANIFEST_STORE).clear());
  });
}

export async function putOfflineManifest(
  entityType: OfflineManifestRecord["entityType"],
  entityId: string,
  entityName: string,
  fileIds: string[],
  includeSubfolders?: boolean,
) {
  return runTransaction("readwrite", MANIFEST_STORE, async (tx) => {
    const key = getManifestKey(entityType, entityId);
    await requestToPromise(
      tx.objectStore(MANIFEST_STORE).put({
        key,
        entityType,
        entityId,
        entityName,
        fileIds,
        includeSubfolders,
        createdAt: Date.now(),
      } satisfies OfflineManifestRecord),
    );
  });
}

export async function getAllOfflineManifests() {
  return runTransaction("readonly", MANIFEST_STORE, async (tx) => {
    const manifests = await requestToPromise(tx.objectStore(MANIFEST_STORE).getAll());
    return manifests as OfflineManifestRecord[];
  });
}

export function toOfflineTrackRecord(file: DriveFile, blob: Blob, source: OfflineSource): OfflineTrackRecord {
  return {
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    sizeBytes: blob.size,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
    source,
    blob,
    parents: file.parents,
  };
}

export async function getOfflineBlobUrl(fileId: string) {
  const record = await getOfflineTrackRecord(fileId);
  if (!record) return null;

  await putOfflineTrackRecord({
    ...record,
    lastAccessedAt: Date.now(),
  });

  return URL.createObjectURL(record.blob);
}
