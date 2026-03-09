"use client";

import type { DriveFile } from "@/types";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils";

interface FileItemProps {
  file: DriveFile;
  allMp3s: DriveFile[];
  accessToken: string;
  onFolderClick: (id: string, name: string) => void;
}

const isFolder = (f: DriveFile) =>
  f.mimeType === "application/vnd.google-apps.folder";

function formatSize(bytes: string | undefined) {
  if (!bytes) return "";
  const n = Number(bytes);
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileItem({
  file,
  allMp3s,
  accessToken,
  onFolderClick,
}: FileItemProps) {
  const { playTrack, togglePlay, currentTrack } = usePlayerStore();
  const folder = isFolder(file);
  const isActive = currentTrack?.id === file.id;

  return (
    <button
      type="button"
      aria-label={folder ? `Open folder ${file.name}` : `Play ${file.name}`}
      onClick={() =>
        folder
          ? onFolderClick(file.id, file.name)
          : isActive
            ? togglePlay()
            : playTrack(file, allMp3s, accessToken, [])
      }
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
        isActive && "bg-primary/10 text-primary",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {folder ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
      {!folder && (
        <span className="text-xs text-muted-foreground">
          {formatSize(file.size)}
        </span>
      )}
    </button>
  );
}
