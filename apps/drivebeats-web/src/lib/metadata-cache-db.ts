import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { MetadataRecord } from "@/lib/metadata-cache-types";

interface MetadataCacheSchema extends DBSchema {
  records: {
    key: [string, string];
    value: MetadataRecord;
    indexes: { account: string };
  };
  epochs: { key: string; value: number };
}
let dbPromise: Promise<IDBPDatabase<MetadataCacheSchema>> | null = null;
function getDb() {
  if (typeof indexedDB === "undefined") return null;
  dbPromise ??= openDB<MetadataCacheSchema>("drivebeats-track-metadata", 1, {
    upgrade(db) {
      const store = db.createObjectStore("records", {
        keyPath: ["accountId", "fileId"],
      });
      store.createIndex("account", "accountId");
      db.createObjectStore("epochs");
    },
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export async function loadMetadataCache(accountId: string): Promise<{
  records: MetadataRecord[];
  epoch: number;
  durable: boolean;
}> {
  try {
    const db = await getDb();
    if (!db) return { records: [], epoch: 0, durable: false };
    const tx = db.transaction(["records", "epochs"], "readonly");
    const [records, epoch] = await Promise.all([
      tx.objectStore("records").index("account").getAll(accountId, 20_000),
      tx.objectStore("epochs").get(accountId),
    ]);
    await tx.done;
    return { records, epoch: epoch ?? 0, durable: true };
  } catch {
    return { records: [], epoch: 0, durable: false };
  }
}

export async function loadMetadataRecord(
  accountId: string,
  fileId: string,
): Promise<{ record?: MetadataRecord; epoch: number } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const tx = db.transaction(["records", "epochs"], "readonly");
    const [record, epoch] = await Promise.all([
      tx.objectStore("records").get([accountId, fileId]),
      tx.objectStore("epochs").get(accountId),
    ]);
    await tx.done;
    return { record, epoch: epoch ?? 0 };
  } catch {
    return null;
  }
}

/** Read the logout fence and write in the SAME transaction, including across tabs. */
export async function saveMetadataRecord(
  record: MetadataRecord,
  epoch: number,
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const tx = db.transaction(["records", "epochs"], "readwrite");
    const currentEpoch =
      (await tx.objectStore("epochs").get(record.accountId)) ?? 0;
    if (currentEpoch !== epoch) {
      await tx.done;
      return false;
    }
    await tx.objectStore("records").put(record);
    await tx.done;
    return true;
  } catch {
    return false;
  }
}

export async function clearMetadataCache(accountId: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const tx = db.transaction(["records", "epochs"], "readwrite");
    const epochs = tx.objectStore("epochs");
    const epoch = (await epochs.get(accountId)) ?? 0;
    await epochs.put(epoch + 1, accountId);
    const records = tx.objectStore("records");
    let cursor = await records.index("account").openCursor(accountId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
    return true;
  } catch {
    /* Session state is fenced even when durable storage fails. */
    return false;
  }
}

/** One consistent account snapshot, streamed without hydrating every tag into Zustand. */
export async function scanMetadataRecords(
  accountId: string,
  visit: (record: MetadataRecord) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const db = await getDb();
    signal?.throwIfAborted();
    if (!db) return false;
    const tx = db.transaction("records", "readonly");
    let cursor = await tx.store.index("account").openCursor(accountId);
    while (cursor) {
      if (signal?.aborted) {
        tx.abort();
        await tx.done.catch(() => {});
        signal.throwIfAborted();
      }
      visit(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

/** Small folder searches read only their own IDs in one consistent transaction. */
export async function readMetadataRecords(
  accountId: string,
  fileIds: string[],
  visit: (record: MetadataRecord) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const db = await getDb();
    signal?.throwIfAborted();
    if (!db) return false;
    const tx = db.transaction("records", "readonly");
    const records = await Promise.all(
      fileIds.map((id) => tx.store.get([accountId, id])),
    );
    await tx.done;
    signal?.throwIfAborted();
    for (const record of records) if (record) visit(record);
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}
