import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isSupportedAudioFile } from "@/lib/audio";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface ImportedDriveState {
  accountId: string | null;
  accountGeneration: string | null;
  bindAccount: (accountId: string, generation: string) => void;
  rootFolders: DriveFile[];
  rootFiles: DriveFile[];
  upsertItems: (items: DriveFile[]) => void;
  removeRootFolder: (id: string) => void;
  removeRootFile: (id: string) => void;
  hydrateRemoteRoots: (items: DriveFile[]) => void;
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

function sameRootEntries(existing: DriveFile[], incoming: DriveFile[]) {
  return (
    existing.length === incoming.length &&
    existing.every((file, index) => {
      const next = incoming[index];
      return (
        file.id === next.id &&
        file.name === next.name &&
        file.mimeType === next.mimeType &&
        file.size === next.size &&
        file.modifiedTime === next.modifiedTime &&
        file.parentFolderName === next.parentFolderName &&
        (file.parents ?? []).length === (next.parents ?? []).length &&
        (file.parents ?? []).every(
          (parent, position) => parent === next.parents?.[position],
        )
      );
    })
  );
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
      accountId: null,
      accountGeneration: null,
      rootFolders: [],
      rootFiles: [],
      bindAccount: (accountId, accountGeneration) => {
        set((state) =>
          state.accountId === accountId &&
          state.accountGeneration === accountGeneration
            ? state
            : {
                accountId,
                accountGeneration,
                ...((state.accountId && state.accountId !== accountId) ||
                (state.accountGeneration &&
                  state.accountGeneration !== accountGeneration)
                  ? { rootFolders: [], rootFiles: [] }
                  : {}),
              },
        );
      },

      upsertItems: (items) => {
        const nextFolders = items.filter(isFolder);
        const nextFiles = items.filter(
          (file) => !isFolder(file) && isSupportedAudioFile(file),
        );

        // Only an explicit user import emits commands; hydration below never does.
        if (typeof window !== "undefined")
          window.dispatchEvent(
            new CustomEvent("drivebeats-portable-roots", {
              detail: [...nextFolders, ...nextFiles].map((descriptor) => ({
                type: "add",
                rootKind: isFolder(descriptor) ? "folder" : "track",
                id: descriptor.id,
                descriptor,
              })),
            }),
          );
        set((state) => ({
          rootFolders: mergeById(state.rootFolders, nextFolders),
          rootFiles: mergeById(state.rootFiles, nextFiles),
        }));
      },

      hydrateRemoteRoots: (items) => {
        const folders = items.filter(isFolder);
        const files = items.filter(
          (file) => !isFolder(file) && isSupportedAudioFile(file),
        );
        set((state) => {
          const sameFolders = sameRootEntries(state.rootFolders, folders);
          const sameFiles = sameRootEntries(state.rootFiles, files);
          if (sameFolders && sameFiles) return state;
          return {
            rootFolders: sameFolders ? state.rootFolders : folders,
            rootFiles: sameFiles ? state.rootFiles : files,
          };
        });
      },

      removeRootFile: (id) => {
        if (typeof window !== "undefined")
          window.dispatchEvent(
            new CustomEvent("drivebeats-portable-roots", {
              detail: [{ type: "remove", rootKind: "track", id }],
            }),
          );
        set((state) => ({
          rootFiles: state.rootFiles.filter((file) => file.id !== id),
        }));
      },

      removeRootFolder: (id) => {
        if (typeof window !== "undefined")
          window.dispatchEvent(
            new CustomEvent("drivebeats-portable-roots", {
              detail: [{ type: "remove", rootKind: "folder", id }],
            }),
          );
        set((state) => ({
          rootFolders: state.rootFolders.filter((folder) => folder.id !== id),
        }));
      },

      clear: () => {
        set({
          accountId: null,
          accountGeneration: null,
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
