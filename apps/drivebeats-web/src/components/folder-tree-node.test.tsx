import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import type { DriveFile } from "@/types";
import { FolderTreeNode } from "./folder-tree-node";

const { fetchFromApi, cacheState } = vi.hoisted(() => ({
  fetchFromApi: vi.fn(),
  cacheState: {
    cache: new Map(),
    hydrate: vi.fn(async () => {}),
    getFiles: vi.fn(() => null),
  },
}));
vi.mock("@/hooks/use-folder-contents", () => ({
  useFolderContents: () => ({ fetchFromApi }),
}));
vi.mock("@/stores/folder-cache-store", async () => {
  const { create } = await import("zustand");
  return { useFolderCacheStore: create(() => cacheState) };
});
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => ({ user: { id: "account-one" }, isLoggingOut: false }),
  },
}));
vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) =>
    selector({ currentTrack: null, isPlaying: false, playingFolderStack: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useFolderTreeStore.setState({ expandedFolders: new Set() });
  useFolderCacheStore.setState({ cache: new Map() });
});
afterEach(cleanup);

function renderNode(onSelect = vi.fn()) {
  return render(
    <FolderTreeNode
      id="music"
      name="Music"
      depth={0}
      ancestors={[]}
      selectedFolderId={null}
      onSelect={onSelect}
    />,
  );
}

describe("folder tree loading", () => {
  it.each(["selection", "expand button"])(
    "loads children once for an uncached %s",
    async (action) => {
      let resolve!: (files: DriveFile[]) => void;
      fetchFromApi.mockReturnValueOnce(
        new Promise<DriveFile[]>((res) => {
          resolve = res;
        }),
      );
      const onSelect = vi.fn();
      renderNode(onSelect);
      if (action === "selection") fireEvent.click(screen.getByRole("treeitem"));
      else fireEvent.click(screen.getByRole("button", { name: "Expand" }));
      await waitFor(() => expect(fetchFromApi).toHaveBeenCalledTimes(1));
      if (action === "selection")
        expect(onSelect).toHaveBeenCalledWith([{ id: "music", name: "Music" }]);
      await act(async () =>
        resolve([
          {
            id: "album",
            name: "Album",
            mimeType: "application/vnd.google-apps.folder",
          },
        ]),
      );
      expect(screen.getByText("Album")).toBeInTheDocument();
      expect(fetchFromApi).toHaveBeenCalledTimes(1);
    },
  );

  it("clears the spinner when cache resync resolves children before the read continuation", async () => {
    let resolve!: (files: DriveFile[]) => void;
    fetchFromApi.mockReturnValueOnce(
      new Promise<DriveFile[]>((res) => {
        resolve = res;
      }),
    );
    renderNode();
    fireEvent.click(screen.getByRole("treeitem"));
    await waitFor(() => expect(fetchFromApi).toHaveBeenCalledTimes(1));
    const options = fetchFromApi.mock.calls[0][1];
    const files = [
      {
        id: "album",
        name: "Cached Album",
        mimeType: "application/vnd.google-apps.folder",
      },
    ];
    act(() =>
      useFolderCacheStore.setState({
        cache: new Map([
          [
            "music",
            {
              files,
              fetchedAt: Date.now(),
              lastAccessedAt: Date.now(),
              estimatedBytes: 100,
              persisted: false,
            },
          ],
        ]),
      }),
    );
    expect(options.signal.aborted).toBe(true);
    expect(screen.getByText("Cached Album")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
    await act(async () => resolve(files));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("cancels a collapsed tree consumer and restores its expander without applying late children", async () => {
    let resolve!: (files: DriveFile[]) => void;
    fetchFromApi.mockReturnValueOnce(
      new Promise<DriveFile[]>((res) => {
        resolve = res;
      }),
    );
    renderNode();
    fireEvent.click(screen.getByRole("treeitem"));
    await waitFor(() => expect(fetchFromApi).toHaveBeenCalledTimes(1));
    const options = fetchFromApi.mock.calls[0][1];
    expect(options.signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(options.signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await act(async () =>
      resolve([
        {
          id: "late",
          name: "Late Album",
          mimeType: "application/vnd.google-apps.folder",
        },
      ]),
    );
    expect(screen.queryByText("Late Album")).not.toBeInTheDocument();
  });
});
