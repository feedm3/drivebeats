// Cache topology. Three lifetimes, three caches:
//
//   drivebeats-shell-<SHELL_CACHE_VERSION>  generation-scoped, one per worker
//   drivebeats-assets-<IMMUTABLE_ASSET_CACHE_VERSION>  persists across deploys
//   drivebeats-media-v1                     session media, owned by the page
//
// Shell HTML (`/`, `/app`) is MUTABLE per deploy: the same URL returns
// different bytes after every deployment. Since this worker no longer calls
// skipWaiting() on install, a newly installed worker can sit in `waiting` for a
// long time (the whole time a track is playing) while the previous worker stays
// active and keeps serving fetches. If both shared one cache, the waiting
// worker's install would overwrite `/` and `/app` underneath the active worker
// and an offline navigation would be answered with the next deployment's HTML.
// Each generation therefore owns its own shell cache, and every shell read is
// scoped to that one cache with caches.open(SHELL_CACHE_NAME) instead of the
// global caches.match(), which searches every cache including a waiting
// generation's precache.
//
// Content-hashed build output (/_next/static/*) is IMMUTABLE: the hash is in
// the URL, so two deployments can never disagree about what a given URL
// contains. Generation-scoping it would be actively harmful: a fresh shell
// generation starts empty apart from APP_SHELL_URLS, so pruning the previous
// generation on activate would throw away every chunk the app needs to boot and
// an offline launch right after an update would find no chunks at all. Those
// assets therefore live in one cache that survives across generations, so an
// offline boot finds whatever chunks were cached, old or new.
//
// BUMP SHELL_CACHE_VERSION ON EVERY CHANGE TO THIS FILE.
//
// This file is served statically with no build step, so there is no build hash
// to key the cache on. A hand-maintained constant is safe here because a
// browser only installs a new worker when this file changes byte-wise: a new
// generation can only ever come into existence through an edit to this file, so
// bumping the constant is part of the same edit. Skipping the bump makes the
// incoming worker share the active worker's shell cache again, which is exactly
// the corruption described above.
const SHELL_CACHE_VERSION = "v5";
const SHELL_CACHE_NAME = `drivebeats-shell-${SHELL_CACHE_VERSION}`;
// Immutable content-hashed build output. Deliberately NOT generation-scoped:
// its entries can never conflict across deploys, and keeping them is what makes
// an offline boot right after an activation possible. Bump this version only if
// the meaning of the entries themselves changes; activate then drops the old
// one along with any other foreign cache.
const IMMUTABLE_ASSET_CACHE_VERSION = "v1";
const IMMUTABLE_ASSET_CACHE_NAME = `drivebeats-assets-${IMMUTABLE_ASSET_CACHE_VERSION}`;
// Session media cache. The page writes downloaded tracks into it and this
// worker reads them back to serve /cached-media/* range requests.
// Keep in sync with SESSION_MEDIA_CACHE_NAME in src/lib/offline-media.ts.
const SESSION_MEDIA_CACHE_NAME = "drivebeats-media-v1";
// Caches this worker owns and must never drop on activation. Anything else in
// Cache Storage is a leftover from an older worker generation and gets cleaned
// up. The media cache holds the currently playing track, so wiping it would
// break playback the moment a new worker version activates.
const OWNED_CACHE_NAMES = [
  SHELL_CACHE_NAME,
  IMMUTABLE_ASSET_CACHE_NAME,
  SESSION_MEDIA_CACHE_NAME,
];
// Bound for the immutable asset cache. Nothing else evicts it: content-hashed
// URLs from retired deployments are never requested again, so without a bound
// it grows by one deployment's worth of build output forever.
//
// The numbers come from this app's build output: `.next/static` currently ships
// ~52 files totalling ~3.3 MB, so one deployment costs roughly 50-60 entries.
//
//   - Prune target 300 entries (~5-6 deployments, ~20 MB). Deep enough that a
//     prune can never touch the deployment that is about to be served, and deep
//     enough that a user who skipped a few updates still boots offline from
//     chunks an older deployment left behind.
//   - Prune at 400 entries (~7 deployments, ~25 MB). The gap between the two
//     numbers means a prune reclaims ~2 deployments at once instead of trimming
//     a handful of entries on every single activation.
//
// Eviction is by Cache Storage insertion order, which the spec defines as the
// order of the last successful put: `Cache.keys()` returns oldest write first,
// and a re-put moves an entry to the end. Immutable entries are only ever
// written on a cache miss, so that order is first-fetch order (FIFO) rather
// than true LRU. Read hits deliberately do not re-put to refresh the position,
// because that would rewrite the whole JS payload to disk on every page load.
// The cost of the approximation is that an unchanged vendor chunk carried
// across many deploys ages out even though it is still referenced; the
// generous 300-entry floor is what keeps that from mattering in practice, and a
// single online load re-adds anything that was dropped.
const MAX_IMMUTABLE_ASSET_ENTRIES = 400;
const IMMUTABLE_ASSET_PRUNE_TARGET = 300;
const OFFLINE_DB_NAME = "drivebeats-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_TRACKS_STORE = "offline_tracks";
const OFFLINE_COLLECTIONS_STORE = "offline_collections";
// Safari has had failure modes where IndexedDB open/transaction events never
// arrive after suspension or storage-process loss. A fetch event must always
// settle, so both service-worker storage phases use the same bounded deadline
// as the page-side IndexedDB adapter.
const OFFLINE_DB_TIMEOUT_MS = 15_000;
const OFFLINE_MEDIA_PATH_PREFIX = "/offline-media/";
const SESSION_MEDIA_PATH_PREFIX = "/cached-media/";
// Next.js emits everything under /_next/static/ with a content hash in the
// filename and serves it as `public, max-age=31536000, immutable`, so a given
// URL can never change content. Requests for these are served cache-first with
// no background revalidation.
const IMMUTABLE_ASSET_PATH_PREFIXES = ["/_next/static/"];
const APP_SHELL_URLS = [
  "/",
  "/app",
  "/manifest.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];

function isImmutableAssetPath(pathname) {
  return IMMUTABLE_ASSET_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function createOfflineResponse() {
  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function createOfflineStorageUnavailableResponse() {
  return new Response("Offline storage unavailable", {
    status: 503,
    statusText: "Offline Storage Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function createOfflineStorageTimeoutError(phase) {
  const error = new Error(`Offline storage ${phase} timed out`);
  error.name = "TimeoutError";
  return error;
}

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createOfflineStorageTimeoutError("open"));
    }, OFFLINE_DB_TIMEOUT_MS);

    const rejectOpen = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    try {
      request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    } catch (error) {
      rejectOpen(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_TRACKS_STORE)) {
        db.createObjectStore(OFFLINE_TRACKS_STORE);
      }
      // The page and worker share version 1. If the worker is the first opener,
      // it must create every store because opening the same version later will
      // not run another upgrade transaction.
      if (!db.objectStoreNames.contains(OFFLINE_COLLECTIONS_STORE)) {
        db.createObjectStore(OFFLINE_COLLECTIONS_STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // The browser may complete an open request after our fetch deadline.
        // This worker no longer owns that connection, so do not leak it.
        db.close();
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(db);
    };
    request.onerror = () =>
      rejectOpen(request.error ?? new Error("Failed to open offline DB"));
  });
}

async function getOfflineTrackRecord(fileId) {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    let settled = false;
    let readCompleted = false;
    let readResult;
    let tx;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        tx?.abort();
      } catch {
        // A completed/aborting transaction cannot be aborted again.
      }
      db.close();
      reject(createOfflineStorageTimeoutError("read"));
    }, OFFLINE_DB_TIMEOUT_MS);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      db.close();
      callback();
    };

    try {
      tx = db.transaction(OFFLINE_TRACKS_STORE, "readonly");
      const store = tx.objectStore(OFFLINE_TRACKS_STORE);
      const request = store.get(fileId);

      // A request can report success before its transaction later aborts.
      // Resolve (and therefore permit a 404) only after transaction completion.
      request.onsuccess = () => {
        readCompleted = true;
        readResult = request.result;
      };
      request.onerror = () =>
        finish(() =>
          reject(
            request.error ?? new Error("Failed to read offline track record"),
          ),
        );
      tx.oncomplete = () =>
        finish(() => {
          if (!readCompleted) {
            reject(new Error("Offline track read completed without a result"));
            return;
          }
          resolve(readResult);
        });
      tx.onabort = () =>
        finish(() =>
          reject(tx.error ?? new Error("Offline track read was aborted")),
        );
      tx.onerror = () =>
        finish(() =>
          reject(tx.error ?? new Error("Failed to read offline track")),
        );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }

  const [startPart = "", endPart = ""] = rangeHeader.slice(6).split("-", 2);

  if (!startPart && !endPart) {
    return "invalid";
  }

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }

    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(startPart, 10);
  const requestedEnd = endPart ? Number.parseInt(endPart, 10) : size - 1;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

async function createOfflineTrackResponse(request, fileId) {
  let offlineRecord;
  try {
    offlineRecord = await getOfflineTrackRecord(fileId);
  } catch (error) {
    console.error("Failed to read offline media storage:", error);
    return createOfflineStorageUnavailableResponse();
  }

  if (!offlineRecord?.blob) {
    return new Response("Not found", { status: 404 });
  }

  const blob = offlineRecord.blob;
  const size = blob.size;
  const type = offlineRecord.mimeType || blob.type || "audio/mpeg";
  const range = parseRangeHeader(request.headers.get("range"), size);

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  if (range) {
    const chunk = blob.slice(range.start, range.end + 1, type);
    return new Response(chunk, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Type": type,
      },
    });
  }

  return new Response(blob, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(size),
      "Content-Type": type,
    },
  });
}

async function createCachedMediaResponse(request) {
  const mediaCache = await caches.open(SESSION_MEDIA_CACHE_NAME);
  const cachedResponse = await mediaCache.match(request.url);
  if (!cachedResponse) {
    return new Response("Not found", { status: 404 });
  }

  const blob = await cachedResponse.blob();
  const type =
    cachedResponse.headers.get("Content-Type") || blob.type || "audio/mpeg";
  const size = Number.parseInt(
    cachedResponse.headers.get("Content-Length"),
    10,
  );
  const normalizedBlob =
    Number.isFinite(size) && size === blob.size
      ? blob
      : blob.slice(0, blob.size, type);
  const range = parseRangeHeader(
    request.headers.get("range"),
    normalizedBlob.size,
  );

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${normalizedBlob.size}`,
      },
    });
  }

  if (range) {
    const chunk = normalizedBlob.slice(range.start, range.end + 1, type);
    return new Response(chunk, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${normalizedBlob.size}`,
        "Content-Type": type,
      },
    });
  }

  return new Response(normalizedBlob, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(normalizedBlob.size),
      "Content-Type": type,
    },
  });
}

// Every read goes through a named cache handle on purpose. The global
// caches.match() searches every cache in Cache Storage, including the precache
// of a worker that is installed but still waiting, so the active worker could
// answer with the next deployment's HTML while only the current deployment's
// chunks are cached locally. Nothing in this file may use caches.match().
// Resolves to undefined instead of rejecting when Cache Storage is
// unavailable, so callers can always fall through to the network.
function matchCache(cacheName, request) {
  return caches
    .open(cacheName)
    .then((cache) => cache.match(request))
    .catch(() => undefined);
}

// Scoped to this worker generation's shell cache.
function matchShellCache(request) {
  return matchCache(SHELL_CACHE_NAME, request);
}

// Scoped to the cross-generation immutable asset cache.
function matchImmutableAssetCache(request) {
  return matchCache(IMMUTABLE_ASSET_CACHE_NAME, request);
}

async function cacheResponse(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (error) {
    console.error("Failed to cache service worker response:", error);
  }
}

function fetchAndCache(cacheName, request) {
  const response = fetch(request);
  const cacheWrite = response
    .then((networkResponse) => {
      if (!networkResponse.ok) return;
      return cacheResponse(cacheName, request, networkResponse.clone());
    })
    .catch(() => undefined);

  return { response, cacheWrite };
}

// Runs during activate only. At that point the previous worker has already
// stopped receiving fetch events and this one has not started serving yet, so
// no navigation can be mid-flight against the entries being dropped. Failure is
// swallowed: a cache that stays too large is harmless next to an activation
// that never completes.
async function pruneImmutableAssetCache() {
  try {
    const cache = await caches.open(IMMUTABLE_ASSET_CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length <= MAX_IMMUTABLE_ASSET_ENTRIES) {
      return;
    }

    const staleKeys = keys.slice(0, keys.length - IMMUTABLE_ASSET_PRUNE_TARGET);
    await Promise.all(staleKeys.map((key) => cache.delete(key)));
  } catch (error) {
    console.error("Failed to prune the immutable asset cache:", error);
  }
}

self.addEventListener("install", (event) => {
  // Writes the shell cache only. SHELL_CACHE_NAME is generation-scoped, so this
  // precache is invisible to the worker that is still active and serving.
  // waitUntil keeps the all-or-nothing semantics: if addAll rejects, install
  // fails and this worker never activates, leaving the previous generation and
  // its complete cache in place. The immutable asset cache is untouched here:
  // it is shared with the active generation and its content-hashed URLs are not
  // knowable without a build step, so it fills in on demand from fetch.
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)),
  );
  // No skipWaiting() here on purpose: taking over a page that is already
  // running would swap the shell cache under its content-hashed chunks and can
  // interrupt playback. The page asks for the swap via a SKIP_WAITING message
  // when it is safe (see src/components/service-worker-registration.tsx).
});

self.addEventListener("activate", (event) => {
  // Promotion is atomic and free: this generation's shell cache was fully
  // populated during install, and the moment this worker becomes the active one
  // every read switches to it. The browser does not dispatch fetch events to a
  // worker until it reaches `activated`, so no request can observe a
  // half-promoted state. Cleanup then drops previous generations' shell caches
  // and any other leftovers, while keeping all three owned caches: this
  // generation's shell, the cross-generation immutable asset cache (dropping it
  // would leave an offline boot with HTML and no chunks), and the session media
  // cache with the currently playing track. Only then is the immutable asset
  // cache trimmed back to its bound.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (OWNED_CACHE_NAMES.includes(key)) {
              return Promise.resolve();
            }
            return caches.delete(key);
          }),
        ),
      )
      .then(() => pruneImmutableAssetCache())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  const messageType = typeof data === "string" ? data : data?.type;

  if (messageType === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (messageType === "CLEAR_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith(OFFLINE_MEDIA_PATH_PREFIX)) {
    const fileId = decodeURIComponent(
      url.pathname.slice(OFFLINE_MEDIA_PATH_PREFIX.length),
    );

    event.respondWith(createOfflineTrackResponse(request, fileId));
    return;
  }

  if (url.pathname.startsWith(SESSION_MEDIA_PATH_PREFIX)) {
    event.respondWith(createCachedMediaResponse(request));
    return;
  }

  // Navigations: network-first. Reads and writes the generation-scoped SHELL
  // cache only, never the immutable asset cache.
  if (request.mode === "navigate") {
    const networkFetch = fetchAndCache(SHELL_CACHE_NAME, request);
    // Register during the original fetch-event dispatch. Calling waitUntil for
    // the first time inside a later promise callback is too late in Safari.
    event.waitUntil(networkFetch.cacheWrite);
    event.respondWith(
      networkFetch.response.catch(async () => {
        try {
          // One cache handle for the whole fallback, scoped to this
          // generation: the shell HTML served here must be the newest one
          // this worker precached, never a waiting generation's.
          const cache = await caches.open(SHELL_CACHE_NAME);
          const cachedApp = await cache.match("/app");
          if (cachedApp && url.pathname === "/") {
            return cachedApp;
          }

          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          if (cachedApp) {
            return cachedApp;
          }

          const cachedRoot = await cache.match("/");
          if (cachedRoot) {
            return cachedRoot;
          }
        } catch (error) {
          console.error("Failed to read the app shell cache:", error);
        }

        return createOfflineResponse();
      }),
    );
    return;
  }

  // Immutable build output: reads and writes the cross-generation IMMUTABLE
  // ASSET cache only, never the shell cache. A cache hit can never be stale
  // because the content hash is in the URL, so serve it directly and skip the
  // network entirely. Only a miss hits the network, and a successful miss
  // populates the shared cache so the chunk survives the next activation.
  if (isImmutableAssetPath(url.pathname)) {
    const runtimeResult = matchImmutableAssetCache(request).then(
      (cachedResponse) => {
        if (cachedResponse) {
          return {
            cacheWrite: Promise.resolve(),
            response: Promise.resolve(cachedResponse),
          };
        }

        const networkFetch = fetchAndCache(IMMUTABLE_ASSET_CACHE_NAME, request);
        return {
          cacheWrite: networkFetch.cacheWrite,
          response: networkFetch.response.catch(() => createOfflineResponse()),
        };
      },
    );

    event.waitUntil(runtimeResult.then((result) => result.cacheWrite));
    event.respondWith(runtimeResult.then((result) => result.response));
    return;
  }

  const isStaticAsset = ["script", "style", "image", "font"].includes(
    request.destination,
  );
  if (!isStaticAsset) return;

  // Mutable static assets (public/ images, fonts, non-hashed scripts and
  // styles): stale-while-revalidate, because the same URL can change content.
  // Reads and writes the generation-scoped SHELL cache, for the same reason the
  // HTML lives there: these URLs are mutable per deploy, and the manifest and
  // the two icons are already precached there by install.
  const cachedResponse = matchShellCache(request);
  // Capture the stale entry before starting the write that can replace it.
  // The complete revalidation chain is still registered synchronously.
  const revalidation = cachedResponse.then(() =>
    fetchAndCache(SHELL_CACHE_NAME, request),
  );
  event.waitUntil(revalidation.then((result) => result.cacheWrite));
  event.respondWith(
    cachedResponse.then(
      (cached) =>
        cached ??
        revalidation.then((result) =>
          result.response.catch(() => createOfflineResponse()),
        ),
    ),
  );
});
