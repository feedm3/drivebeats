import { NextResponse } from "next/server";
import {
  deletePlaylistRecord,
  renamePlaylistRecord,
} from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";
import { parsePlaylistNameInput } from "@/lib/cloud-library-validation";

export const runtime = "nodejs";

export async function PATCH(
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
  const payload = parsePlaylistNameInput(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await renamePlaylistRecord(session.user, playlistId, payload.name);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(
  _request: Request,
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
  await deletePlaylistRecord(session.user, playlistId);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
