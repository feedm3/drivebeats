import { create } from "zustand";
import type { DriveFile } from "@/types";

const STALE_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  files: DriveFile[];
  fetchedAt: number;
}

interface FolderCacheState {
  cache: Map<string, CacheEntry>;
  getFiles: (folderId: string) => CacheEntry | null;
  setFiles: (folderId: string, files: DriveFile[]) => void;
  isStale: (folderId: string) => boolean;
  invalidate: (folderId?: string) => void;
  clear: () => void;
}

export const useFolderCacheStore = create<FolderCacheState>((set, get) => ({
  cache: new Map(),

  getFiles: (folderId) => {
    return get().cache.get(folderId) ?? null;
  },

  setFiles: (folderId, files) => {
    set((state) => {
      const next = new Map(state.cache);
      next.set(folderId, { files, fetchedAt: Date.now() });
      return { cache: next };
    });
  },

  isStale: (folderId) => {
    const entry = get().cache.get(folderId);
    if (!entry) return true;
    return Date.now() - entry.fetchedAt > STALE_MS;
  },

  invalidate: (folderId?) => {
    if (folderId) {
      set((state) => {
        const next = new Map(state.cache);
        next.delete(folderId);
        return { cache: next };
      });
    } else {
      set({ cache: new Map() });
    }
  },

  clear: () => {
    set({ cache: new Map() });
  },
}));
