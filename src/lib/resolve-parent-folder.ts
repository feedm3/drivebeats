import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { FOLDER_MIME } from "@/types";

export function resolveParentFolderName(
  parentId: string | undefined,
): string | undefined {
  if (!parentId) return undefined;

  const { rootFolders } = useImportedDriveStore.getState();
  const root = rootFolders.find((f) => f.id === parentId);
  if (root) return root.name;

  const cache = useFolderCacheStore.getState().cache;
  for (const [, entry] of cache) {
    const folder = entry.files.find(
      (f) => f.id === parentId && f.mimeType === FOLDER_MIME,
    );
    if (folder) return folder.name;
  }

  return undefined;
}
