import { matchesFileSearch } from "@/lib/file-search";
import type { DriveFile, FolderEntry } from "@/types";
import { INITIAL_STACK } from "@/types";

export interface LibrarySearchPath {
  contextLabel: string;
  folderStack: FolderEntry[];
  importedRootId: string;
  relativePath: string;
}

export interface LibrarySearchTrack extends DriveFile {
  contextLabel: string;
  folderStack: FolderEntry[];
  importedRootId: string | null;
  importedRootPaths: LibrarySearchPath[];
  relativePath: string;
}

interface BuildLibrarySearchCatalogInput {
  audioFiles: DriveFile[];
  folders: DriveFile[];
  importedFolders: DriveFile[];
  standaloneTracks: DriveFile[];
}

export class LibrarySearchCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarySearchCatalogError";
  }
}

function resolveImportedFolderPath(
  track: DriveFile,
  foldersById: Map<string, DriveFile>,
  importedFoldersById: Map<string, DriveFile>,
): LibrarySearchTrack | null {
  const parentId = track.parents?.[0];
  if (!parentId) {
    return null;
  }

  const descendantFolders: DriveFile[] = [];
  const importedRootPaths: LibrarySearchPath[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = parentId;

  while (currentId && currentId !== "root") {
    if (visited.has(currentId)) {
      throw new LibrarySearchCatalogError(
        `Circular Drive ancestry while resolving ${track.id}`,
      );
    }
    visited.add(currentId);

    const importedRoot = importedFoldersById.get(currentId);
    if (importedRoot) {
      const foldersFromRoot = [importedRoot, ...descendantFolders.toReversed()];
      const relativeFolders = foldersFromRoot.slice(1);
      const relativePath = relativeFolders
        .map((folder) => folder.name)
        .join("/");

      importedRootPaths.push({
        contextLabel: relativePath || importedRoot.name,
        folderStack: [
          ...INITIAL_STACK,
          ...foldersFromRoot.map((folder) => ({
            id: folder.id,
            name: folder.name,
          })),
        ],
        importedRootId: importedRoot.id,
        relativePath,
      });
      descendantFolders.push(importedRoot);
      currentId = importedRoot.parents?.[0];
      continue;
    }

    const folder = foldersById.get(currentId);
    if (!folder) {
      // A complete Drive listing can still expose an audio item while hiding
      // part of its ancestry (for example, an item shared independently of its
      // parent tree). If the visible chain never reaches an Imported Folder,
      // the item is outside the proven Library boundary and is ignored.
      break;
    }

    descendantFolders.push(folder);
    currentId = folder.parents?.[0];
  }

  const closestPath = importedRootPaths[0];
  return closestPath ? { ...track, ...closestPath, importedRootPaths } : null;
}

function standaloneCatalogTrack(track: DriveFile): LibrarySearchTrack {
  return {
    ...track,
    contextLabel: "Imported individually",
    folderStack: [...INITIAL_STACK],
    importedRootId: null,
    importedRootPaths: [],
    relativePath: "",
  };
}

export function buildLibrarySearchCatalog({
  audioFiles,
  folders,
  importedFolders,
  standaloneTracks,
}: BuildLibrarySearchCatalogInput): LibrarySearchTrack[] {
  const importedFoldersById = new Map(
    importedFolders.map((folder) => [folder.id, folder]),
  );
  const standaloneTracksById = new Map(
    standaloneTracks.map((track) => [track.id, track]),
  );
  const foldersById = new Map(
    [...folders, ...importedFolders].map((folder) => [folder.id, folder]),
  );
  const uniqueAudioFiles = new Map(
    [...audioFiles, ...standaloneTracks].map((track) => [track.id, track]),
  );
  const tracks: LibrarySearchTrack[] = [];

  for (const track of uniqueAudioFiles.values()) {
    const resolved = resolveImportedFolderPath(
      track,
      foldersById,
      importedFoldersById,
    );

    if (resolved) {
      tracks.push(resolved);
      continue;
    }

    if (standaloneTracksById.has(track.id)) {
      tracks.push(standaloneCatalogTrack(track));
    }
  }

  return tracks;
}

export function searchLibraryCatalog(
  catalog: LibrarySearchTrack[],
  query: string,
) {
  return catalog.filter((track) => matchesFileSearch(track, query));
}

export function filterLibraryCatalogToCurrentImports(
  catalog: LibrarySearchTrack[],
  importedFolders: DriveFile[],
  standaloneTracks: DriveFile[],
) {
  const importedFolderIds = new Set(importedFolders.map((folder) => folder.id));
  const standaloneTrackIds = new Set(standaloneTracks.map((track) => track.id));

  return catalog.flatMap((track) => {
    if (!track.importedRootId) {
      return standaloneTrackIds.has(track.id) ? [track] : [];
    }

    const activePath = track.importedRootPaths?.find((path) =>
      importedFolderIds.has(path.importedRootId),
    );
    if (activePath) {
      return [{ ...track, ...activePath }];
    }

    // Catalogs created before overlapping-root paths were recorded remain
    // usable until their normal refresh replaces them.
    return importedFolderIds.has(track.importedRootId) ? [track] : [];
  });
}
