import type { StoragePersistenceStatus } from "@/stores/offline-store";

export async function requestStoragePersistence(): Promise<StoragePersistenceStatus> {
  if (typeof navigator === "undefined") return "unsupported";
  const storage = navigator.storage;
  if (!storage?.persisted || !storage.persist) return "unsupported";

  try {
    if (await storage.persisted()) return "granted";
    return (await storage.persist()) ? "granted" : "not-granted";
  } catch {
    return "not-granted";
  }
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    if (
      typeof estimate.usage !== "number" ||
      typeof estimate.quota !== "number"
    ) {
      return null;
    }
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

export function calculateIncrementalDownloadBytes(
  tracks: Array<{ fileId: string; size?: string }>,
  storedFileIds: ReadonlySet<string>,
  sharedFileIds: ReadonlySet<string>,
) {
  return tracks.reduce((total, track) => {
    if (storedFileIds.has(track.fileId) || sharedFileIds.has(track.fileId)) {
      return total;
    }
    const size = Number(track.size);
    return total + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}
