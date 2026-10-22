import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile, Playlist } from "@/types";

const mocks = vi.hoisted(() => ({
  auth: { user: { id: "a" }, authStatus: "authenticated", isLoggingOut: false },
  imports: { rootFolders: [] as DriveFile[], rootFiles: [] as DriveFile[] },
  search: {
    catalog: null as {
      userId: string;
      importsSignature: string;
      tracks: DriveFile[];
    } | null,
    invalidated: false,
  },
  folders: new Map<string, { files: DriveFile[] }>(),
  collections: { playlists: [] as Playlist[], isCloudHydrated: true },
  library: { tracks: {}, isCloudHydrated: true },
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => mocks.auth, subscribe: vi.fn() },
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: { getState: () => mocks.imports, subscribe: vi.fn() },
}));
vi.mock("@/stores/library-search-store", () => ({
  useLibrarySearchStore: { getState: () => mocks.search, subscribe: vi.fn() },
  getLibrarySearchImportsSignature: () =>
    mocks.imports.rootFolders.map((track) => `folder:${track.id}`).join("|"),
}));
vi.mock("@/stores/folder-cache-store", () => ({
  useFolderCacheStore: {
    getState: () => ({ getFiles: (id: string) => mocks.folders.get(id) }),
  },
}));
vi.mock("@/stores/playlist-store", () => ({
  usePlaylistStore: { getState: () => mocks.collections, subscribe: vi.fn() },
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: { getState: () => mocks.library, subscribe: vi.fn() },
  getFavoriteTracks: () => [],
}));
const track = {
  id: "audio",
  name: "track.mp3",
  mimeType: "audio/mpeg",
  modifiedTime: "v1",
  size: "1000",
};
const root = {
  id: "imported",
  name: "Imported",
  mimeType: "application/vnd.google-apps.folder",
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth.user.id = "a";
  mocks.auth.isLoggingOut = false;
  mocks.imports.rootFolders = [root];
  mocks.imports.rootFiles = [];
  mocks.search.catalog = null;
  mocks.search.invalidated = false;
  mocks.folders.clear();
  mocks.collections.playlists = [];
});

describe("known track membership proof", () => {
  it("rejects arbitrary cached IDs and foreign-account descriptors", async () => {
    const { resolveKnownTrack } = await import("./known-track-resolver");
    mocks.folders.set("unrelated", { files: [track] });
    expect(resolveKnownTrack("a", track.id)).toBeNull();
    mocks.imports.rootFiles = [track];
    expect(resolveKnownTrack("other", track.id)).toBeNull();
  });
  it("requires each nested navigation step to reach an Imported Folder", async () => {
    const { registerKnownFolder, resolveKnownTrack } = await import(
      "./known-track-resolver"
    );
    const child = { id: "child", name: "Child", mimeType: root.mimeType };
    mocks.folders.set("child", { files: [track] });
    registerKnownFolder("a", [root, child]);
    expect(resolveKnownTrack("a", track.id)).toBeNull();
    mocks.folders.set("imported", { files: [child] });
    registerKnownFolder("a", [root, child]);
    expect(resolveKnownTrack("a", track.id)?.source).toBe("folder");
    mocks.imports.rootFolders = [];
    expect(resolveKnownTrack("a", track.id)).toBeNull();
  });
  it("fences old proofs after scope/version change and rejects copied proof objects", async () => {
    const { resolveKnownTrack, assertKnownTrack } = await import(
      "./known-track-resolver"
    );
    mocks.imports.rootFiles = [track];
    const known = resolveKnownTrack("a", track.id);
    expect(known).not.toBeNull();
    if (!known) throw new Error("missing fixture proof");
    expect(assertKnownTrack({ ...known })).toBe(false);
    mocks.imports.rootFiles = [{ ...track, modifiedTime: "v2" }];
    expect(assertKnownTrack(known)).toBe(false);
  });
  it("requires collection ownership verification and preserves unknown MIME evidence", async () => {
    const { resolveKnownTrack, verifyKnownCollections } = await import(
      "./known-track-resolver"
    );
    mocks.collections.playlists = [
      {
        id: "p",
        name: "Playlist",
        tracks: [{ fileId: "saved", fileName: "track.flac" }],
      },
    ];
    expect(resolveKnownTrack("a", "saved")).toBeNull();
    verifyKnownCollections("a");
    expect(resolveKnownTrack("a", "saved")).toMatchObject({
      source: "collection",
      originalMimeType: undefined,
    });
    mocks.collections.playlists = [
      ...mocks.collections.playlists,
      {
        id: "new",
        name: "Unverified",
        tracks: [{ fileId: "foreign", fileName: "foreign.mp3" }],
      },
    ];
    expect(resolveKnownTrack("a", "foreign")).toBeNull();
  });
  it("strengthens a stale descriptor only while its existing membership remains valid", async () => {
    const { resolveKnownTrack, updateKnownTrackDescriptor, assertKnownTrack } =
      await import("./known-track-resolver");
    mocks.imports.rootFiles = [track];
    const known = resolveKnownTrack("a", track.id);
    if (!known) throw new Error("missing fixture proof");
    expect(
      updateKnownTrackDescriptor(known, {
        ...track,
        modifiedTime: "v2",
        size: "1500",
      }),
    ).toBe(true);
    expect(assertKnownTrack(known)).toBe(true);
    expect(resolveKnownTrack("a", track.id)?.track.modifiedTime).toBe("v2");
    mocks.imports.rootFiles = [];
    expect(assertKnownTrack(known)).toBe(false);
  });
});

it("notifies cached-row subscribers when a proven folder or collection becomes available", async () => {
  const {
    registerKnownFolder,
    resolveKnownTrack,
    verifyKnownCollections,
    useKnownTrackProofStore,
  } = await import("./known-track-resolver");
  const subscriber = vi.fn();
  const unsubscribe = useKnownTrackProofStore.subscribe(subscriber);
  mocks.folders.set("imported", { files: [track] });
  expect(resolveKnownTrack("a", track.id)).toBeNull();
  registerKnownFolder("a", [root]);
  expect(resolveKnownTrack("a", track.id)).not.toBeNull();
  expect(subscriber).toHaveBeenCalledTimes(1);
  registerKnownFolder("a", [root]);
  expect(subscriber).toHaveBeenCalledTimes(1);
  mocks.collections.playlists = [
    {
      id: "saved",
      name: "Saved",
      tracks: [{ fileId: "collection-only", fileName: "Saved.mp3" }],
    },
  ];
  expect(resolveKnownTrack("a", "collection-only")).toBeNull();
  verifyKnownCollections("a");
  expect(resolveKnownTrack("a", "collection-only")).not.toBeNull();
  expect(subscriber).toHaveBeenCalledTimes(2);
  unsubscribe();
});
