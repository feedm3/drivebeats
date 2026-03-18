import { NextResponse } from "next/server";
import { setFavoriteTrackRecord } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";
import { parseFavoriteTrackInput } from "@/lib/cloud-library-validation";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { fileId } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const payload = parseFavoriteTrackInput(body, fileId);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await setFavoriteTrackRecord(session.user, payload.track, true);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { fileId } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const payload = parseFavoriteTrackInput(body, fileId);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await setFavoriteTrackRecord(session.user, payload.track, false);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
