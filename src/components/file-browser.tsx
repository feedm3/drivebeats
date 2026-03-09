"use client";

import { Filter, Loader2, RotateCw } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { FileList } from "@/components/file-list";
import { FolderFilterDialog } from "@/components/folder-filter-dialog";
import { FolderSearch } from "@/components/folder-search";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Separator } from "@/components/ui/separator";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { sortFoldersNatural } from "@/lib/sort";
import { getHistoryStateWithFolderStack } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderFilterStore } from "@/stores/folder-filter-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

interface FileBrowserProps {
  externalFolderStack?: FolderEntry[];
  onFolderNavigate?: (folderStack: FolderEntry[]) => void;
}

export function FileBrowser({
  externalFolderStack,
  onFolderNavigate,
}: FileBrowserProps) {
  const { fetchFromApi, fetchFolderContents, getAccessToken } =
    useFolderContents();
  const getCachedFiles = useFolderCacheStore((state) => state.getFiles);
  const hiddenFolderIds = useFolderFilterStore(
    (state) => state.hiddenFolderIds,
  );

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [rootFolders, setRootFolders] = useState<DriveFile[]>([]);
  const [loadingRootFolders, setLoadingRootFolders] = useState(false);
  const [internalFolderStack, setInternalFolderStack] =
    useState<FolderEntry[]>(INITIAL_STACK);

  const isControlled = externalFolderStack !== undefined;
  const folderStack = isControlled ? externalFolderStack : internalFolderStack;
  const currentFolderId = folderStack[folderStack.length - 1].id;
  const folderStackRef = useRef(folderStack);
  const currentFolderIdRef = useRef(currentFolderId);
  const isMountedRef = useRef(true);
  const navigationRequestRef = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    if (isControlled) return;

    const historyFolderStack = window.history.state?.folderStack;
    if (Array.isArray(historyFolderStack) && historyFolderStack.length > 0) {
      setInternalFolderStack(historyFolderStack);
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
        setInternalFolderStack(e.state.folderStack);
      } else {
        setInternalFolderStack(INITIAL_STACK);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isControlled]);

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

  const navigateToFolder = useCallback(
    async (folderId: string) => {
      const requestId = navigationRequestRef.current + 1;
      navigationRequestRef.current = requestId;
      const canCommit = () =>
        isMountedRef.current &&
        navigationRequestRef.current === requestId &&
        currentFolderIdRef.current === folderId;

      await fetchFolderContents(folderId, {
        onFiles: (fetchedFiles) => {
          setFiles(fetchedFiles);
          const token = getAccessToken();
          if (token) setAccessToken(token);
        },
        onLoadingChange: setLoading,
        canCommit,
      });
    },
    [fetchFolderContents, getAccessToken],
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

  const pushFolderStack = useCallback(
    (newStack: FolderEntry[]) => {
      folderStackRef.current = newStack;
      setSearchQuery("");

      if (isControlled && onFolderNavigate) {
        onFolderNavigate(newStack);
      } else {
        setInternalFolderStack(newStack);
        window.history.pushState(getHistoryStateWithFolderStack(newStack), "");
      }
    },
    [isControlled, onFolderNavigate],
  );

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

  const ensureRootFolders = useCallback(async () => {
    const cached = getCachedFiles("root");
    if (cached) {
      setRootFolders(
        sortFoldersNatural(
          cached.files.filter((file) => file.mimeType === FOLDER_MIME),
        ),
      );
      return;
    }

    setLoadingRootFolders(true);
    const rootFiles = await fetchFromApi("root");
    if (rootFiles) {
      setRootFolders(
        sortFoldersNatural(
          rootFiles.filter((file) => file.mimeType === FOLDER_MIME),
        ),
      );
    }
    setLoadingRootFolders(false);
  }, [fetchFromApi, getCachedFiles]);

  const openFolderFilter = useCallback(() => {
    setFilterOpen(true);
    void ensureRootFolders();
  }, [ensureRootFolders]);

  return (
    <>
      <div className="mx-auto flex h-full flex-col overflow-hidden px-4 pt-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <BreadcrumbNav
            folderStack={folderStack}
            onNavigate={onBreadcrumbNavigate}
          />
          <div className="flex items-center gap-2">
            <FolderSearch value={searchQuery} onChange={setSearchQuery} />
            <IconTooltip label="Filter folders">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative size-8 text-muted-foreground md:hidden"
                onClick={openFolderFilter}
                aria-label="Filter folders"
              >
                {loadingRootFolders ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Filter className="size-4" />
                )}
                {hiddenFolderIds.size > 0 && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                )}
              </Button>
            </IconTooltip>
            <IconTooltip
              label={refreshing ? "Refreshing folder" : "Refresh folder"}
            >
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-8"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label={refreshing ? "Refreshing folder" : "Refresh folder"}
              >
                <RotateCw
                  className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </Button>
            </IconTooltip>
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
      <FolderFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        folders={rootFolders}
        loading={loadingRootFolders}
      />
    </>
  );
}
