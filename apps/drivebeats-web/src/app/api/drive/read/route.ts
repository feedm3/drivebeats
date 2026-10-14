import { parseDriveReadTarget, relayDriveRead } from "@/lib/drive-read-service";
import { hasGoogleDriveScope } from "@/lib/google";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  const authorization = request.headers.get("authorization");
  if (
    !session ||
    !hasGoogleDriveScope(session.grantedScopes) ||
    !authorization ||
    !/^Bearer [^\s]{1,2048}$/.test(authorization)
  ) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const target = parseDriveReadTarget(new URL(request.url).searchParams);
  if (!target)
    return Response.json(
      { error: "Invalid Drive read" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return await relayDriveRead(target, authorization, request.signal);
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      { error: "Google Drive could not be reached. Try again." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
