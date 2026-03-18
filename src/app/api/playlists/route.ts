import { NextResponse } from "next/server";
import type { CreatePlaylistInput } from "@/lib/cloud-library-shared";
import { createPlaylistRecord } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json()) as Partial<CreatePlaylistInput>;
  if (
    typeof body.id !== "string" ||
    body.id.length === 0 ||
    typeof body.name !== "string" ||
    body.name.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await createPlaylistRecord(session.user, {
    id: body.id,
    name: body.name.trim(),
  });

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
