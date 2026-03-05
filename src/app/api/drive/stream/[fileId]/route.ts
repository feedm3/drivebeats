import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;

  // Accept token from cookie (secure) or query param (fallback for <audio src>)
  const accessToken =
    request.cookies.get("drive_access_token")?.value ||
    request.nextUrl.searchParams.get("accessToken");

  if (!accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers },
  );

  if (!res.ok && res.status !== 206) {
    return new Response("Failed to stream", { status: res.status });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "audio/mpeg");
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set("Cache-Control", "private, max-age=3600");

  const contentLength = res.headers.get("Content-Length");
  if (contentLength) responseHeaders.set("Content-Length", contentLength);

  const contentRange = res.headers.get("Content-Range");
  if (contentRange) responseHeaders.set("Content-Range", contentRange);

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}
