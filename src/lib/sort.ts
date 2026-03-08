import type { DriveFile } from "@/types";

export function sortFoldersNatural(folders: DriveFile[]): DriveFile[] {
  return [...folders].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
}
