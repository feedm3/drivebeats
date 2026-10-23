"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { logoutAndRedirect } from "@/lib/clear-local-data";
import { getPendingCollectionSaveCount } from "@/lib/cloud-library-api";
import { getDriveAppDataLogoutState } from "@/lib/drive-appdata-client";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";

type LogoutState = Awaited<ReturnType<typeof getDriveAppDataLogoutState>>;

export function LogoutConfirmationDialog({
  open,
  onOpenChange,
  accountId,
  generation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  generation?: string;
}) {
  const pendingCount = useDriveAppDataStore((state) => state.pendingCount);
  const savedCount = useDriveAppDataStore((state) => state.savedCount);
  const [localState, setLocalState] = useState<LogoutState | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: completed saves refresh the local checkpoint warning.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getDriveAppDataLogoutState()
      .then((result) => {
        if (!cancelled) {
          const collections = getPendingCollectionSaveCount(
            accountId,
            generation,
          );
          setLocalState({
            ...result,
            pendingCount: result.pendingCount + collections,
            incomplete: result.incomplete || collections > 0,
          });
        }
      })
      .catch(() => {
        if (!cancelled)
          setLocalState({
            pendingCount,
            checkpointPending: true,
            incomplete: true,
          });
      });
    return () => {
      cancelled = true;
    };
    // savedCount changes also refresh a checkpoint whose pending count reached zero.
  }, [open, pendingCount, savedCount, accountId, generation]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Log out and clear this device</DialogTitle>
        <DialogDescription>
          Logging out removes cached playlists, favorites, music tags, Library
          choices, recently played tracks, offline downloads and player state
          from this browser. Your saved Google Drive backup and account
          connection are preserved.
        </DialogDescription>
        <p className="text-sm text-muted-foreground">
          Any pending changes that have not finished saving will be lost when
          you log out. Wait for saving to finish, or log out now.
        </p>
        {localState?.incomplete && (
          <p role="status" className="text-sm">
            {localState.pendingCount > 0
              ? `${localState.pendingCount} backup items are still pending.`
              : "Some music tags or Library choices have not finished saving."}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loggingOut}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void logoutAndRedirect();
            }}
          >
            {loggingOut ? "Logging out…" : "Log out and clear device"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
