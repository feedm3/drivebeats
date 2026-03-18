import { NextResponse } from "next/server";
import { deleteAllCloudLibraryData } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function DELETE() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  await deleteAllCloudLibraryData(session.user);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
