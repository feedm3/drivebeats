import { openDB } from "idb";

const epochs = new Map<string, number>();
let clearGeneration = 0;
const database = () =>
  openDB("drivebeats-metadata-progress", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("progress"))
        db.createObjectStore("progress");
      if (!db.objectStoreNames.contains("fences"))
        db.createObjectStore("fences");
    },
  });
const EPOCH_KEY = "logout";
interface ProgressWriteOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

export async function loadBackgroundProgress<T>(
  key: string,
): Promise<T | undefined> {
  const generation = clearGeneration;
  try {
    const db = await database();
    try {
      const tx = db.transaction(["progress", "fences"], "readonly");
      const [value, epoch] = await Promise.all([
        tx.objectStore("progress").get(key),
        tx.objectStore("fences").get(EPOCH_KEY),
      ]);
      await tx.done;
      if (generation !== clearGeneration) return undefined;
      epochs.set(key, epoch ?? 0);
      return value as T | undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

export async function saveBackgroundProgress(
  key: string,
  value: unknown,
  options: ProgressWriteOptions = {},
) {
  const generation = clearGeneration;
  const current = () =>
    generation === clearGeneration &&
    !options.signal?.aborted &&
    (options.isCurrent?.() ?? true);
  if (!current()) return false;
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      16 * 1024 * 1024
    )
      return false;
    const db = await database();
    try {
      if (!current()) return false;
      const tx = db.transaction(["progress", "fences"], "readwrite");
      const epoch = (await tx.objectStore("fences").get(EPOCH_KEY)) ?? 0;
      const expected = epochs.get(key);
      if (!current() || (expected !== undefined && expected !== epoch)) {
        await tx.done;
        return false;
      }
      await tx.objectStore("progress").put(value, key);
      await tx.done;
      epochs.set(key, epoch);
      return current();
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** New append chunks inherit the main checkpoint's captured logout epoch. */
export function inheritBackgroundProgressFence(
  sourceKey: string,
  destinationKey: string,
) {
  const epoch = epochs.get(sourceKey);
  if (epoch !== undefined) epochs.set(destinationKey, epoch);
}

export async function deleteBackgroundProgress(
  key: string,
  options: { preserveFence?: boolean } = {},
) {
  try {
    const db = await database();
    try {
      await db.delete("progress", key);
      if (!options.preserveFence) epochs.delete(key);
    } finally {
      db.close();
    }
  } catch {
    /* Optional storage. */
  }
}

export async function deleteBackgroundProgressPrefix(prefix: string) {
  const generation = clearGeneration;
  try {
    const db = await database();
    try {
      if (generation !== clearGeneration) return;
      const tx = db.transaction("progress", "readwrite");
      let cursor = await tx.store.openCursor(
        IDBKeyRange.bound(prefix, `${prefix}\uffff`),
      );
      while (cursor) {
        await cursor.delete();
        epochs.delete(String(cursor.key));
        cursor = await cursor.continue();
      }
      await tx.done;
    } finally {
      db.close();
    }
  } catch {
    /* Optional checkpoint cleanup. */
  }
}

export async function clearBackgroundProgress() {
  clearGeneration += 1;
  try {
    const db = await database();
    try {
      const tx = db.transaction(["progress", "fences"], "readwrite");
      const store = tx.objectStore("fences");
      const epoch = (await store.get(EPOCH_KEY)) ?? 0;
      await store.put(epoch + 1, EPOCH_KEY);
      await tx.objectStore("progress").clear();
      await tx.done;
    } finally {
      db.close();
    }
  } catch {
    /* Session generation still prevents late local writes. */
  }
}
