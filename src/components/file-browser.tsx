"use client";

import { Ellipsis, RotateCw } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { DriveImportButton } from "@/components/drive-import-button";
import { FileList } from "@/components/file-list";
import { FolderSearch } from "@/components/folder-search";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useFolderContents } from "@/hooks/use-folder-contents";
import {
  getImportedLibraryRootEntries,
  useImportedDriveStore,
} from "@/stores/imported-drive-store";
import type { DriveFile, FolderEntry } from "@/types";
import { ROOT_FOLDER_ID } from "@/types";

interface FileBrowserProps {
  externalFolderStack: FolderEntry[];
  onFolderNavigate: (folderStack: FolderEntry[]) => void;
}

export function FileBrowser({
  externalFolderStack,
  onFolderNavigate,
}: FileBrowserProps) {
  const { fetchFromApi, fetchFolderContents } = useFolderContents();
  const { rootFolders: importedRootFolders, rootFiles: importedRootFiles } =
    useImportedDriveStore(
      useShallow((state) => ({
        rootFolders: state.rootFolders,
        rootFiles: state.rootFiles,
      })),
    );
  const importedRootEntries = useMemo(
    () =>
      getImportedLibraryRootEntries({
        rootFolders: importedRootFolders,
        rootFiles: importedRootFiles,
      }),
    [importedRootFiles, importedRootFolders],
  );

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const folderStack = externalFolderStack;
  const currentFolderId = folderStack[folderStack.length - 1].id;
  const folderStackRef = useRef(folderStack);
  const currentFolderIdRef = useRef(currentFolderId);
  const isMountedRef = useRef(true);
  const navigationRequestRef = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);

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
        },
        onLoadingChange: setLoading,
        canCommit,
      });
    },
    [fetchFolderContents],
  );

  useEffect(() => {
    if (currentFolderId === ROOT_FOLDER_ID) {
      setFiles(importedRootEntries);
      setLoading(false);
      return;
    }

    navigateToFolder(currentFolderId);
  }, [currentFolderId, importedRootEntries, navigateToFolder]);

  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const onRefresh = useCallback(async () => {
    if (currentFolderIdRef.current === ROOT_FOLDER_ID) {
      setFiles(getImportedLibraryRootEntries(useImportedDriveStore.getState()));
      return;
    }

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
      onFolderNavigate(newStack);
    },
    [onFolderNavigate],
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

  const onClearSearch = useCallback(() => setSearchQuery(""), []);

  const isLibraryRoot = currentFolderId === ROOT_FOLDER_ID;
  const libraryIsEmpty = importedRootEntries.length === 0;

  if (isLibraryRoot && !loading && libraryIsEmpty) {
    return (
      <div className="mx-auto flex h-full flex-col overflow-hidden px-4 pt-4 sm:pt-7">
        <div className="flex items-center gap-2">
          <BreadcrumbNav
            folderStack={folderStack}
            onNavigate={onBreadcrumbNavigate}
          />
        </div>
        <Separator className="my-2 sm:my-3" />
        <div className="flex min-h-0 flex-1 items-start">
          <div className="w-full">
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
              <div className="space-y-1">
                <h3 className="font-semibold tracking-tight">
                  Build your library with Google Picker
                </h3>
                <p className="max-w-md text-sm text-muted-foreground">
                  Import the folders or audio files you want to use in
                  DriveBeats. The app only requests access to items you choose.
                </p>
              </div>
              <DriveImportButton>Import folders or tracks</DriveImportButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full flex-col overflow-hidden px-4 pt-4 sm:pt-7">
      <div className="relative flex items-center gap-2">
        <BreadcrumbNav
          folderStack={folderStack}
          onNavigate={onBreadcrumbNavigate}
          className="min-w-0 overflow-hidden"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <FolderSearch value={searchQuery} onChange={setSearchQuery} />
          <IconTooltip
            label={refreshing ? "Refreshing folder" : "Refresh folder"}
          >
            <Button
              variant="ghost"
              size="icon"
              className="hidden text-muted-foreground size-8 sm:inline-flex"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={refreshing ? "Refreshing folder" : "Refresh folder"}
            >
              <RotateCw
                className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </IconTooltip>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground sm:hidden"
                  aria-label="More options"
                />
              }
            >
              <Ellipsis className="size-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-44">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                disabled={refreshing}
                onClick={() => {
                  setMenuOpen(false);
                  onRefresh();
                }}
              >
                <RotateCw
                  className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                Refresh folder
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Separator className="my-2 sm:my-3" />
      <FileList
        files={files}
        loading={loading}
        folderStack={folderStack}
        searchQuery={deferredSearchQuery}
        onClearSearch={onClearSearch}
        onFolderClick={onFolderClick}
      />
    </div>
  );
}
