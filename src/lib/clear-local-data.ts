"use client";

import { toast } from "sonner";
import { clearFolderListings } from "@/lib/folder-cache-db";
import { clearOfflineDownloadDiagnostics } from "@/lib/offline-download-diagnostics";
import { offlineDownloadManager } from "@/lib/offline-download-manager";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";

const APP_STORAGE_KEYS = [
  "sidebar-width",
  "sidebar-folders-collapsed",
  "sidebar-playlists-collapsed",
];

async function purgeServiceWorkerCaches() {
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage("CLEAR_CACHES");
    }
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // SW or Cache API unavailable
  }
}

export async function clearLocalData() {
  toast.dismiss();

  usePlayerStore.getState().resetPlayback();
  usePlayerStore.getState().clearCache();
  usePlayerStore.setState({
    currentTrack: null,
    playingFolderStack: [],
    playingPlaylistId: null,
    playlist: [],
    currentIndex: -1,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    volume: 0.7,
    isMuted: false,
    shuffle: false,
    repeat: "off",
    isLoading: false,
  });
  usePlayerStore.persist.clearStorage();

  useLibraryStore.getState().clearAll();
  useLibraryStore.persist.clearStorage();

  usePlaylistStore.getState().clearCloudState();
  usePlaylistStore.persist.clearStorage();

  useId3MetadataStore.getState().clearAll();
  useId3MetadataStore.persist.clearStorage();

  try {
    await offlineDownloadManager.removeAllDownloads();
  } catch {
    // best-effort
  }

  useFolderCacheStore.getState().clear();
  // `clear()` empties the in-memory map and fires the IndexedDB wipe, but
  // logout redirects right after, so await the wipe here to make sure the
  // persisted folder listings are really gone before the page navigates.
  try {
    await clearFolderListings();
  } catch {
    // best-effort
  }

  useImportedDriveStore.getState().clear();
  useImportedDriveStore.persist.clearStorage();

  for (const key of APP_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
  clearOfflineDownloadDiagnostics();

  await purgeServiceWorkerCaches();
}

export async function logoutAndRedirect() {
  useAuthStore.getState().setLoggingOut(true);
  await clearLocalData();
  await useAuthStore.getState().logout();
  window.location.href = "/";
}
