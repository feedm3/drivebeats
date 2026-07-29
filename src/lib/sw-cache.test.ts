import { beforeEach, describe, expect, it } from "vitest";

// These mirror the constants and helpers in public/sw.js, which is plain JS
// served statically and therefore cannot be imported here. Keep them in sync.
const SHELL_CACHE_VERSION = "v5";
const SHELL_CACHE_NAME = `drivebeats-shell-${SHELL_CACHE_VERSION}`;
// The generation the previously deployed worker owns and keeps serving from
// while the new worker sits in `waiting`.
const PREVIOUS_SHELL_CACHE_NAME = "drivebeats-shell-v4";
// Not generation-scoped: survives activation so an offline boot right after an
// update still finds the content-hashed chunks it needs.
const IMMUTABLE_ASSET_CACHE_NAME = "drivebeats-assets-v1";
const SESSION_MEDIA_CACHE_NAME = "drivebeats-media-v1";
const OWNED_CACHE_NAMES = [
  SHELL_CACHE_NAME,
  IMMUTABLE_ASSET_CACHE_NAME,
  SESSION_MEDIA_CACHE_NAME,
];
const MAX_IMMUTABLE_ASSET_ENTRIES = 400;
const IMMUTABLE_ASSET_PRUNE_TARGET = 300;
const APP_SHELL_URLS = [
  "/",
  "/app",
  "/manifest.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];
const IMMUTABLE_ASSET_PATH_PREFIXES = ["/_next/static/"];
// Stand-in for createOfflineResponse().
const OFFLINE_RESPONSE = "offline-503";

function isImmutableAssetPath(pathname: string) {
  return IMMUTABLE_ASSET_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

// Minimal in-memory stand-in for Cache Storage. Response bodies are plain
// strings so a test can tell which deployment served an entry.
class FakeCache {
  readonly entries = new Map<string, string>();

  constructor(private readonly fetchUrl: (url: string) => string) {}

  match(url: string) {
    return Promise.resolve(this.entries.get(url));
  }

  // Cache.put is specified as a delete followed by an append, so a re-put moves
  // the entry to the end of the request-response list. Map.set keeps the
  // original position of an existing key, so delete first to match the spec:
  // insertion order is what the eviction pass relies on.
  put(url: string, body: string) {
    this.entries.delete(url);
    this.entries.set(url, body);
    return Promise.resolve();
  }

  // Cache.keys() yields entries oldest write first.
  keys() {
    return Promise.resolve([...this.entries.keys()]);
  }

  delete(url: string) {
    return Promise.resolve(this.entries.delete(url));
  }

  // Cache.addAll is all-or-nothing: a single failed request rejects the whole
  // call and writes nothing.
  async addAll(urls: string[]) {
    const fetched = urls.map((url) => [url, this.fetchUrl(url)] as const);
    for (const [url, body] of fetched) {
      this.entries.set(url, body);
    }
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  // Stands in for the network: what a precache fetch returns right now.
  fetchUrl: (url: string) => string = (url) => url;

  open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache((url) => this.fetchUrl(url));
      this.caches.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  keys() {
    return Promise.resolve([...this.caches.keys()]);
  }

  delete(name: string) {
    return Promise.resolve(this.caches.delete(name));
  }

  // The global caches.match() the worker deliberately never uses: it searches
  // every cache, in creation order.
  match(url: string) {
    for (const cache of this.caches.values()) {
      const hit = cache.entries.get(url);
      if (hit !== undefined) {
        return Promise.resolve(hit);
      }
    }
    return Promise.resolve(undefined);
  }
}

// public/sw.js install handler: writes the generation-scoped shell cache only.
async function simulateInstall(storage: FakeCacheStorage, cacheName: string) {
  const cache = await storage.open(cacheName);
  await cache.addAll(APP_SHELL_URLS);
}

// public/sw.js pruneImmutableAssetCache().
async function simulatePruneImmutableAssets(storage: FakeCacheStorage) {
  const cache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length <= MAX_IMMUTABLE_ASSET_ENTRIES) {
    return;
  }

  const staleKeys = keys.slice(0, keys.length - IMMUTABLE_ASSET_PRUNE_TARGET);
  await Promise.all(staleKeys.map((key) => cache.delete(key)));
}

// public/sw.js activate handler.
async function simulateActivate(storage: FakeCacheStorage, cacheName: string) {
  const owned = [
    cacheName,
    IMMUTABLE_ASSET_CACHE_NAME,
    SESSION_MEDIA_CACHE_NAME,
  ];
  const keys = await storage.keys();
  await Promise.all(
    keys.map((key) =>
      owned.includes(key) ? Promise.resolve(true) : storage.delete(key),
    ),
  );
  await simulatePruneImmutableAssets(storage);
}

// public/sw.js matchShellCache().
function matchShellCache(
  storage: FakeCacheStorage,
  cacheName: string,
  url: string,
) {
  return storage.open(cacheName).then((cache) => cache.match(url));
}

// public/sw.js matchImmutableAssetCache().
function matchImmutableAssetCache(storage: FakeCacheStorage, url: string) {
  return storage
    .open(IMMUTABLE_ASSET_CACHE_NAME)
    .then((cache) => cache.match(url));
}

// public/sw.js fetch handler, isImmutableAssetPath() branch: cache-first
// against the immutable asset cache, network only on a miss.
async function simulateImmutableAssetFetch(
  storage: FakeCacheStorage,
  url: string,
  network: (url: string) => string,
) {
  const cached = await matchImmutableAssetCache(storage, url);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = network(url);
    const cache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    await cache.put(url, response);
    return response;
  } catch {
    return OFFLINE_RESPONSE;
  }
}

const offlineNetwork = () => {
  throw new Error("offline");
};

// public/sw.js CLEAR_CACHES message handler.
async function simulateClearCaches(storage: FakeCacheStorage) {
  const keys = await storage.keys();
  await Promise.all(keys.map((key) => storage.delete(key)));
}

describe("SW shell cache generations", () => {
  let storage: FakeCacheStorage;

  beforeEach(async () => {
    storage = new FakeCacheStorage();

    // The deployment that is live right now: a complete, self-consistent shell
    // cache plus the content-hashed chunks its HTML references. The chunks live
    // in the shared immutable asset cache, not in the shell generation.
    storage.fetchUrl = (url) => `${url}#deploy-1`;
    await simulateInstall(storage, PREVIOUS_SHELL_CACHE_NAME);
    const assetCache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    await assetCache.put(
      "/_next/static/chunks/main-deploy1.js",
      "chunk#deploy-1",
    );

    // The currently playing track.
    const mediaCache = await storage.open(SESSION_MEDIA_CACHE_NAME);
    await mediaCache.put("/cached-media/track-1", "audio-bytes");

    // Everything installed from here on belongs to the new deployment.
    storage.fetchUrl = (url) => `${url}#deploy-2`;
  });

  it("does not mutate the active shell cache while the new worker waits", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);

    expect(await matchShellCache(storage, PREVIOUS_SHELL_CACHE_NAME, "/")).toBe(
      "/#deploy-1",
    );
    expect(
      await matchShellCache(storage, PREVIOUS_SHELL_CACHE_NAME, "/app"),
    ).toBe("/app#deploy-1");
  });

  it("keeps the waiting precache in its own generation", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);

    expect(await matchShellCache(storage, SHELL_CACHE_NAME, "/app")).toBe(
      "/app#deploy-2",
    );
    expect(storage.caches.has(PREVIOUS_SHELL_CACHE_NAME)).toBe(true);
  });

  it("never lets a scoped shell read fall through to another generation", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    // The active generation lost an entry (eviction, or it was never precached
    // by that older worker). A global caches.match() would happily answer with
    // the waiting generation's HTML, which references chunks that do not exist
    // locally; the scoped read must miss instead and fall back to the offline
    // response.
    const activeCache = await storage.open(PREVIOUS_SHELL_CACHE_NAME);
    activeCache.entries.delete("/");

    expect(await storage.match("/")).toBe("/#deploy-2");
    expect(
      await matchShellCache(storage, PREVIOUS_SHELL_CACHE_NAME, "/"),
    ).toBeUndefined();
  });

  it("promotes the precache the moment the new worker activates", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    for (const url of APP_SHELL_URLS) {
      expect(await matchShellCache(storage, SHELL_CACHE_NAME, url)).toBe(
        `${url}#deploy-2`,
      );
    }
  });

  it("keeps the session media cache holding the playing track", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    const mediaCache = await storage.open(SESSION_MEDIA_CACHE_NAME);
    expect(await mediaCache.match("/cached-media/track-1")).toBe("audio-bytes");
  });

  it("prunes stale generations and unrelated caches on activation", async () => {
    await storage.open("drivebeats-shell-v1");
    await storage.open("drivebeats-assets-v0");
    await storage.open("unrelated-cache");
    await simulateInstall(storage, SHELL_CACHE_NAME);

    await simulateActivate(storage, SHELL_CACHE_NAME);

    expect(await storage.keys()).toEqual(
      expect.arrayContaining(OWNED_CACHE_NAMES),
    );
    expect(await storage.keys()).toHaveLength(OWNED_CACHE_NAMES.length);
    expect(storage.caches.has(PREVIOUS_SHELL_CACHE_NAME)).toBe(false);
    expect(storage.caches.has("drivebeats-shell-v1")).toBe(false);
    expect(storage.caches.has("drivebeats-assets-v0")).toBe(false);
    expect(storage.caches.has("unrelated-cache")).toBe(false);
  });

  it("leaves the active cache intact when the precache cannot be populated", async () => {
    storage.fetchUrl = (url) => {
      if (url === "/app") {
        throw new Error("network error");
      }
      return `${url}#deploy-2`;
    };

    await expect(simulateInstall(storage, SHELL_CACHE_NAME)).rejects.toThrow(
      "network error",
    );

    // install rejected, so the worker never activates and never prunes: the
    // previous generation keeps serving a complete shell.
    expect(
      await matchShellCache(storage, PREVIOUS_SHELL_CACHE_NAME, "/app"),
    ).toBe("/app#deploy-1");
    const stagedCache = await storage.open(SHELL_CACHE_NAME);
    expect(stagedCache.entries.size).toBe(0);
  });
});

describe("SW immutable asset cache", () => {
  let storage: FakeCacheStorage;

  beforeEach(async () => {
    storage = new FakeCacheStorage();
    storage.fetchUrl = (url) => `${url}#deploy-1`;
    await simulateInstall(storage, PREVIOUS_SHELL_CACHE_NAME);
    // Chunks the live deployment fetched while the user was online.
    await simulateImmutableAssetFetch(
      storage,
      "/_next/static/chunks/framework.js",
      (url) => `${url}#deploy-1`,
    );
    await simulateImmutableAssetFetch(
      storage,
      "/_next/static/chunks/app.js",
      (url) => `${url}#deploy-1`,
    );
    storage.fetchUrl = (url) => `${url}#deploy-2`;
  });

  it("survives activation so an offline boot still finds cached chunks", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    // The PWA is launched offline immediately after the swap. The shell HTML
    // comes from the new generation; the chunks must still resolve from the
    // cache the previous generation filled.
    expect(await matchShellCache(storage, SHELL_CACHE_NAME, "/app")).toBe(
      "/app#deploy-2",
    );
    expect(
      await simulateImmutableAssetFetch(
        storage,
        "/_next/static/chunks/framework.js",
        offlineNetwork,
      ),
    ).toBe("/_next/static/chunks/framework.js#deploy-1");
    expect(
      await simulateImmutableAssetFetch(
        storage,
        "/_next/static/chunks/app.js",
        offlineNetwork,
      ),
    ).toBe("/_next/static/chunks/app.js#deploy-1");
  });

  it("writes immutable assets outside every shell generation", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateImmutableAssetFetch(
      storage,
      "/_next/static/chunks/new.js",
      (url) => `${url}#deploy-2`,
    );

    const shellCache = await storage.open(SHELL_CACHE_NAME);
    const previousShellCache = await storage.open(PREVIOUS_SHELL_CACHE_NAME);
    expect(
      await shellCache.match("/_next/static/chunks/new.js"),
    ).toBeUndefined();
    expect(
      await previousShellCache.match("/_next/static/chunks/new.js"),
    ).toBeUndefined();
    expect(
      await matchImmutableAssetCache(storage, "/_next/static/chunks/new.js"),
    ).toBe("/_next/static/chunks/new.js#deploy-2");
  });

  it("falls back to the offline response for a chunk that was never cached", async () => {
    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    expect(
      await simulateImmutableAssetFetch(
        storage,
        "/_next/static/chunks/never-seen.js",
        offlineNetwork,
      ),
    ).toBe(OFFLINE_RESPONSE);
  });

  it("leaves the cache alone while it is under the bound", async () => {
    const cache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    for (let index = cache.entries.size; index < 350; index += 1) {
      await cache.put(`/_next/static/chunks/${index}.js`, `chunk-${index}`);
    }

    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    expect((await cache.keys()).length).toBe(350);
  });

  it("prunes down to the target once the bound is exceeded", async () => {
    const cache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    for (let index = cache.entries.size; index < 405; index += 1) {
      await cache.put(`/_next/static/chunks/${index}.js`, `chunk-${index}`);
    }
    const before = await cache.keys();
    expect(before).toHaveLength(MAX_IMMUTABLE_ASSET_ENTRIES + 5);

    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    const after = await cache.keys();
    expect(after).toHaveLength(IMMUTABLE_ASSET_PRUNE_TARGET);
    // Oldest writes go first, newest writes survive.
    expect(after).toEqual(before.slice(before.length - after.length));
  });

  it("keeps the newest deployment's chunks when pruning", async () => {
    const cache = await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    for (let index = cache.entries.size; index < 360; index += 1) {
      await cache.put(`/_next/static/chunks/old-${index}.js`, "chunk#old");
    }
    // One deployment's worth of build output, fetched last.
    const newChunks = Array.from(
      { length: 55 },
      (_, index) => `/_next/static/chunks/deploy2-${index}.js`,
    );
    for (const url of newChunks) {
      await simulateImmutableAssetFetch(storage, url, (u) => `${u}#deploy-2`);
    }

    await simulateInstall(storage, SHELL_CACHE_NAME);
    await simulateActivate(storage, SHELL_CACHE_NAME);

    expect((await cache.keys()).length).toBe(IMMUTABLE_ASSET_PRUNE_TARGET);
    for (const url of newChunks) {
      expect(
        await simulateImmutableAssetFetch(storage, url, offlineNetwork),
      ).toBe(`${url}#deploy-2`);
    }
  });
});

describe("SW CLEAR_CACHES handler", () => {
  it("deletes every cache, including the immutable assets and the media cache", async () => {
    const storage = new FakeCacheStorage();
    await storage.open(PREVIOUS_SHELL_CACHE_NAME);
    await storage.open(SHELL_CACHE_NAME);
    await storage.open(IMMUTABLE_ASSET_CACHE_NAME);
    await storage.open(SESSION_MEDIA_CACHE_NAME);
    await storage.open("unrelated-cache");

    await simulateClearCaches(storage);

    expect(await storage.keys()).toHaveLength(0);
  });

  it("handles empty cache storage", async () => {
    const storage = new FakeCacheStorage();

    await simulateClearCaches(storage);

    expect(await storage.keys()).toHaveLength(0);
  });
});

describe("isImmutableAssetPath", () => {
  it("treats content-hashed Next.js build output as immutable", () => {
    expect(isImmutableAssetPath("/_next/static/chunks/main-abc123.js")).toBe(
      true,
    );
    expect(isImmutableAssetPath("/_next/static/css/abc123.css")).toBe(true);
    expect(
      isImmutableAssetPath("/_next/static/media/font.a9727b5d.woff2"),
    ).toBe(true);
  });

  it("treats mutable URLs as revalidatable", () => {
    expect(isImmutableAssetPath("/_next/image?url=%2Ficon.png&w=64&q=75")).toBe(
      false,
    );
    expect(isImmutableAssetPath("/web-app-manifest-192x192.png")).toBe(false);
    expect(isImmutableAssetPath("/theme-init.js")).toBe(false);
    expect(isImmutableAssetPath("/app")).toBe(false);
    expect(isImmutableAssetPath("/")).toBe(false);
  });

  it("does not match a lookalike path prefix", () => {
    expect(isImmutableAssetPath("/not/_next/static/chunk.js")).toBe(false);
  });
});
