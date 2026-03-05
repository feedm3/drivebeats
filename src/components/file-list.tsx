"use client";

import type { DriveFile } from "@/types";
import { FileItem } from "@/components/file-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface FileListProps {
  files: DriveFile[];
  loading: boolean;
  accessToken: string;
  onFolderClick: (id: string, name: string) => void;
}

export function FileList({
  files,
  loading,
  accessToken,
  onFolderClick,
}: FileListProps) {
  const mp3s = files.filter(
    (f) => f.mimeType !== "application/vnd.google-apps.folder",
  );

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={`skel-${i}`} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <span>Nothing here yet</span>
        <span className="text-sm">Add MP3 files to this folder in Google Drive to see them here.</span>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-1 p-2 pb-36">
        {files.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            allMp3s={mp3s}
            accessToken={accessToken}
            onFolderClick={onFolderClick}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
