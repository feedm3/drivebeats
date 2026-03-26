const OFFLINE_MEDIA_PATH_PREFIX = "/offline-media/";
const SESSION_MEDIA_PATH_PREFIX = "/cached-media/";
const SESSION_MEDIA_CACHE_NAME = "drivebeats-media-v1";

export function getOfflineTrackUrl(fileId: string) {
  return `${OFFLINE_MEDIA_PATH_PREFIX}${encodeURIComponent(fileId)}`;
}

export function isBlobUrl(url: string) {
  return url.startsWith("blob:");
}

export function getSessionMediaUrl(fileId: string) {
  return `${SESSION_MEDIA_PATH_PREFIX}${encodeURIComponent(fileId)}`;
}

export function isSessionMediaUrl(url: string) {
  return url.startsWith(SESSION_MEDIA_PATH_PREFIX);
}

function canUseSessionMediaCache() {
  return (
    typeof window !== "undefined" &&
    "caches" in window &&
    "serviceWorker" in navigator &&
    Boolean(navigator.serviceWorker.controller)
  );
}

export async function cacheSessionMedia(
  fileId: string,
  blob: Blob,
  mimeType?: string,
) {
  if (!canUseSessionMediaCache()) {
    return null;
  }

  const cache = await caches.open(SESSION_MEDIA_CACHE_NAME);
  const url = getSessionMediaUrl(fileId);
  await cache.put(
    url,
    new Response(blob, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(blob.size),
        "Content-Type": mimeType || blob.type || "audio/mpeg",
      },
    }),
  );
  return url;
}

export async function deleteSessionMedia(url: string) {
  if (!canUseSessionMediaCache()) {
    return;
  }

  const cache = await caches.open(SESSION_MEDIA_CACHE_NAME);
  await cache.delete(url);
}
