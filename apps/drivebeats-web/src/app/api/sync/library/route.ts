import { NextResponse } from "next/server";
import { withAppDataErrors } from "@/lib/appdata-response";
import { getCloudLibrarySyncResult } from "@/lib/cloud-library-service";
import { jsonStreamResponse } from "@/lib/json-stream-response";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const GET = withAppDataErrors(async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { payload, checkpoint } = await getCloudLibrarySyncResult(
    session,
    request.headers.get("X-DriveBeats-Checkpoint") ?? undefined,
  );
  const headers = {
    "Cache-Control": "private, no-store",
    "X-DriveBeats-Checkpoint": checkpoint,
  };
  if (payload === null) return new Response(null, { status: 304, headers });
  const response = jsonStreamResponse(payload);
  response.headers.set("X-DriveBeats-Checkpoint", checkpoint);
  return response;
});
