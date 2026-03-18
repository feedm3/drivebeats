import { NextResponse } from "next/server";
import {
  deletePlaylistRecord,
  renamePlaylistRecord,
} from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

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
  const body = (await request.json()) as Partial<{ name: string }>;
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await renamePlaylistRecord(session.user, playlistId, body.name.trim());
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
