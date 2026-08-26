"use client";

import { Ellipsis, FolderPlus, Loader2, Plus, RotateCw } from "lucide-react";
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
import { type FileSearchScope, FolderSearch } from "@/components/folder-search";
import { LibrarySearchError } from "@/components/library-search-error";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  POPOVER_MENU_ITEM_CLASS,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useDriveImport } from "@/hooks/use-drive-import";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  filterLibraryCatalogToCurrentImports,
  searchLibraryCatalog,
} from "@/lib/library-search-catalog";
import {
  getImportedLibraryRootEntries,
  useImportedDriveStore,
} from "@/stores/imported-drive-store";
import { useLibrarySearchStore } from "@/stores/library-search-store";
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
  const { importFromDrive, isImporting } = useDriveImport();
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
  const [search, setSearch] = useState<{
    query: string;
    scope: FileSearchScope;
  }>({ query: "", scope: "library" });
  const searchQuery = search.query;
  const searchScope = search.scope;
  const isOnline = useOnlineStatus();
  const libraryCatalog = useLibrarySearchStore((state) => state.catalog);
  const librarySearchStatus = useLibrarySearchStore((state) => state.status);
  const librarySearchError = useLibrarySearchStore((state) => state.error);
  const librarySearchSessionOnly = useLibrarySearchStore(
    (state) => state.sessionOnly,
  );
  const librarySearchInvalidated = useLibrarySearchStore(
    (state) => state.invalidated,
  );
  const ensureLibrarySearchReady = useLibrarySearchStore(
    (state) => state.ensureReady,
  );
  const refreshLibrarySearch = useLibrarySearchStore((state) => state.refresh);

  const folderStack = externalFolderStack;
  const currentFolderId = folderStack[folderStack.length - 1].id;
  const folderStackRef = useRef(folderStack);
  const currentFolderIdRef = useRef(currentFolderId);
  const isMountedRef = useRef(true);
  const navigationRequestRef = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const hasSearchThreshold = deferredSearchQuery.trim().length >= 2;
  const librarySearchActive =
    searchScope === "library" && hasSearchThreshold && isOnline;
  const currentFolderSearchActive =
    searchScope === "folder" && hasSearchThreshold && isOnline;

  useEffect(() => {
    folderStackRef.current = folderStack;
    currentFolderIdRef.current = currentFolderId;
  }, [currentFolderId, folderStack]);

  useEffect(() => {
    setSearch((current) => {
      const scope =
        folderStack.at(-1)?.id === ROOT_FOLDER_ID ? "library" : current.scope;
      const query = current.scope === "folder" ? "" : current.query;
      return scope === current.scope && query === current.query
        ? current
        : { query, scope };
    });
  }, [folderStack]);

  // The invalidation flag is an event trigger: importing or removing a root
  // must re-run readiness even while the search text remains unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!librarySearchActive) return;
    void ensureLibrarySearchReady();
  }, [ensureLibrarySearchReady, librarySearchActive, librarySearchInvalidated]);

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

  const [refreshingFolder, setRefreshingFolder] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const onRefresh = useCallback(async () => {
    if (currentFolderIdRef.current === ROOT_FOLDER_ID) {
      setFiles(getImportedLibraryRootEntries(useImportedDriveStore.getState()));
      return;
    }

    const folderId = currentFolderIdRef.current;
    setRefreshingFolder(true);
    try {
      const data = await fetchFromApi(folderId);
      if (
        data &&
        isMountedRef.current &&
        currentFolderIdRef.current === folderId
      ) {
        setFiles(data);
      }
    } finally {
      if (isMountedRef.current) {
        setRefreshingFolder(false);
      }
    }
  }, [fetchFromApi]);

  const pushFolderStack = useCallback(
    (newStack: FolderEntry[]) => {
      folderStackRef.current = newStack;
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

  const setSearchQuery = useCallback(
    (query: string) => setSearch((current) => ({ ...current, query })),
    [],
  );
  const setSearchScope = useCallback(
    (scope: FileSearchScope) => setSearch((current) => ({ ...current, scope })),
    [],
  );
  const onClearSearch = useCallback(() => setSearchQuery(""), [setSearchQuery]);

  const isLibraryRoot = currentFolderId === ROOT_FOLDER_ID;
  const libraryIsEmpty = importedRootEntries.length === 0;
  const visibleCatalogTracks = useMemo(
    () =>
      libraryCatalog
        ? filterLibraryCatalogToCurrentImports(
            libraryCatalog.tracks,
            importedRootFolders,
            importedRootFiles,
          )
        : [],
    [importedRootFiles, importedRootFolders, libraryCatalog],
  );
  const librarySearchResults = useMemo(
    () =>
      librarySearchActive
        ? searchLibraryCatalog(visibleCatalogTracks, deferredSearchQuery)
        : [],
    [deferredSearchQuery, librarySearchActive, visibleCatalogTracks],
  );
  const contextById = useMemo(
    () =>
      librarySearchActive
        ? new Map(
            librarySearchResults.map((track) => [track.id, track.contextLabel]),
          )
        : undefined,
    [librarySearchActive, librarySearchResults],
  );
  const folderStackById = useMemo(
    () =>
      librarySearchActive
        ? new Map(
            librarySearchResults.map((track) => [track.id, track.folderStack]),
          )
        : undefined,
    [librarySearchActive, librarySearchResults],
  );
  const sortPathById = useMemo(
    () =>
      librarySearchActive
        ? new Map(
            librarySearchResults.map((track) => [track.id, track.relativePath]),
          )
        : undefined,
    [librarySearchActive, librarySearchResults],
  );
  const refreshing =
    searchScope === "library"
      ? librarySearchStatus === "loading"
      : refreshingFolder;
  const refreshLabel =
    searchScope === "library" ? "Refresh library" : "Refresh folder";
  const onRefreshSearchScope = useCallback(() => {
    if (searchScope === "library") {
      void refreshLibrarySearch();
    } else {
      void onRefresh();
    }
  }, [onRefresh, refreshLibrarySearch, searchScope]);

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
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <FolderPlus className="size-6" />
              </div>
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
        {/* gap-3 on touch so the 32px search and overflow buttons sit 44px
            apart centre-to-centre once their hit areas expand. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 pointer-coarse:gap-3">
          <IconTooltip
            label={refreshing ? `Refreshing ${searchScope}` : refreshLabel}
          >
            <Button
              variant="ghost"
              size="icon"
              className="hidden text-muted-foreground size-8 md:inline-flex"
              onClick={onRefreshSearchScope}
              disabled={refreshing || !isOnline}
              aria-label={
                refreshing ? `Refreshing ${searchScope}` : refreshLabel
              }
            >
              <RotateCw
                aria-hidden="true"
                className={`size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
            </Button>
          </IconTooltip>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  // `md`, not `sm`: the sidebar that holds the desktop "Add
                  // from Drive" only appears at 768px (app-page-client swaps to
                  // AppMobileView below that). Hiding this at 640px would strip
                  // the last import entry point between 640px and 767px.
                  className="text-muted-foreground md:hidden"
                  aria-label="More options"
                />
              }
            >
              <Ellipsis className="size-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-48">
              <button
                type="button"
                className={POPOVER_MENU_ITEM_CLASS}
                disabled={isImporting}
                onClick={() => {
                  setMenuOpen(false);
                  void importFromDrive();
                }}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Add from Drive
              </button>
              <Separator className="my-1 bg-border/60" />
              <button
                type="button"
                className={POPOVER_MENU_ITEM_CLASS}
                disabled={refreshing || !isOnline}
                onClick={() => {
                  setMenuOpen(false);
                  onRefreshSearchScope();
                }}
              >
                <RotateCw
                  aria-hidden="true"
                  className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
                {refreshLabel}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <FolderSearch
        canSearchCurrentFolder={!isLibraryRoot}
        disabled={!isOnline}
        disabledReason={
          isOnline ? undefined : "Search requires an internet connection."
        }
        value={searchQuery}
        onChange={setSearchQuery}
        scope={searchScope}
        onScopeChange={setSearchScope}
      />
      {isOnline && searchQuery.trim().length === 1 ? (
        <p className="mt-1.5 text-xs text-muted-foreground" role="status">
          Enter at least two characters to search.
        </p>
      ) : null}
      {librarySearchActive && librarySearchStatus === "loading" ? (
        <p
          className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          {libraryCatalog
            ? "Refreshing Library results…"
            : "Checking your Library…"}
        </p>
      ) : null}
      {librarySearchActive && librarySearchError ? (
        <LibrarySearchError
          hasCompleteCatalog={Boolean(libraryCatalog)}
          message={librarySearchError}
          onRetry={onRefreshSearchScope}
        />
      ) : null}
      {librarySearchActive && librarySearchSessionOnly ? (
        <p className="mt-1.5 text-xs text-muted-foreground" role="status">
          These Library results are available for this session only.
        </p>
      ) : null}
      <Separator className="my-2 sm:my-3" />
      <FileList
        contextById={contextById}
        files={librarySearchActive ? librarySearchResults : files}
        folderStackById={folderStackById}
        loading={
          librarySearchActive
            ? librarySearchStatus === "loading" && !libraryCatalog
            : loading
        }
        folderStack={folderStack}
        searchQuery={
          librarySearchActive || currentFolderSearchActive
            ? deferredSearchQuery
            : ""
        }
        searchScope={librarySearchActive ? "library" : "folder"}
        sortPathById={sortPathById}
        onClearSearch={onClearSearch}
        onFolderClick={onFolderClick}
      />
    </div>
  );
}
