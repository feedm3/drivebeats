import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";
import type { LibrarySearchCatalogRecord } from "@/lib/library-search-catalog-db";

const persisted = new Map<string, LibrarySearchCatalogRecord>();
let estimatedBytes = 1_000;
let persistGate: () => Promise<void>;
let buildImpl: (input: {
  signal?: AbortSignal;
}) => Promise<LibrarySearchTrack[]>;

vi.mock("@/lib/library-search-catalog-db", () => ({
  loadLibrarySearchCatalog: async (userId: string) =>
    persisted.get(userId) ?? null,
  replaceLibrarySearchCatalog: async (record: LibrarySearchCatalogRecord) => {
    await persistGate();
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
  buildLibrarySearchCatalogFromDrive: (input: { signal?: AbortSignal }) =>
    buildImpl(input),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
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
    persistGate = async () => {};
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

  it("shares an overlapping readiness refresh without one caller cancelling another", async () => {
    const build = deferred<LibrarySearchTrack[]>();
    const acquire = vi.fn((input: { signal?: AbortSignal }) => {
      expect(input.signal?.aborted).toBe(false);
      return build.promise;
    });
    buildImpl = acquire;
    const { store } = await prepare();
    const cancelled = new AbortController();
    const first = store.getState().ensureReady(cancelled.signal);
    const firstRejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = store.getState().ensureReady();
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));

    cancelled.abort();
    await firstRejected;
    expect(acquire.mock.calls[0][0].signal?.aborted).toBe(false);
    expect(store.getState().failure).toBeNull();
    expect(store.getState().status).toBe("loading");
    build.resolve([catalogTrack("shared")]);

    await expect(second).resolves.toBe(true);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(store.getState().catalog?.tracks[0].id).toBe("shared");
    expect(persisted.get("a")?.tracks[0].id).toBe("shared");
  });

  it("does not start work for an already cancelled readiness request", async () => {
    const acquire = vi.fn(async () => [catalogTrack("unexpected")]);
    buildImpl = acquire;
    const { store } = await prepare();
    const controller = new AbortController();
    controller.abort();

    await expect(
      store.getState().ensureReady(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(acquire).not.toHaveBeenCalled();
    expect(store.getState().failure).toBeNull();
  });

  it("lets an explicit refresh supersede the shared refresh without publishing the old result", async () => {
    const old = deferred<LibrarySearchTrack[]>();
    const acquire = vi.fn((input: { signal?: AbortSignal }) => {
      if (acquire.mock.calls.length === 1) return old.promise;
      expect(input.signal?.aborted).toBe(false);
      return Promise.resolve([catalogTrack("replacement")]);
    });
    buildImpl = acquire;
    const { store } = await prepare();
    const first = store.getState().ensureReady();
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    const second = store.getState().refresh();
    await expect(second).resolves.toBe(true);
    expect(acquire.mock.calls[0][0].signal?.aborted).toBe(true);
    old.resolve([catalogTrack("obsolete")]);

    await expect(first).resolves.toBe(false);
    expect(store.getState().catalog?.tracks[0].id).toBe("replacement");
    expect(persisted.get("a")?.tracks[0].id).toBe("replacement");
    expect(store.getState().failure).toBeNull();
  });

  it("reports offline readiness without requesting Drive or publishing a catalog", async () => {
    const acquire = vi.fn(async () => [catalogTrack("unexpected")]);
    buildImpl = acquire;
    const { store } = await prepare();
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    await expect(store.getState().ensureReady()).resolves.toBe(false);
    expect(store.getState().failure).toMatchObject({ code: "offline" });
    expect(store.getState().error).toBe(store.getState().failure?.message);
    expect(acquire).not.toHaveBeenCalled();
    expect(store.getState().catalog).toBeNull();
  });

  it("does not mark a fresh catalog as failed when an offline caller requests readiness", async () => {
    const acquire = vi.fn(async () => [catalogTrack("fresh")]);
    buildImpl = acquire;
    const { store } = await prepare();
    await expect(store.getState().ensureReady()).resolves.toBe(true);
    const readyCatalog = store.getState().catalog;
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    await expect(store.getState().ensureReady()).resolves.toBe(false);

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(store.getState().catalog).toBe(readyCatalog);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().failure).toBeNull();
    expect(store.getState().error).toBeNull();
    expect(store.getState().isPotentiallyOutdated()).toBe(false);
  });

  it("does not overwrite an in-flight refresh when a second caller is offline", async () => {
    const build = deferred<LibrarySearchTrack[]>();
    const acquire = vi.fn((input: { signal?: AbortSignal }) => {
      expect(input.signal?.aborted).toBe(false);
      return build.promise;
    });
    buildImpl = acquire;
    const { store } = await prepare();
    const onlineCaller = store.getState().ensureReady();
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    await expect(store.getState().ensureReady()).resolves.toBe(false);

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0][0].signal?.aborted).toBe(false);
    expect(store.getState().status).toBe("loading");
    expect(store.getState().failure).toBeNull();
    expect(store.getState().error).toBeNull();
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
    build.resolve([catalogTrack("completed")]);
    await expect(onlineCaller).resolves.toBe(true);
    expect(store.getState().catalog?.tracks[0].id).toBe("completed");
    expect(store.getState().status).toBe("ready");
  });

  it.each([
    [401, "drive_auth_required"],
    [403, "drive_access_denied"],
    [429, "drive_rate_limited"],
    [503, "library_unavailable"],
  ])(
    "classifies Google HTTP %s without parsing error strings",
    async (status, code) => {
      const { store } = await prepare();
      const { GoogleDriveReadError } = await import("@/lib/drive-read-error");
      buildImpl = async () => {
        throw new GoogleDriveReadError(status, "Opaque Google error");
      };

      await expect(store.getState().ensureReady()).resolves.toBe(false);
      expect(store.getState().failure).toMatchObject({ code });
      expect(store.getState().catalog).toBeNull();
      expect(persisted.size).toBe(0);
    },
  );

  it("distinguishes incomplete listings from network failures and clears failure on recovery", async () => {
    const { store } = await prepare();
    const { LibraryIncompleteError } = await import("@/lib/drive-read-error");
    buildImpl = async () => {
      throw new LibraryIncompleteError();
    };
    await expect(store.getState().ensureReady()).resolves.toBe(false);
    expect(store.getState().failure?.code).toBe("library_incomplete");

    buildImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(store.getState().ensureReady()).resolves.toBe(false);
    expect(store.getState().failure?.code).toBe("network_error");

    buildImpl = async () => [catalogTrack("recovered")];
    await expect(store.getState().ensureReady()).resolves.toBe(true);
    expect(store.getState().failure).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it.each([
    ["unauthenticated", "drive_auth_required"],
    ["authenticated", "network_error"],
  ] as const)(
    "classifies a missing token while %s",
    async (authStatus, code) => {
      const { authStore, store } = await prepare();
      authStore.setState({ authStatus, getValidAccessToken: async () => null });

      await expect(store.getState().ensureReady()).resolves.toBe(false);
      expect(store.getState().failure?.code).toBe(code);
      expect(persisted.size).toBe(0);
    },
  );

  it("does not publish the former account's late result after switching accounts", async () => {
    const old = deferred<LibrarySearchTrack[]>();
    buildImpl = () => old.promise;
    const { authStore, store } = await prepare();
    const pending = store.getState().ensureReady();
    await vi.advanceTimersByTimeAsync(0);
    authStore.setState({ user: user("b"), authStatus: "authenticated" });
    old.resolve([catalogTrack("account-a")]);

    await expect(pending).resolves.toBe(false);
    expect(store.getState().catalog).toBeNull();
    expect(store.getState().failure).toBeNull();
    expect(persisted.size).toBe(0);
  });

  it("finishes a logout wipe after a catalog write that was already in flight", async () => {
    const write = deferred<void>();
    const saving = vi.fn(() => write.promise);
    persistGate = saving;
    const { store } = await prepare();
    const pending = store.getState().ensureReady();
    await vi.waitFor(() => expect(saving).toHaveBeenCalledTimes(1));

    const wiped = store.getState().sealAndClear();
    expect(store.getState().catalog).toBeNull();
    write.resolve();

    await wiped;
    await expect(pending).resolves.toBe(false);
    expect(persisted.size).toBe(0);
    expect(store.getState().catalog).toBeNull();
    expect(store.getState().failure).toBeNull();
  });

  it("purges an old account's pending write before storing the new account's catalog", async () => {
    const write = deferred<void>();
    const saving = vi.fn(() => write.promise);
    persistGate = saving;
    const { authStore, store } = await prepare();
    const pending = store.getState().ensureReady();
    await vi.waitFor(() => expect(saving).toHaveBeenCalledTimes(1));
    authStore.setState({ user: user("b"), authStatus: "authenticated" });
    write.resolve();
    await expect(pending).resolves.toBe(false);
    persistGate = async () => {};

    await expect(store.getState().ensureReady()).resolves.toBe(true);
    expect(persisted.has("a")).toBe(false);
    expect(persisted.get("b")?.userId).toBe("b");
    expect(store.getState().catalog?.userId).toBe("b");
  });

  it("rebuilds rather than publishing an import generation that changed while being saved", async () => {
    const write = deferred<void>();
    const rebuilt = deferred<LibrarySearchTrack[]>();
    const saving = vi.fn(() => write.promise);
    persistGate = saving;
    const acquire = vi.fn(() =>
      acquire.mock.calls.length === 1
        ? Promise.resolve([catalogTrack("obsolete")])
        : rebuilt.promise,
    );
    buildImpl = acquire;
    const { store } = await prepare();
    const { useImportedDriveStore } = await import(
      "@/stores/imported-drive-store"
    );
    const pending = store.getState().ensureReady();
    await vi.waitFor(() => expect(saving).toHaveBeenCalledTimes(1));

    useImportedDriveStore.setState({
      rootFiles: [
        { id: "standalone", name: "Standalone.mp3", mimeType: "audio/mpeg" },
      ],
    });
    write.resolve();
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    expect(store.getState().catalog).toBeNull();
    rebuilt.resolve([catalogTrack("current")]);

    await expect(pending).resolves.toBe(true);
    expect(store.getState().catalog?.tracks[0].id).toBe("current");
    expect(store.getState().catalog?.importsSignature).toBe(
      "folder:music|track:standalone",
    );
    expect(persisted.get("a")?.tracks[0].id).toBe("current");
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
