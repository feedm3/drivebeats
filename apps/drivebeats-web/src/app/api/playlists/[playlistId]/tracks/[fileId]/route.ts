import { NextResponse } from "next/server";
import { withAppDataErrors } from "@/lib/appdata-response";
import { removePlaylistTrackRecord } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const DELETE = withAppDataErrors(async function DELETE(
  _request: Request,
  context: { params: Promise<{ playlistId: string; fileId: string }> },
) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { playlistId, fileId } = await context.params;
  await removePlaylistTrackRecord(session.user, playlistId, fileId);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});
