"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { getSupportedAudioQuery } from "@/lib/audio";
import {
  type DriveReadFailure,
  getDriveReadFailure,
  googleDriveReadError,
} from "@/lib/drive-read-error";
import {
  type GoogleDriveFilesListResponse,
  listGoogleDriveFiles,
} from "@/lib/google-api";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import {
  getImportedLibraryRootEntries,
  useImportedDriveStore,
} from "@/stores/imported-drive-store";
import type { DriveFile } from "@/types";
import { ROOT_FOLDER_ID } from "@/types";

interface FolderReadOptions {
  canCommit?: () => boolean;
  onFailure?: (failure: DriveReadFailure) => void;
  signal?: AbortSignal;
}

interface FolderReadResult {
  files: DriveFile[] | null;
  message?: string;
  sessionExpired?: boolean;
  failure?: DriveReadFailure;
}

interface FolderRead {
  controller: AbortController;
  consumers: Set<() => boolean>;
  promise: Promise<FolderReadResult>;
  noticeShown: boolean;
}

// The tree and file pane share one browser read for the same account/folder.
const folderReads = new Map<string, FolderRead>();

async function readFolder(
  folderId: string,
  read: FolderRead,
  ownsAccount: () => boolean,
): Promise<FolderReadResult> {
  const active = () =>
    !read.controller.signal.aborted &&
    ownsAccount() &&
    [...read.consumers].some((consumer) => consumer());
  try {
    const token = await useAuthStore.getState().getValidAccessToken();
    if (!active()) return { files: null };
    if (!token) {
      return {
        files: null,
        message:
          useAuthStore.getState().authStatus === "unauthenticated"
            ? "Session expired. Please sign in again."
            : "Network error. Check your connection.",
        sessionExpired:
          useAuthStore.getState().authStatus === "unauthenticated",
      };
    }
    const allFiles: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      if (!active()) return { files: null };
      const params = new URLSearchParams({
        q: getSupportedAudioQuery(folderId),
        fields:
          "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)",
        orderBy: "folder,name",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await listGoogleDriveFiles(
        token,
        params,
        read.controller.signal,
      );
      if (!active()) return { files: null };
      if (!response.ok) {
        const failure = getDriveReadFailure(googleDriveReadError(response));
        if (failure)
          return {
            files: null,
            failure,
            message: failure.retryAfterMs
              ? `${failure.message} Retry in ${Math.ceil(failure.retryAfterMs / 1000)} seconds.`
              : failure.message,
          };
        const messages: Record<number, string> = {
          401: "Session expired. Please sign in again.",
          403: "Access denied. Check your Google Drive permissions.",
          429: "Too many requests. Please wait a moment.",
        };
        return {
          files: null,
          message:
            messages[response.status] ??
            "Failed to load files. Please try again.",
          sessionExpired: response.status === 401,
        };
      }
      const data = (await response.json()) as GoogleDriveFilesListResponse;
      if (!active()) return { files: null };
      allFiles.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    useFolderCacheStore.getState().setFiles(folderId, allFiles);
    return { files: allFiles };
  } catch (error) {
    const failure = getDriveReadFailure(error);
    if (active() && failure)
      return {
        files: null,
        failure,
        message: failure.retryAfterMs
          ? `${failure.message} Retry in ${Math.ceil(failure.retryAfterMs / 1000)} seconds.`
          : failure.message,
      };
    return active()
      ? { files: null, message: "Network error. Check your connection." }
      : { files: null };
  }
}

export function useFolderContents() {
  const fetchFromApi = useCallback(
    async (
      folderId: string,
      options: FolderReadOptions = {},
    ): Promise<DriveFile[] | null> => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const ownsAccount = () => {
        const auth = useAuthStore.getState();
        return !auth.isLoggingOut && (auth.user?.id ?? null) === userId;
      };
      const canCommit = () =>
        ownsAccount() &&
        !options.signal?.aborted &&
        (options.canCommit?.() ?? true);
      if (!canCommit()) return null;
      if (folderId === ROOT_FOLDER_ID)
        return getImportedLibraryRootEntries(useImportedDriveStore.getState());
      if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) return null;

      const key = JSON.stringify([userId, folderId]);
      let read = folderReads.get(key);
      if (!read || read.controller.signal.aborted) {
        read = {
          controller: new AbortController(),
          consumers: new Set(),
          promise: Promise.resolve({ files: null }),
          noticeShown: false,
        };
        folderReads.set(key, read);
        const pending = read;
        read.promise = readFolder(folderId, read, ownsAccount).finally(() => {
          if (folderReads.get(key) === pending) folderReads.delete(key);
        });
      }
      read.consumers.add(canCommit);
      const pending = read;
      const release = () => {
        pending.consumers.delete(canCommit);
        if (![...pending.consumers].some((consumer) => consumer()))
          pending.controller.abort();
      };
      options.signal?.addEventListener("abort", release, { once: true });
      try {
        const result = await read.promise;
        if (!canCommit()) return null;
        if (result.failure) options.onFailure?.(result.failure);
        if (result.message && !read.noticeShown) {
          read.noticeShown = true;
          toast.error(result.message);
          if (result.sessionExpired) void useAuthStore.getState().logout();
        }
        return result.files;
      } finally {
        options.signal?.removeEventListener("abort", release);
        release();
      }
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
        signal?: AbortSignal;
      },
    ) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { onFiles, onLoadingChange, signal } = callbacks;
      const canCommit = () =>
        callbacks.canCommit() &&
        !signal?.aborted &&
        (useAuthStore.getState().user?.id ?? null) === userId &&
        !useAuthStore.getState().isLoggingOut;

      if (folderId === ROOT_FOLDER_ID) {
        if (canCommit()) {
          onFiles(
            getImportedLibraryRootEntries(useImportedDriveStore.getState()),
          );
          onLoadingChange(false);
        }
        return;
      }

      // Listings are persisted in IndexedDB and hydrate asynchronously. Wait
      // for that before deciding whether this folder is cached, otherwise every
      // cold start reads an empty map, shows a skeleton and refetches folders
      // the device already has.
      await useFolderCacheStore.getState().hydrate();

      if (!canCommit()) return;
      const cached = useFolderCacheStore.getState().getFiles(folderId);

      if (cached) {
        if (canCommit()) {
          onFiles(cached.files);
          onLoadingChange(false);
        }

        if (useFolderCacheStore.getState().isStale(folderId)) {
          const fresh = await fetchFromApi(folderId, { canCommit, signal });
          if (fresh && canCommit()) {
            onFiles(fresh);
          }
        }
      } else {
        if (canCommit()) {
          onLoadingChange(true);
        }
        const data = await fetchFromApi(folderId, { canCommit, signal });
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
