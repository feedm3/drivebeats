"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { getSupportedAudioQuery } from "@/lib/audio";
import {
  listGoogleDriveFiles,
  type GoogleDriveFilesListResponse,
} from "@/lib/google-api";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import {
  getImportedLibraryRootEntries,
  useImportedDriveStore,
} from "@/stores/imported-drive-store";
import type { DriveFile } from "@/types";
import { ROOT_FOLDER_ID } from "@/types";

export function useFolderContents() {
  const fetchFromApi = useCallback(
    async (folderId: string): Promise<DriveFile[] | null> => {
      if (folderId === ROOT_FOLDER_ID) {
        return getImportedLibraryRootEntries(useImportedDriveStore.getState());
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
        return null;
      }

      const token = await useAuthStore.getState().getValidAccessToken();
      if (!token) {
        useAuthStore.getState().logout();
        return null;
      }

      try {
        const query = getSupportedAudioQuery(folderId);
        const params = new URLSearchParams({
          q: query,
          fields: "files(id,name,mimeType,size,modifiedTime,parents)",
          orderBy: "folder,name",
          pageSize: "1000",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        const res = await listGoogleDriveFiles(token, params);
        if (res.ok) {
          const data = (await res.json()) as GoogleDriveFilesListResponse;
          const files = data.files ?? [];
          useFolderCacheStore.getState().setFiles(folderId, files);
          return files;
        }
        if (res.status === 401) {
          if (!useAuthStore.getState().isLoggingOut) {
            toast.error("Session expired. Please sign in again.");
          }
          useAuthStore.getState().logout();
        } else if (res.status === 403) {
          if (!useAuthStore.getState().isLoggingOut) {
            toast.error("Access denied. Check your Google Drive permissions.");
          }
        } else if (res.status === 429) {
          if (!useAuthStore.getState().isLoggingOut) {
            toast.error("Too many requests. Please wait a moment.");
          }
        } else {
          if (!useAuthStore.getState().isLoggingOut) {
            toast.error("Failed to load files. Please try again.");
          }
        }
      } catch {
        if (!useAuthStore.getState().isLoggingOut) {
          toast.error("Network error. Check your connection.");
        }
      }
      return null;
    },
    [],
  );

  const fetchFolderContents = useCallback(
    async (
      folderId: string,
      callbacks: {
        onFiles: (files: DriveFile[]) => void;
        onLoadingChange: (loading: boolean) => void;
        canCommit: () => boolean;
      },
    ) => {
      const { onFiles, onLoadingChange, canCommit } = callbacks;

      if (folderId === ROOT_FOLDER_ID) {
        if (canCommit()) {
          onFiles(getImportedLibraryRootEntries(useImportedDriveStore.getState()));
          onLoadingChange(false);
        }
        return;
      }

      const cached = useFolderCacheStore.getState().getFiles(folderId);

      if (cached) {
        if (canCommit()) {
          onFiles(cached.files);
          onLoadingChange(false);
        }

        if (useFolderCacheStore.getState().isStale(folderId)) {
          const fresh = await fetchFromApi(folderId);
          if (fresh && canCommit()) {
            onFiles(fresh);
          }
        }
      } else {
        if (canCommit()) {
          onLoadingChange(true);
        }
        const data = await fetchFromApi(folderId);
        if (data && canCommit()) {
          onFiles(data);
        }
        if (canCommit()) {
          onLoadingChange(false);
        }
      }
    },
    [fetchFromApi],
  );

  return {
    fetchFromApi,
    fetchFolderContents,
  };
}
