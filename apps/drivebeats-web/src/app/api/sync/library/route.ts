import { NextResponse } from "next/server";
import { withAppDataErrors } from "@/lib/appdata-response";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import { jsonStreamResponse } from "@/lib/json-stream-response";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const GET = withAppDataErrors(async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload = await getCloudLibrarySyncPayload(session.user);
  return jsonStreamResponse(payload);
});
