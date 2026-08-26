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
      expect(screen.getByRole("searchbox")).toHaveValue("");
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
      expect(screen.getByRole("searchbox")).toHaveValue("");
    });
  });

  it("preserves a Library query across ordinary folder navigation and scope changes", async () => {
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
      expect(screen.getByRole("searchbox")).toHaveValue("friends");
      expect(screen.getByTestId("file-list")).toHaveTextContent("Friends.mp3");
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
      expect(screen.getByRole("searchbox")).toHaveValue("");
      expect(
        screen.getByRole("combobox", { name: "Search scope" }),
      ).toHaveValue("library");
    });
  });
});
