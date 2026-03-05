"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DriveFile, FolderEntry } from "@/types";
import { useAuthStore } from "@/stores/auth-store";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { FileList } from "@/components/file-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";


export function FileBrowser() {
  const { getValidAccessToken, logout } = useAuthStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string>("");
  const [folderStack, setFolderStack] = useState<FolderEntry[]>([
    { id: "root", name: "My Drive" },
  ]);

  const currentFolderId = folderStack[folderStack.length - 1].id;

  const fetchFiles = useCallback(
    async (folderId: string) => {
      setLoading(true);
      const token = await getValidAccessToken();
      if (!token) {
        logout();
        return;
      }
      setAccessToken(token);

      try {
        const res = await fetch(
          `/api/drive/files?folderId=${encodeURIComponent(folderId)}&accessToken=${encodeURIComponent(token)}`,
        );
        if (res.ok) {
          setFiles(await res.json());
        } else if (res.status === 401) {
          toast.error("Session expired. Please sign in again.");
          logout();
        } else if (res.status === 403) {
          toast.error("Access denied. Check your Google Drive permissions.");
        } else if (res.status === 429) {
          toast.error("Too many requests. Please wait a moment.");
        } else {
          toast.error("Failed to load files. Please try again.");
        }
      } catch {
        toast.error("Network error. Check your connection.");
      } finally {
        setLoading(false);
      }
    },
    [getValidAccessToken, logout],
  );

  useEffect(() => {
    fetchFiles(currentFolderId);
  }, [currentFolderId, fetchFiles]);

  const onFolderClick = (id: string, name: string) => {
    setFolderStack((s) => [...s, { id, name }]);
  };

  const onBreadcrumbNavigate = (index: number) => {
    setFolderStack((s) => s.slice(0, index + 1));
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden px-4 pt-8">
      <div className="flex items-center justify-between">
        <BreadcrumbNav
          folderStack={folderStack}
          onNavigate={onBreadcrumbNavigate}
        />
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={logout}>
          Sign out
        </Button>
      </div>
      <Separator className="my-3" />
      <FileList
        files={files}
        loading={loading}
        accessToken={accessToken}
        onFolderClick={onFolderClick}
      />
    </div>
  );
}
