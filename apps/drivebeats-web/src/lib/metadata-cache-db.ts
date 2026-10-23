import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { MetadataRecord } from "@/lib/metadata-cache-types";

interface MetadataCacheSchema extends DBSchema {
  records: {
    key: [string, string];
    value: MetadataRecord;
    indexes: { account: string };
  };
  epochs: { key: string; value: number };
  portable: {
    key: string;
    value: PortableCacheEntry;
    indexes: { account: string };
  };
}
let dbPromise: Promise<IDBPDatabase<MetadataCacheSchema>> | null = null;
function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (dbPromise) return dbPromise;
  const opening = openDB<MetadataCacheSchema>("drivebeats-track-metadata", 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore("records", {
          keyPath: ["accountId", "fileId"],
        });
        store.createIndex("account", "accountId");
        db.createObjectStore("epochs");
      }
      const portable = db.createObjectStore("portable", { keyPath: "id" });
      portable.createIndex("account", "accountId");
    },
    // A newer tab may upgrade the cache without waiting for this tab to close.
    blocking() {
      const previous = dbPromise;
      dbPromise = null;
      void previous?.then((db) => db.close());
    },
    terminated() {
      dbPromise = null;
    },
  });
  let abandoned = false;
  dbPromise = new Promise<IDBPDatabase<MetadataCacheSchema>>(
    (resolve, reject) => {
      const deadline = setTimeout(() => {
        abandoned = true;
        reject(new Error("metadata_storage_blocked_close_other_tabs"));
      }, 15_000);
      void opening.then(
        (db) => {
          clearTimeout(deadline);
          if (abandoned) db.close();
          else resolve(db);
        },
        (error) => {
          clearTimeout(deadline);
          reject(error);
        },
      );
    },
  ).catch((error) => {
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

export interface PortableCacheEntry {
  id: string;
  accountId: string;
  generation: string;
  kind: "outbox" | "ack" | "dirty";
  bytes: number;
  sequence?: number;
  /** A persisted seal makes the exact command immutable across every tab. */
  sealed?: boolean;
  /** Root edits created during restore cannot be sent until their base is resolved. */
  readyToSeal?: boolean;
  payload: unknown;
}

export async function readPortableCache(accountId: string) {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  return (await db.getAllFromIndex("portable", "account", accountId)).sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );
}

export async function readPortableOutbox(id: string) {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  return db.get("portable", id);
}

/** Count and byte limits are checked with the write, including across tabs. */
export async function savePortableOutbox(
  entry: PortableCacheEntry,
  draftMode?: "create" | "append",
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const entries = await tx.store.index("account").getAll(entry.accountId);
  const existing = entries.find((item) => item.id === entry.id);
  if (
    (draftMode === "append" && (!existing || existing.sealed)) ||
    (draftMode === "create" && existing)
  ) {
    await tx.done;
    return false;
  }
  const pending = entries.filter(
    (item) => item.kind === "outbox" && item.id !== entry.id,
  );
  if (
    pending.length >= 2048 ||
    pending.reduce((sum, item) => sum + item.bytes, 0) + entry.bytes >
      8 * 1024 * 1024
  ) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error("backup_queue_full");
  }
  await tx.store.put({
    ...entry,
    sealed: draftMode ? false : (entry.sealed ?? true),
    sequence:
      existing?.sequence ??
      Math.max(0, ...entries.map((item) => item.sequence ?? 0)) + 1,
  });
  await tx.done;
  return true;
}

/** Atomically freeze each snapshot before any tab may send it over the network. */
export async function sealPortableOutbox(
  accountId: string,
): Promise<PortableCacheEntry[]> {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const entries = (await tx.store.index("account").getAll(accountId))
    .filter((entry) => entry.kind === "outbox" && entry.readyToSeal !== false)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  for (const entry of entries) {
    entry.sealed = true;
    await tx.store.put(entry);
  }
  await tx.done;
  return entries;
}

/** Rebase only the exact unpublished body observed by the caller. */
export async function replacePortableOutbox(
  entry: PortableCacheEntry,
  expectedPayload: unknown,
): Promise<PortableCacheEntry | null> {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const existing = await tx.store.get(entry.id);
  if (
    !existing ||
    JSON.stringify(existing.payload) !== JSON.stringify(expectedPayload)
  ) {
    await tx.done;
    return existing ?? null;
  }
  const updated = { ...entry, sequence: existing.sequence };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/** Replace a provably cancelled server reservation with one durable successor. */
export async function renewPortableOutboxIdentity(
  entry: PortableCacheEntry,
  expectedPayload: unknown,
): Promise<PortableCacheEntry | null> {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const originalId = (expectedPayload as { operationId: string }).operationId;
  const existing = await tx.store.get(originalId);
  if (
    !existing ||
    JSON.stringify(existing.payload) !== JSON.stringify(expectedPayload)
  ) {
    await tx.done;
    return existing ?? null;
  }
  const successor = { ...entry, sequence: existing.sequence, sealed: true };
  await tx.store.put(successor);
  await tx.store.delete(originalId);
  await tx.done;
  return successor;
}

const dirtyId = (accountId: string, generation: string) =>
  `metadata-dirty:${accountId}:${generation}`;
export async function markPortableMetadataDirty(
  accountId: string,
  generation: string,
) {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const token = crypto.randomUUID();
  await db.put("portable", {
    id: dirtyId(accountId, generation),
    accountId,
    generation,
    kind: "dirty",
    bytes: 0,
    payload: { token },
  });
  return token;
}
export async function clearPortableMetadataDirty(
  accountId: string,
  generation: string,
  expectedToken?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const id = dirtyId(accountId, generation);
  const entry = await tx.store.get(id);
  if (
    expectedToken === undefined ||
    (entry?.payload as { token?: string } | null)?.token === expectedToken
  )
    await tx.store.delete(id);
  await tx.done;
}

/** Only the exact accepted command may be removed; a changed local tail survives. */
export async function acknowledgePortableOutbox(
  id: string,
  expectedPayload: unknown,
  committedRevision?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("durable_storage_unavailable");
  const tx = db.transaction("portable", "readwrite");
  const entry = await tx.store.get(id);
  if (
    entry &&
    JSON.stringify(entry.payload) !== JSON.stringify(expectedPayload)
  ) {
    await tx.done;
    return false;
  }
  if (
    entry &&
    Number.isSafeInteger(committedRevision) &&
    (expectedPayload as { kind?: string })?.kind === "roots"
  ) {
    // The server rejected every successor at its original base while this
    // predecessor held the write fence. Advancing later local commands here
    // preserves their causal order, including remove then deliberate reimport.
    const later = await tx.store.index("account").getAll(entry.accountId);
    for (const candidate of later) {
      const command = candidate.payload as {
        kind?: string;
        baseRevision?: number;
      };
      if (
        candidate.kind !== "outbox" ||
        candidate.generation !== entry.generation ||
        (candidate.sequence ?? 0) <= (entry.sequence ?? 0) ||
        command?.kind !== "roots" ||
        (command.baseRevision ?? 0) >= (committedRevision as number)
      )
        continue;
      const payload = {
        ...(candidate.payload as object),
        baseRevision: committedRevision,
      };
      await tx.store.put({
        ...candidate,
        payload,
        bytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
      });
    }
  }
  await tx.store.delete(id);
  await tx.done;
  return true;
}

export async function clearPortableCache(accountId: string) {
  const db = await getDb();
  if (!db) return;
  const tx = db.transaction("portable", "readwrite");
  let cursor = await tx.store.index("account").openCursor(accountId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
