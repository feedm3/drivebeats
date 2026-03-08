"use client";

import { RotateCw } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { FileList } from "@/components/file-list";
import { FolderSearch } from "@/components/folder-search";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import type { DriveFile, FolderEntry } from "@/types";

const INITIAL_STACK: FolderEntry[] = [{ id: "root", name: "My Drive" }];

function getHistoryStateWithFolderStack(folderStack: FolderEntry[]) {
  return {
    ...(window.history.state ?? {}),
    folderStack,
  };
}

export function FileBrowser() {
  const getValidAccessToken = useAuthStore(
    (state) => state.getValidAccessToken,
  );
  const logout = useAuthStore((state) => state.logout);
  const getCachedFiles = useFolderCacheStore((state) => state.getFiles);
  const setCachedFiles = useFolderCacheStore((state) => state.setFiles);
  const isStale = useFolderCacheStore((state) => state.isStale);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [folderStack, setFolderStack] = useState<FolderEntry[]>(INITIAL_STACK);
  const currentFolderId = folderStack[folderStack.length - 1].id;
  const folderStackRef = useRef(folderStack);
  const currentFolderIdRef = useRef(currentFolderId);
  const isMountedRef = useRef(true);
  const navigationRequestRef = useRef(0);
  const latestAccessTokenRef = useRef("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    const historyFolderStack = window.history.state?.folderStack;
    if (Array.isArray(historyFolderStack) && historyFolderStack.length > 0) {
      setFolderStack(historyFolderStack);
    } else {
      window.history.replaceState(
        getHistoryStateWithFolderStack(INITIAL_STACK),
        "",
      );
    }

    const onPopState = (e: PopStateEvent) => {
      setSearchQuery("");
      if (
        Array.isArray(e.state?.folderStack) &&
        e.state.folderStack.length > 0
      ) {
        setFolderStack(e.state.folderStack);
      } else {
        setFolderStack(INITIAL_STACK);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    folderStackRef.current = folderStack;
    currentFolderIdRef.current = currentFolderId;
  }, [currentFolderId, folderStack]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncAccessToken = useCallback((token: string) => {
    if (latestAccessTokenRef.current === token) {
      return;
    }

    latestAccessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const fetchFromApi = useCallback(
    async (folderId: string): Promise<DriveFile[] | null> => {
      const token = await getValidAccessToken();
      if (!token) {
        logout();
        return null;
      }
      syncAccessToken(token);

      try {
        const query = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'audio/mpeg' or mimeType = 'audio/mp3')`;
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
    [getValidAccessToken, logout, setCachedFiles, syncAccessToken],
  );

  const navigateToFolder = useCallback(
    async (folderId: string) => {
      const requestId = navigationRequestRef.current + 1;
      navigationRequestRef.current = requestId;
      const canCommit = () =>
        isMountedRef.current &&
        navigationRequestRef.current === requestId &&
        currentFolderIdRef.current === folderId;

      const cached = getCachedFiles(folderId);

      if (cached) {
        // Cache hit — show cached data immediately
        if (canCommit()) {
          setFiles(cached.files);
          setLoading(false);
        }

        if (isStale(folderId)) {
          // Background revalidate
          const fresh = await fetchFromApi(folderId);
          if (fresh && canCommit()) {
            setFiles(fresh);
          }
        }
      } else {
        // Cache miss — loading state + fetch
        if (canCommit()) {
          setLoading(true);
        }
        const data = await fetchFromApi(folderId);
        if (data && canCommit()) {
          setFiles(data);
        }
        if (canCommit()) {
          setLoading(false);
        }
      }
    },
    [getCachedFiles, isStale, fetchFromApi],
  );

  useEffect(() => {
    navigateToFolder(currentFolderId);
  }, [currentFolderId, navigateToFolder]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    const folderId = currentFolderIdRef.current;
    setRefreshing(true);
    const data = await fetchFromApi(folderId);
    if (
      data &&
      isMountedRef.current &&
      currentFolderIdRef.current === folderId
    ) {
      setFiles(data);
    }
    if (isMountedRef.current) {
      setRefreshing(false);
    }
  }, [fetchFromApi]);

  const pushFolderStack = useCallback((newStack: FolderEntry[]) => {
    folderStackRef.current = newStack;
    setSearchQuery("");
    setFolderStack(newStack);
    window.history.pushState(getHistoryStateWithFolderStack(newStack), "");
  }, []);

  const onFolderClick = useCallback(
    (id: string, name: string) => {
      pushFolderStack([...folderStackRef.current, { id, name }]);
    },
    [pushFolderStack],
  );

  const onBreadcrumbNavigate = useCallback(
    (index: number) => {
      pushFolderStack(folderStackRef.current.slice(0, index + 1));
    },
    [pushFolderStack],
  );

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden px-4 pt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BreadcrumbNav
          folderStack={folderStack}
          onNavigate={onBreadcrumbNavigate}
        />
        <div className="flex items-center gap-2">
          <FolderSearch value={searchQuery} onChange={setSearchQuery} />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8"
            onClick={onRefresh}
            disabled={refreshing}
            title={refreshing ? "Refreshing folder" : "Refresh folder"}
            aria-label={refreshing ? "Refreshing folder" : "Refresh folder"}
          >
            <RotateCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>
      <Separator className="my-3" />
      <FileList
        files={files}
        loading={loading}
        accessToken={accessToken}
        folderStack={folderStack}
        searchQuery={deferredSearchQuery}
        onClearSearch={() => setSearchQuery("")}
        onFolderClick={onFolderClick}
      />
    </div>
  );
}
