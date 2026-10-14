import type { NextRequest } from "next/server";
import { refreshDriveReadToken } from "@/lib/drive-read-auth";
import { parseDriveReadTarget, relayDriveRead } from "@/lib/drive-read-service";
import { hasGoogleDriveScope } from "@/lib/google";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 800;

function unauthorized() {
  return Response.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function gatewayFailure() {
  return Response.json(
    { error: "Google Drive could not be reached. Try again." },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  if (request.headers.get("X-DriveBeats-Read") !== "1") {
    return Response.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const session = await getServerAuthSession();
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (
    !session ||
    !hasGoogleDriveScope(session.grantedScopes) ||
    !refreshToken
  ) {
    return unauthorized();
  }
  const target = parseDriveReadTarget(new URL(request.url).searchParams);
  if (!target)
    return Response.json(
      { error: "Invalid Drive read" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    request.signal.throwIfAborted();
    const token = await refreshDriveReadToken(refreshToken, request.signal);
    request.signal.throwIfAborted();
    if (token.status === 401) return unauthorized();
    if (token.status === 502) return gatewayFailure();
    return await relayDriveRead(
      target,
      `Bearer ${token.accessToken}`,
      request.signal,
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return gatewayFailure();
  }
}
