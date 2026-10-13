"use client";

import { useEffect, useState } from "react";
import { GooglePickerScripts } from "@/components/google-picker-scripts";
import { useDriveImport } from "@/hooks/use-drive-import";
import type { AuthUser } from "@/lib/auth-session";
import { useAuthStore } from "@/stores/auth-store";

export function McpImportPicker({
  capability,
  user,
}: {
  capability: string;
  user: AuthUser;
}) {
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    useAuthStore.getState().hydrateServerSession(user);
  }, [user]);
  const { importFromDrive, isImporting } = useDriveImport(async (files) => {
    setError(null);
    const response = await fetch(
      `/api/mcp/import/${encodeURIComponent(capability)}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: files.map((file) => file.id) }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      const message =
        "The import could not be completed. Return to DriveBeats in ChatGPT and start Import again.";
      setError(message);
      throw new Error(message);
    }
    setComplete(true);
  });
  return (
    <>
      <GooglePickerScripts />
      <p className="break-all text-sm text-muted-foreground">
        Connected as {user.email}
      </p>
      {complete ? (
        <p role="status">
          Music imported. Return to DriveBeats in ChatGPT to browse and play it.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void importFromDrive()}
          disabled={isImporting}
          className="min-h-11 min-w-11 rounded-lg bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50"
        >
          {isImporting ? "Selecting music…" : "Choose music from Google Drive"}
        </button>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
