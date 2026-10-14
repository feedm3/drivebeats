const ALLOWED_PARAMS = new Set([
  "q",
  "fields",
  "pageSize",
  "pageToken",
  "spaces",
  "orderBy",
  "corpora",
  "driveId",
  "supportsAllDrives",
  "includeItemsFromAllDrives",
  "alt",
]);

export function parseDriveReadTarget(params: URLSearchParams): URL | null {
  const fileIds = params.getAll("fileId");
  if (fileIds.length > 1) return null;
  const fileId = fileIds[0];
  if (fileId !== undefined && !/^[\w-]{1,512}$/.test(fileId)) return null;
  const target = new URL("https://www.googleapis.com/drive/v3/files");
  if (fileId) target.pathname += `/${fileId}`;
  for (const [key, value] of params) {
    if (key === "fileId") continue;
    if (!ALLOWED_PARAMS.has(key) || target.searchParams.has(key)) return null;
    target.searchParams.set(key, value);
  }
  if (
    target.searchParams.get("alt") &&
    target.searchParams.get("alt") !== "media"
  )
    return null;
  if (target.searchParams.get("alt") === "media" && !fileId) return null;
  return target;
}

export async function relayDriveRead(
  target: URL,
  authorization: string,
  signal: AbortSignal,
) {
  const upstream = await fetch(target, {
    method: "GET",
    headers: { Authorization: authorization },
    signal,
    cache: "no-store",
    redirect: "error",
  });
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "Content-Type",
    "Content-Range",
    "Accept-Ranges",
    "Retry-After",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Pass the stream through without buffering or persisting audio on the server.
  return new Response(upstream.body, { status: upstream.status, headers });
}
