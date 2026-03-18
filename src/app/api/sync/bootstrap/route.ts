import { NextResponse } from "next/server";
import { seedCloudLibraryData } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";
import { parseBootstrapPayload } from "@/lib/cloud-library-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const payload = parseBootstrapPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await seedCloudLibraryData(session.user, payload);

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
