const CACHE_NAME = "drivebeats-shell-v2";
const OFFLINE_DB_NAME = "drivebeats-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_TRACKS_STORE = "offline_tracks";
const OFFLINE_MEDIA_PATH_PREFIX = "/offline-media/";
const SESSION_MEDIA_PATH_PREFIX = "/cached-media/";
const APP_SHELL_URLS = [
  "/",
  "/app",
  "/manifest.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];

function createOfflineResponse() {
  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_TRACKS_STORE)) {
        db.createObjectStore(OFFLINE_TRACKS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open offline DB"));
  });
}

async function getOfflineTrackRecord(fileId) {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_TRACKS_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_TRACKS_STORE);
    const request = store.get(fileId);

    const closeDb = () => db.close();

    tx.oncomplete = closeDb;
    tx.onabort = closeDb;
    tx.onerror = closeDb;

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to read offline track"));
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
  const offlineRecord = await getOfflineTrackRecord(fileId);
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
  const cachedResponse = await caches.match(request.url);
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

async function cacheResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (error) {
    console.error("Failed to cache service worker response:", error);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key === CACHE_NAME) {
              return Promise.resolve();
            }
            return caches.delete(key);
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "CLEAR_CACHES") {
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

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            void cacheResponse(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cachedApp = await caches.match("/app");
          if (cachedApp && url.pathname === "/") {
            return cachedApp;
          }

          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          if (cachedApp) {
            return cachedApp;
          }

          const cachedRoot = await caches.match("/");
          if (cachedRoot) {
            return cachedRoot;
          }

          return createOfflineResponse();
        }),
    );
    return;
  }

  const isStaticAsset = ["script", "style", "image", "font"].includes(
    request.destination,
  );
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            void cacheResponse(request, response.clone());
          }
          return response;
        })
        .catch(() => createOfflineResponse());

      return cachedResponse ?? networkFetch;
    }),
  );
});
