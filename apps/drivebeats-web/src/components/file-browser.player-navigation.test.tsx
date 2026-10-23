import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "@/components/file-browser";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";
import type { DriveFile, FolderEntry } from "@/types";

const { fetchFolderContents, importedFolder, libraryTrack } = vi.hoisted(() => {
  const importedFolder: DriveFile = {
    id: "music",
    name: "Music",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
  };
  const libraryTrack: LibrarySearchTrack = {
    id: "search-hit",
    name: "Friends.mp3",
    mimeType: "audio/mpeg",
    contextLabel: "Album",
    folderStack: [
      { id: "root", name: "Library" },
      { id: "music", name: "Music" },
      { id: "album", name: "Album" },
    ],
    importedRootId: "music",
    importedRootPaths: [
      {
        contextLabel: "Album",
        folderStack: [
          { id: "root", name: "Library" },
          { id: "music", name: "Music" },
          { id: "album", name: "Album" },
        ],
        importedRootId: "music",
        relativePath: "Album",
      },
    ],
    relativePath: "Album",
  };

  return {
    fetchFolderContents: vi.fn(),
    importedFolder,
    libraryTrack,
  };
});

vi.mock("@/components/breadcrumb-nav", () => ({
  BreadcrumbNav: ({ folderStack }: { folderStack: FolderEntry[] }) => (
    <div data-testid="breadcrumb">
      {folderStack.map((folder) => folder.name).join(" / ")}
    </div>
  ),
}));

vi.mock("@/components/drive-import-button", () => ({
  DriveImportButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/metadata-activity", () => ({
  MetadataActivity: () => null,
}));

vi.mock("@/components/file-list", () => ({
  FileList: ({
    files,
    searchQuery,
    searchScope,
  }: {
    files: DriveFile[];
    searchQuery: string;
    searchScope: string;
  }) => (
    <div
      data-testid="file-list"
      data-search-query={searchQuery}
      data-search-scope={searchScope}
    >
      {files.map((file) => file.name).join(", ")}
    </div>
  ),
}));

vi.mock("@/hooks/use-cached-track-search", () => ({
  useCachedTrackSearch: (
    files: DriveFile[],
    query: string,
    enabled: boolean,
  ) => ({
    tracks: enabled
      ? files.filter((file) =>
          file.name.toLowerCase().includes(query.toLowerCase()),
        )
      : files,
    pending: false,
  }),
}));

vi.mock("@/hooks/use-drive-import", () => ({
  useDriveImport: () => ({ importFromDrive: vi.fn(), isImporting: false }),
}));

vi.mock("@/hooks/use-folder-contents", () => ({
  useFolderContents: () => ({
    fetchFromApi: vi.fn(),
    fetchFolderContents,
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

const importedState = {
  rootFolders: [importedFolder],
  rootFiles: [] as DriveFile[],
};

vi.mock("@/stores/imported-drive-store", () => ({
  getImportedLibraryRootEntries: () => [importedFolder],
  useImportedDriveStore: Object.assign(
    (selector: (state: typeof importedState) => unknown) =>
      selector(importedState),
    { getState: () => importedState },
  ),
}));

const librarySearchState = {
  catalog: {
    fetchedAt: Date.now(),
    importsSignature: "folder:music",
    tracks: [libraryTrack],
    userId: "user",
  },
  ensureReady: vi.fn(async () => true),
  error: null,
  invalidated: false,
  refresh: vi.fn(async () => true),
  sessionOnly: false,
  status: "ready" as const,
};

vi.mock("@/stores/library-search-store", () => ({
  useLibrarySearchStore: (
    selector: (state: typeof librarySearchState) => unknown,
  ) => selector(librarySearchState),
}));

const rootStack: FolderEntry[] = [{ id: "root", name: "Library" }];
const albumStack: FolderEntry[] = [
  ...rootStack,
  { id: "music", name: "Music" },
  { id: "album", name: "Album" },
];
const albumTrack: DriveFile = {
  id: "album-track",
  name: "Another track.mp3",
  mimeType: "audio/mpeg",
  parents: ["album"],
};

describe("FileBrowser player navigation", () => {
  afterEach(() => {
    cleanup();
    fetchFolderContents.mockReset();
  });

  it("reveals search on demand and restores the unfiltered Library when closed", async () => {
    render(
      <FileBrowser
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Search" });
    const controlledId = trigger.getAttribute("aria-controls");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(document.getElementById(controlledId ?? "")).not.toBeVisible();

    fireEvent.click(trigger);
    const input = screen.getByRole("searchbox");
    expect(input).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(input, { target: { value: "friends" } });
    await waitFor(() =>
      expect(screen.getByTestId("file-list")).toHaveTextContent("Friends.mp3"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByTestId("file-list")).toHaveTextContent("Music"),
    );
    expect(screen.getByTestId("file-list")).toHaveAttribute(
      "data-search-query",
      "",
    );

    fireEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("opens with slash, clears with Escape, then closes and restores focus", () => {
    render(
      <FileBrowser
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "/" });
    const input = screen.getByRole("searchbox");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "friends" } });
    fireEvent.keyDown(input, { key: "/" });
    expect(input).toHaveValue("friends");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
  });

  it("cancels an obsolete folder read when navigating to another folder or Library", async () => {
    fetchFolderContents.mockImplementation(async () => {});
    const { rerender } = render(
      <FileBrowser
        externalFolderStack={albumStack}
        onFolderNavigate={vi.fn()}
      />,
    );
    await waitFor(() => expect(fetchFolderContents).toHaveBeenCalledTimes(1));
    const first = fetchFolderContents.mock.calls[0][1];
    expect(first.signal.aborted).toBe(false);
    expect(first.canCommit()).toBe(true);
    const nextStack = [
      ...rootStack,
      { id: "other-album", name: "Other Album" },
    ];
    rerender(
      <FileBrowser
        externalFolderStack={nextStack}
        onFolderNavigate={vi.fn()}
      />,
    );
    await waitFor(() => expect(fetchFolderContents).toHaveBeenCalledTimes(2));
    expect(first.signal.aborted).toBe(true);
    expect(first.canCommit()).toBe(false);
    const second = fetchFolderContents.mock.calls[1][1];
    expect(second.signal.aborted).toBe(false);
    expect(second.canCommit()).toBe(true);
    rerender(
      <FileBrowser
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );
    expect(second.signal.aborted).toBe(true);
    expect(second.canCommit()).toBe(false);
    expect(screen.getByTestId("file-list")).toHaveTextContent("Music");
  });

  it("shows the containing folder instead of retaining Library Search results", async () => {
    fetchFolderContents.mockImplementation(
      async (
        _folderId: string,
        callbacks: {
          onFiles: (files: DriveFile[]) => void;
          onLoadingChange: (loading: boolean) => void;
        },
      ) => {
        callbacks.onFiles([albumTrack]);
        callbacks.onLoadingChange(false);
      },
    );

    const { rerender } = render(
      <FileBrowser
        key={0}
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "friends" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-list")).toHaveTextContent("Friends.mp3"),
    );

    rerender(
      <FileBrowser
        key={1}
        externalFolderStack={albumStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb")).toHaveTextContent(
        "Library / Music / Album",
      );
      expect(screen.getByTestId("file-list")).toHaveTextContent(
        "Another track.mp3",
      );
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });

  it("exits search when player navigation targets the Current Folder", async () => {
    fetchFolderContents.mockImplementation(
      async (
        _folderId: string,
        callbacks: {
          onFiles: (files: DriveFile[]) => void;
          onLoadingChange: (loading: boolean) => void;
        },
      ) => {
        callbacks.onFiles([albumTrack]);
        callbacks.onLoadingChange(false);
      },
    );

    const { rerender } = render(
      <FileBrowser
        key={0}
        externalFolderStack={albumStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "friends" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-list")).toHaveTextContent("Friends.mp3"),
    );

    rerender(
      <FileBrowser
        key={1}
        externalFolderStack={[...albumStack]}
        onFolderNavigate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("file-list")).toHaveTextContent(
        "Another track.mp3",
      );
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });

  it("clears a Library query on folder navigation but preserves it when changing scope", async () => {
    fetchFolderContents.mockImplementation(
      async (
        _folderId: string,
        callbacks: {
          onFiles: (files: DriveFile[]) => void;
          onLoadingChange: (loading: boolean) => void;
        },
      ) => {
        callbacks.onFiles([albumTrack]);
        callbacks.onLoadingChange(false);
      },
    );

    const { rerender } = render(
      <FileBrowser
        key={0}
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "friends" },
    });
    rerender(
      <FileBrowser
        key={0}
        externalFolderStack={albumStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("file-list")).toHaveTextContent(
        "Another track.mp3",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "friends" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Search scope" }), {
      target: { value: "folder" },
    });

    expect(screen.getByRole("searchbox")).toHaveValue("friends");

    rerender(
      <FileBrowser
        key={0}
        externalFolderStack={rootStack}
        onFolderNavigate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Search scope" })).toHaveValue(
      "library",
    );
  });
  it("clears a Library query when the same folder is explicitly selected again", async () => {
    const onFolderNavigate = vi.fn();
    const rendered = render(
      <FileBrowser
        externalFolderStack={rootStack}
        onFolderNavigate={onFolderNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "friends" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-list")).toHaveTextContent("Friends.mp3"),
    );
    rendered.rerender(
      <FileBrowser
        externalFolderStack={[...rootStack]}
        onFolderNavigate={onFolderNavigate}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("file-list")).toHaveTextContent("Music");
      expect(screen.getByTestId("file-list")).not.toHaveTextContent(
        "Friends.mp3",
      );
    });
  });
});
