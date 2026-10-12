import { NextResponse } from "next/server";
import { addPlaylistTracksRecords } from "@/lib/cloud-library-service";
import { parseAddPlaylistTracksInput } from "@/lib/cloud-library-validation";
import { getPlaylistLimitError } from "@/lib/playlist-limits";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(
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
  const payload = parseAddPlaylistTracksInput(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await addPlaylistTracksRecords(
      session.user,
      playlistId,
      payload.tracks,
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const limitError = getPlaylistLimitError(error);
    if (limitError) {
      return NextResponse.json(
        { error: limitError.message, code: limitError.code },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    throw error;
  }
}
