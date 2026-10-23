import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { withAppDataErrors } from "@/lib/appdata-response";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import {
  deleteAllCloudLibraryData,
  hasDeletedCloudLibraryData,
} from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const DELETE = withAppDataErrors(async function DELETE() {
  // A lost successful response is retryable even after credentials were removed.
  const signed = parseAuthSession(
    (await cookies()).get(AUTH_SESSION_COOKIE)?.value,
  );
  if (await hasDeletedCloudLibraryData(signed))
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  const session = await getServerAuthSession({ allowIncomplete: true });
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
});
