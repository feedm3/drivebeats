import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

export type FolderCheckState = "checked" | "unchecked" | "partial";

type FolderCacheEntry = {
  files: DriveFile[];
};

type FolderCache = Map<string, FolderCacheEntry>;

function hasVisibleDescendant(
  folderId: string,
  hiddenFolderIds: Set<string>,
  cache: FolderCache,
): boolean {
  const entry = cache.get(folderId);
  if (!entry) return false;

  for (const file of entry.files) {
    if (file.mimeType !== FOLDER_MIME) continue;
    if (!hiddenFolderIds.has(file.id)) return true;
    if (hasVisibleDescendant(file.id, hiddenFolderIds, cache)) return true;
  }

  return false;
}

export function shouldRenderFolderInTree(
  folderId: string,
  hiddenFolderIds: Set<string>,
  cache: FolderCache,
): boolean {
  return (
    !hiddenFolderIds.has(folderId) ||
    hasVisibleDescendant(folderId, hiddenFolderIds, cache)
  );
}

export function getFolderFilterState(
  folderId: string,
  hiddenFolderIds: Set<string>,
  cache: FolderCache,
): FolderCheckState {
  const isHidden = hiddenFolderIds.has(folderId);
  const entry = cache.get(folderId);

  if (!entry) {
    return isHidden ? "unchecked" : "checked";
  }

  const folderChildren = entry.files.filter(
    (file) => file.mimeType === FOLDER_MIME,
  );
  if (folderChildren.length === 0) {
    return isHidden ? "unchecked" : "checked";
  }

  const childStates = folderChildren.map((child) =>
    getFolderFilterState(child.id, hiddenFolderIds, cache),
  );

  if (!isHidden && childStates.every((state) => state === "checked")) {
    return "checked";
  }

  if (isHidden && childStates.every((state) => state === "unchecked")) {
    return "unchecked";
  }

  return "partial";
}
