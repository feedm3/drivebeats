"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { getSupportedAudioQuery } from "@/lib/audio";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import type { DriveFile } from "@/types";

export function useFolderContents() {
  const getValidAccessToken = useAuthStore(
    (state) => state.getValidAccessToken,
  );
  const logout = useAuthStore((state) => state.logout);
  const getCachedFiles = useFolderCacheStore((state) => state.getFiles);
  const setCachedFiles = useFolderCacheStore((state) => state.setFiles);
  const isStale = useFolderCacheStore((state) => state.isStale);
  const latestAccessTokenRef = useRef("");

  const fetchFromApi = useCallback(
    async (folderId: string): Promise<DriveFile[] | null> => {
      if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
        return null;
      }

      const token = await getValidAccessToken();
      if (!token) {
        logout();
        return null;
      }
      latestAccessTokenRef.current = token;

      try {
        const query = getSupportedAudioQuery(folderId);
        const params = new URLSearchParams({
          q: query,
          fields: "files(id,name,mimeType,size)",
          orderBy: "folder,name",
          pageSize: "1000",
        });
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (res.ok) {
          const data: { files?: DriveFile[] } = await res.json();
          const files = data.files ?? [];
          setCachedFiles(folderId, files);
          return files;
        }
        if (res.status === 401) {
          if (!useAuthStore.getState().isLoggingOut) {
            toast.error("Session expired. Please sign in again.");
          }
          logout();
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
    [getValidAccessToken, logout, setCachedFiles],
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
      const cached = getCachedFiles(folderId);

      if (cached) {
        if (canCommit()) {
          onFiles(cached.files);
          onLoadingChange(false);
        }

        if (isStale(folderId)) {
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
    [getCachedFiles, isStale, fetchFromApi],
  );

  return {
    fetchFromApi,
    fetchFolderContents,
    getAccessToken: () => latestAccessTokenRef.current,
  };
}
