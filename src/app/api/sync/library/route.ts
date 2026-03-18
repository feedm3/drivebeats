import { NextResponse } from "next/server";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload = await getCloudLibrarySyncPayload(session.user);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
