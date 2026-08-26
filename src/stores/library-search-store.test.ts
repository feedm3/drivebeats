import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";
import type { LibrarySearchCatalogRecord } from "@/lib/library-search-catalog-db";

const persisted = new Map<string, LibrarySearchCatalogRecord>();
let estimatedBytes = 1_000;
let buildImpl: () => Promise<LibrarySearchTrack[]>;

vi.mock("@/lib/library-search-catalog-db", () => ({
  loadLibrarySearchCatalog: async (userId: string) =>
    persisted.get(userId) ?? null,
  replaceLibrarySearchCatalog: async (record: LibrarySearchCatalogRecord) => {
    persisted.set(record.userId, structuredClone(record));
    return true;
  },
  clearLibrarySearchCatalogForUser: async (userId: string) => {
    persisted.delete(userId);
  },
  clearLibrarySearchCatalogsForOtherUsers: async (userId: string) => {
    for (const key of persisted.keys()) {
      if (key !== userId) persisted.delete(key);
    }
  },
  clearLibrarySearchCatalogs: async () => persisted.clear(),
  estimateLibrarySearchCatalogBytes: () => estimatedBytes,
}));

vi.mock("@/lib/library-search-drive", () => ({
  buildLibrarySearchCatalogFromDrive: () => buildImpl(),
}));

const importedFolder = {
  id: "music",
  name: "Music",
  mimeType: "application/vnd.google-apps.folder",
  parents: ["root"],
};

function catalogTrack(id: string): LibrarySearchTrack {
  return {
    id,
    name: `${id}.mp3`,
    mimeType: "audio/mpeg",
    contextLabel: "Music",
    folderStack: [
      { id: "root", name: "Library" },
      { id: "music", name: "Music" },
    ],
    importedRootId: "music",
    importedRootPaths: [
      {
        contextLabel: "Music",
        folderStack: [
          { id: "root", name: "Library" },
          { id: "music", name: "Music" },
        ],
        importedRootId: "music",
        relativePath: "",
      },
    ],
    relativePath: "",
  };
}

function user(id: string) {
  return { id, email: `${id}@example.com`, name: null, picture: null };
}

async function prepare(userId = "a") {
  vi.resetModules();
  const { useAuthStore } = await import("@/stores/auth-store");
  useAuthStore.setState({
    accessToken: "token",
    expiresAt: Date.now() + 60_000_000,
    authStatus: "authenticated",
    isLoggingOut: false,
    user: user(userId),
  });
  const { useImportedDriveStore } = await import(
    "@/stores/imported-drive-store"
  );
  useImportedDriveStore.setState({
    rootFolders: [importedFolder],
    rootFiles: [],
  });
  const { useLibrarySearchStore } = await import(
    "@/stores/library-search-store"
  );
  await useLibrarySearchStore.getState().hydrate();
  return { authStore: useAuthStore, store: useLibrarySearchStore };
}

describe("Library Search lifecycle", () => {
  beforeEach(() => {
    persisted.clear();
    estimatedBytes = 1_000;
    buildImpl = async () => [catalogTrack("fresh")];
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the last complete generation when refresh fails", async () => {
    const { store } = await prepare();
    await expect(store.getState().refresh()).resolves.toBe(true);
    expect(store.getState().catalog?.tracks[0].id).toBe("fresh");

    buildImpl = async () => {
      throw new Error("Drive unavailable");
    };
    await expect(store.getState().refresh()).resolves.toBe(false);

    expect(store.getState().catalog?.tracks[0].id).toBe("fresh");
    expect(store.getState().status).toBe("error");
    expect(store.getState().isPotentiallyOutdated()).toBe(true);
  });

  it("marks a generation stale after 24 hours and serves it while refreshing", async () => {
    persisted.set("a", {
      userId: "a",
      fetchedAt: Date.now() - 25 * 60 * 60 * 1_000,
      importsSignature: "folder:music",
      tracks: [catalogTrack("cached")],
    });

    const { store } = await prepare();

    expect(store.getState().catalog?.tracks[0].id).toBe("cached");
    expect(store.getState().isStale()).toBe(true);
  });

  it("uses a session-only generation when the complete catalog exceeds 16 MiB", async () => {
    estimatedBytes = 16 * 1024 * 1024 + 1;
    const { store } = await prepare();

    await expect(store.getState().refresh()).resolves.toBe(true);

    expect(store.getState().catalog?.tracks[0].id).toBe("fresh");
    expect(store.getState().sessionOnly).toBe(true);
    expect(persisted.has("a")).toBe(false);
  });

  it("purges the previous account when another account signs in", async () => {
    const { authStore, store } = await prepare();
    await store.getState().refresh();
    expect(persisted.has("a")).toBe(true);

    authStore.setState({ user: user("b"), authStatus: "authenticated" });
    await store.getState().hydrate();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().catalog).toBeNull();
    expect(persisted.has("a")).toBe(false);
  });

  it("makes a logout wipe final even when an earlier refresh resolves late", async () => {
    let resolveBuild: ((tracks: LibrarySearchTrack[]) => void) | undefined;
    buildImpl = () =>
      new Promise((resolve) => {
        resolveBuild = resolve;
      });
    const { store } = await prepare();

    const refresh = store.getState().refresh();
    await store.getState().sealAndClear();
    resolveBuild?.([catalogTrack("late")]);
    await refresh;

    expect(store.getState().catalog).toBeNull();
    expect(persisted.size).toBe(0);
  });

  it("restarts a refresh when imports change while Drive is responding", async () => {
    let resolveFirstBuild: ((tracks: LibrarySearchTrack[]) => void) | undefined;
    let buildCount = 0;
    buildImpl = () => {
      buildCount += 1;
      if (buildCount === 1) {
        return new Promise((resolve) => {
          resolveFirstBuild = resolve;
        });
      }
      return Promise.resolve([catalogTrack("retried")]);
    };
    const { store } = await prepare();
    const { useImportedDriveStore } = await import(
      "@/stores/imported-drive-store"
    );

    const refresh = store.getState().refresh();
    await vi.waitFor(() => expect(buildCount).toBe(1));
    useImportedDriveStore.setState({
      rootFolders: [
        importedFolder,
        {
          id: "live",
          name: "Live",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["music"],
        },
      ],
    });
    resolveFirstBuild?.([catalogTrack("superseded")]);

    await expect(refresh).resolves.toBe(true);
    expect(buildCount).toBe(2);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().invalidated).toBe(false);
    expect(store.getState().catalog?.tracks[0].id).toBe("retried");
  });
});
