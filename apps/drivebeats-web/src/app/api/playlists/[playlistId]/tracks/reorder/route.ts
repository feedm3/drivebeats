import { NextResponse } from "next/server";
import { reorderPlaylistTracksRecords } from "@/lib/cloud-library-service";
import { parseReorderPlaylistTracksInput } from "@/lib/cloud-library-validation";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ playlistId: string }> },
) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { playlistId } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const payload = parseReorderPlaylistTracksInput(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await reorderPlaylistTracksRecords(
      session.user,
      playlistId,
      payload.fileIds,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid reorder payload") {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    throw error;
  }
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
