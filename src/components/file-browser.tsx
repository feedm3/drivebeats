"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DriveFile, FolderEntry } from "@/types";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { FileList } from "@/components/file-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";


export function FileBrowser() {
  const { getValidAccessToken, logout } = useAuthStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string>("");
  const initialStack: FolderEntry[] = [{ id: "root", name: "My Drive" }];
  const [folderStack, setFolderStack] = useState<FolderEntry[]>(initialStack);
  const currentFolderId = folderStack[folderStack.length - 1].id;

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    window.history.replaceState({ folderStack: initialStack }, "");

    const onPopState = (e: PopStateEvent) => {
      if (e.state?.folderStack) {
        setFolderStack(e.state.folderStack);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setFolderStack((s) => {
      const newStack = [...s, { id, name }];
      window.history.pushState({ folderStack: newStack }, "");
      return newStack;
    });
  };

  const onBreadcrumbNavigate = (index: number) => {
    setFolderStack((s) => {
      const newStack = s.slice(0, index + 1);
      window.history.pushState({ folderStack: newStack }, "");
      return newStack;
    });
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden px-4 pt-8">
      <div className="flex items-center justify-between">
        <BreadcrumbNav
          folderStack={folderStack}
          onNavigate={onBreadcrumbNavigate}
        />
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { usePlayerStore.getState().clearCache(); logout(); }}>
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
