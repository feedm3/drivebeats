"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SUPPORTED_AUDIO_MIME_TYPES } from "@/lib/audio";
import {
  type GoogleDriveFileMetadataResponse,
  getGoogleDriveFileMetadata,
} from "@/lib/google-api";
import {
  ensureGooglePickerLoaded,
  getGooglePickerConfig,
  setActiveGooglePickerSession,
} from "@/lib/google-picker";
import { useAuthStore } from "@/stores/auth-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import type { DriveFile } from "@/types";

const DRIVE_METADATA_FIELDS = "id,name,mimeType,size,modifiedTime,parents";

function toDriveFile(file: GoogleDriveFileMetadataResponse): DriveFile | null {
  if (!file.id || !file.name || !file.mimeType) {
    return null;
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
  };
}

async function fetchPickedFileMetadata(fileIds: string[], accessToken: string) {
  const requests = fileIds.map(async (fileId) => {
    const params = new URLSearchParams({
      fields: DRIVE_METADATA_FIELDS,
      supportsAllDrives: "true",
    });
    const response = await getGoogleDriveFileMetadata(
      fileId,
      accessToken,
      params,
    );

    if (!response.ok) {
      throw new Error(`Drive metadata lookup failed for ${fileId}`);
    }

    return toDriveFile(
      (await response.json()) as GoogleDriveFileMetadataResponse,
    );
  });

  return (await Promise.all(requests)).filter(
    (file): file is DriveFile => !!file,
  );
}

export function useDriveImport() {
  const getValidAccessToken = useAuthStore(
    (state) => state.getValidAccessToken,
  );
  const upsertItems = useImportedDriveStore((state) => state.upsertItems);
  const [isImporting, setIsImporting] = useState(false);

  const importFromDrive = async () => {
    if (isImporting) {
      return;
    }

    setIsImporting(true);

    try {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        toast.error("Your session expired. Please sign in again.");
        return;
      }

      const { apiKey, appId } = getGooglePickerConfig();
      await ensureGooglePickerLoaded();

      await new Promise<void>((resolve, reject) => {
        let hasSettled = false;
        let picker: GooglePickerInstance | undefined;

        const finish = (settle: () => void) => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          setActiveGooglePickerSession(null);
          picker?.setVisible(false);
          settle();
        };

        const folderView = new window.google.picker.DocsView(
          window.google.picker.ViewId.DOCS,
        )
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes("application/vnd.google-apps.folder")
          .setMode(window.google.picker.DocsViewMode.LIST)
          .setParent("root")
          .setLabel("Folders");

        const audioView = new window.google.picker.DocsView(
          window.google.picker.ViewId.DOCS,
        )
          .setMode(window.google.picker.DocsViewMode.LIST)
          .setMimeTypes(SUPPORTED_AUDIO_MIME_TYPES.join(","))
          .setLabel("Audio files");

        const pickerBuilder = new window.google.picker.PickerBuilder()
          .addView(folderView)
          .addView(audioView)
          .setDeveloperKey(apiKey)
          .setOAuthToken(accessToken)
          .setOrigin(window.location.origin)
          .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
          .setCallback(async (data) => {
            if (data.action === window.google.picker.Action.CANCEL) {
              finish(resolve);
              return;
            }

            if (data.action === window.google.picker.Action.ERROR) {
              finish(() =>
                reject(
                  new Error("The Google Drive picker encountered an error."),
                ),
              );
              return;
            }

            if (data.action !== window.google.picker.Action.PICKED) {
              return;
            }

            try {
              const selectedFileIds = [
                ...new Set(
                  (data.docs ?? [])
                    .map((doc) => doc.id)
                    .filter((id): id is string => typeof id === "string"),
                ),
              ];

              if (selectedFileIds.length === 0) {
                finish(resolve);
                return;
              }

              const files = await fetchPickedFileMetadata(
                selectedFileIds,
                accessToken,
              );
              upsertItems(files);

              const importedCount = files.length;
              if (importedCount > 0) {
                toast.success(
                  importedCount === 1
                    ? `Imported ${files[0]?.name ?? "1 item"}`
                    : `Imported ${importedCount} items from Google Drive`,
                );
              }

              finish(resolve);
            } catch (error) {
              finish(() => reject(error));
            }
          });

        if (appId) {
          pickerBuilder.setAppId(appId);
        }

        picker = pickerBuilder.build();
        setActiveGooglePickerSession({
          picker,
          close: () => finish(resolve),
        });
        picker.setVisible(true);
      });
    } catch (error) {
      console.error("Drive import failed:", error);
      toast.error("Could not open the Google Drive picker.");
    } finally {
      setIsImporting(false);
    }
  };

  return {
    importFromDrive,
    isImporting,
  };
}
