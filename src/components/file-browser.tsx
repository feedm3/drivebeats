"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import type { DriveFile, FolderEntry } from "@/types";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { FileList } from "@/components/file-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";


export function FileBrowser() {
  const { getValidAccessToken, logout } = useAuthStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string>("");
  const initialStack: FolderEntry[] = [{ id: "root", name: "My Drive" }];
  const [folderStack, setFolderStack] = useState<FolderEntry[]>(initialStack);
  const currentFolderId = folderStack[folderStack.length - 1].id;

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    window.history.replaceState({ folderStack: initialStack }, "");

    const onPopState = (e: PopStateEvent) => {
      if (e.state?.folderStack) {
        setFolderStack(e.state.folderStack);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { getFiles: getCachedFiles, setFiles: setCachedFiles, isStale } = useFolderCacheStore();
  const bgFetchRef = useRef(false);

  const fetchFromApi = useCallback(
    async (folderId: string): Promise<DriveFile[] | null> => {
      const token = await getValidAccessToken();
      if (!token) {
        logout();
        return null;
      }
      setAccessToken(token);

      try {
        const res = await fetch(
          `/api/drive/files?folderId=${encodeURIComponent(folderId)}&accessToken=${encodeURIComponent(token)}`,
        );
        if (res.ok) {
          const data: DriveFile[] = await res.json();
          setCachedFiles(folderId, data);
          return data;
        }
        if (res.status === 401) {
          toast.error("Session expired. Please sign in again.");
          logout();
        } else if (res.status === 403) {
          toast.error("Access denied. Check your Google Drive permissions.");
        } else if (res.status === 429) {
          toast.error("Too many requests. Please wait a moment.");
        } else {
          toast.error("Failed to load files. Please try again.");
        }
      } catch {
        toast.error("Network error. Check your connection.");
      }
      return null;
    },
    [getValidAccessToken, logout, setCachedFiles],
  );

  const navigateToFolder = useCallback(
    async (folderId: string) => {
      const cached = getCachedFiles(folderId);

      if (cached) {
        // Cache hit — show cached data immediately
        setFiles(cached.files);
        setLoading(false);

        if (isStale(folderId)) {
          // Background revalidate
          bgFetchRef.current = true;
          const fresh = await fetchFromApi(folderId);
          bgFetchRef.current = false;
          if (fresh) setFiles(fresh);
        }
      } else {
        // Cache miss — loading state + fetch
        setLoading(true);
        const data = await fetchFromApi(folderId);
        if (data) setFiles(data);
        setLoading(false);
      }
    },
    [getCachedFiles, isStale, fetchFromApi],
  );

  useEffect(() => {
    navigateToFolder(currentFolderId);
  }, [currentFolderId, navigateToFolder]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const data = await fetchFromApi(currentFolderId);
    if (data) setFiles(data);
    setRefreshing(false);
  }, [currentFolderId, fetchFromApi]);

  const onFolderClick = (id: string, name: string) => {
    setFolderStack((s) => {
      const newStack = [...s, { id, name }];
      window.history.pushState({ folderStack: newStack }, "");
      return newStack;
    });
  };

  const onBreadcrumbNavigate = (index: number) => {
    setFolderStack((s) => {
      const newStack = s.slice(0, index + 1);
      window.history.pushState({ folderStack: newStack }, "");
      return newStack;
    });
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden px-4 pt-8">
      <div className="flex items-center justify-between">
        <BreadcrumbNav
          folderStack={folderStack}
          onNavigate={onBreadcrumbNavigate}
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-muted-foreground h-8 w-8" onClick={onRefresh} disabled={refreshing}>
            <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { usePlayerStore.getState().clearCache(); useFolderCacheStore.getState().clear(); logout(); }}>
            Sign out
          </Button>
        </div>
      </div>
      <Separator className="my-3" />
      <FileList
        files={files}
        loading={loading}
        accessToken={accessToken}
        onFolderClick={onFolderClick}
      />
    </div>
  );
}
