import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

/** Retired endpoint: acknowledge old open clients without storing extracted tags. */
export async function POST() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, retired: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
