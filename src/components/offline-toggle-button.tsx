"use client";

import {
  CheckCircle2,
  Download,
  LoaderCircle,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import { useOfflineStore } from "@/stores/offline-store";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface OfflineToggleButtonProps {
  file: DriveFile;
  className?: string;
  size?: "icon-sm" | "icon-xs";
}

function formatSizeMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OfflineToggleButton({
  file,
  className,
}: OfflineToggleButtonProps) {
  const item = useOfflineStore((state) => state.items[file.id]);
  const queueTrackDownload = useOfflineStore((state) => state.queueTrackDownload);
  const queueFolderDownload = useOfflineStore((state) => state.queueFolderDownload);
  const removeOfflineTrack = useOfflineStore((state) => state.removeOfflineTrack);

  const isFolder = file.mimeType === FOLDER_MIME;
  const status = item?.status ?? "not_cached";

  async function onClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();

    if (isFolder) {
      const includeSubfolders = window.confirm(
        "Include subfolders for offline download? Click Cancel to only download this folder.",
      );
      await queueFolderDownload(file, includeSubfolders);
      return;
    }

    if (status === "cached") {
      await removeOfflineTrack(file.id);
      toast.success("Removed offline copy");
      return;
    }

    await queueTrackDownload(file, "single");

    const size = Number(file.size ?? 0);
    if (size > 0) {
      toast.success(`Queued for offline download (${formatSizeMb(size)})`);
    } else {
      toast.success("Queued for offline download");
    }
  }

  const icon =
    status === "cached" ? (
      <CheckCircle2 className="size-3.5 text-emerald-600" />
    ) : status === "downloading" || status === "queued" ? (
      <LoaderCircle className="size-3.5 animate-spin" />
    ) : status === "error" ? (
      <TriangleAlert className="size-3.5 text-destructive" />
    ) : status === "stale" ? (
      <XCircle className="size-3.5 text-amber-500" />
    ) : (
      <Download className="size-3.5" />
    );

  const label = isFolder
    ? "Make folder available offline"
    : status === "cached"
      ? "Remove offline copy"
      : "Make available offline";

  return (
    <IconTooltip label={label} side="top" align="end">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} ${file.name}`}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        {icon}
      </button>
    </IconTooltip>
  );
}
