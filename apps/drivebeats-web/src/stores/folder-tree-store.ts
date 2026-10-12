import { create } from "zustand";
import type { FolderEntry } from "@/types";

interface FolderTreeState {
  expandedFolders: Set<string>;
  toggle: (folderId: string) => void;
  expand: (folderId: string) => void;
  expandPath: (folderStack: FolderEntry[]) => void;
}

export const useFolderTreeStore = create<FolderTreeState>((set) => ({
  expandedFolders: new Set<string>(),

  toggle: (folderId) => {
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return { expandedFolders: next };
    });
  },

  expand: (folderId) => {
    set((state) => {
      if (state.expandedFolders.has(folderId)) return state;
      const next = new Set(state.expandedFolders);
      next.add(folderId);
      return { expandedFolders: next };
    });
  },

  expandPath: (folderStack) => {
    set((state) => {
      const next = new Set(state.expandedFolders);
      let changed = false;
      for (const entry of folderStack) {
        if (!next.has(entry.id)) {
          next.add(entry.id);
          changed = true;
        }
      }
      return changed ? { expandedFolders: next } : state;
    });
  },
}));
