import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isSupportedAudioFile } from "@/lib/audio";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface ImportedDriveState {
  rootFolders: DriveFile[];
  rootFiles: DriveFile[];
  upsertItems: (items: DriveFile[]) => void;
  clear: () => void;
}

interface ImportedDriveRootState {
  rootFolders: DriveFile[];
  rootFiles: DriveFile[];
}

function mergeById(existing: DriveFile[], incoming: DriveFile[]) {
  const byId = new Map(existing.map((file) => [file.id, file]));

  for (const file of incoming) {
    byId.set(file.id, file);
  }

  return [...byId.values()];
}

function isFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME;
}

export function getImportedLibraryRootEntries(state: ImportedDriveRootState) {
  const rootFolderIds = new Set(state.rootFolders.map((folder) => folder.id));
  const rootFiles = state.rootFiles.filter(
    (file) =>
      !(file.parents ?? []).some((parentId) => rootFolderIds.has(parentId)),
  );

  return [...state.rootFolders, ...rootFiles];
}

export const useImportedDriveStore = create<ImportedDriveState>()(
  persist(
    (set) => ({
      rootFolders: [],
      rootFiles: [],

      upsertItems: (items) => {
        const nextFolders = items.filter(isFolder);
        const nextFiles = items.filter(
          (file) => !isFolder(file) && isSupportedAudioFile(file),
        );

        set((state) => ({
          rootFolders: mergeById(state.rootFolders, nextFolders),
          rootFiles: mergeById(state.rootFiles, nextFiles),
        }));
      },

      clear: () => {
        set({
          rootFolders: [],
          rootFiles: [],
        });
      },
    }),
    {
      name: "drivebeats-imported-drive",
    },
  ),
);
