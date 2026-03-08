"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { FileBrowser } from "@/components/file-browser";
import { FolderTree } from "@/components/folder-tree";
import { PlayerBar } from "@/components/player/player-bar";
import { SplitView } from "@/components/split-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getHistoryStateWithFolderStack } from "@/lib/utils";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import type { FolderEntry } from "@/types";
import { INITIAL_STACK } from "@/types";

function AppContent() {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [folderStack, setFolderStack] = useState<FolderEntry[]>(() => {
    if (typeof window === "undefined") return INITIAL_STACK;
    const historyFolderStack = window.history.state?.folderStack;
    if (Array.isArray(historyFolderStack) && historyFolderStack.length > 0) {
      return historyFolderStack;
    }
    return INITIAL_STACK;
  });
  const folderStackRef = useRef(folderStack);
  folderStackRef.current = folderStack;

  const currentFolderId = folderStack[folderStack.length - 1].id;

  const handleFolderNavigate = useCallback((newStack: FolderEntry[]) => {
    setFolderStack(newStack);
    window.history.pushState(getHistoryStateWithFolderStack(newStack), "");
    // Expand ancestors in tree
    useFolderTreeStore.getState().expandPath(newStack.slice(0, -1));
  }, []);

  const handleTreeSelect = useCallback((path: FolderEntry[]) => {
    setFolderStack(path);
    window.history.pushState(getHistoryStateWithFolderStack(path), "");
  }, []);

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    if (!window.history.state?.folderStack) {
      window.history.replaceState(
        getHistoryStateWithFolderStack(folderStackRef.current),
        "",
      );
    }

    const onPopState = (e: PopStateEvent) => {
      if (
        Array.isArray(e.state?.folderStack) &&
        e.state.folderStack.length > 0
      ) {
        setFolderStack(e.state.folderStack);
      } else {
        setFolderStack(INITIAL_STACK);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const sidebar = (
    <FolderTree
      selectedFolderId={currentFolderId}
      onSelectFolder={handleTreeSelect}
    />
  );

  return (
    <>
      {isDesktop ? (
        <div className="mx-auto h-full max-w-[1440px]">
          <SplitView sidebar={sidebar}>
            <FileBrowser
              externalFolderStack={folderStack}
              onFolderNavigate={handleFolderNavigate}
            />
          </SplitView>
        </div>
      ) : (
        <div className="h-full">
          <FileBrowser />
        </div>
      )}
      <PlayerBar />
    </>
  );
}

export default function AppPage() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}
