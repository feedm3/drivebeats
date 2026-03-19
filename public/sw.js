const CACHE_NAME = "drivebeats-shell-v2";
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
