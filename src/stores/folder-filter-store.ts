import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { FOLDER_MIME } from "@/types";

/** Recursively collect all cached subfolder IDs. */
function collectDescendantIds(id: string): string[] {
  const entry = useFolderCacheStore.getState().cache.get(id);
  if (!entry) return [];
  const folders = entry.files.filter((f) => f.mimeType === FOLDER_MIME);
  const ids: string[] = [];
  for (const f of folders) {
    ids.push(f.id);
    ids.push(...collectDescendantIds(f.id));
  }
  return ids;
}

interface FolderFilterState {
  hiddenFolderIds: Set<string>;
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
  hideTree: (id: string) => void;
  showTree: (id: string) => void;
  showAll: () => void;
}

export const useFolderFilterStore = create<FolderFilterState>()(
  persist(
    (set, get) => ({
      hiddenFolderIds: new Set<string>(),

      isHidden: (id) => get().hiddenFolderIds.has(id),

      toggle: (id) => {
        const next = new Set(get().hiddenFolderIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        set({ hiddenFolderIds: next });
      },

      hideTree: (id) => {
        const next = new Set(get().hiddenFolderIds);
        next.add(id);
        for (const did of collectDescendantIds(id)) next.add(did);
        set({ hiddenFolderIds: next });
      },

      showTree: (id) => {
        const next = new Set(get().hiddenFolderIds);
        next.delete(id);
        for (const did of collectDescendantIds(id)) next.delete(did);
        set({ hiddenFolderIds: next });
      },

      showAll: () => {
        set({ hiddenFolderIds: new Set() });
      },
    }),
    {
      name: "drivebeats-hidden-folders",
      partialize: (state) => ({ hiddenFolderIds: state.hiddenFolderIds }),
      storage: {
        getItem: (name) => {
          const raw = localStorage.getItem(name);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (parsed?.state?.hiddenFolderIds) {
            parsed.state.hiddenFolderIds = new Set(
              parsed.state.hiddenFolderIds,
            );
          }
          return parsed;
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              hiddenFolderIds: [...(value.state.hiddenFolderIds ?? [])],
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
