import { NextResponse } from "next/server";
import { appDataHeaders, withAppDataErrors } from "@/lib/appdata-response";
import { AUTH_SESSION_COOKIE, serializeAuthSession } from "@/lib/auth-session";
import { resetCloudLibraryData } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const POST = withAppDataErrors(async function POST(request: Request) {
  const session = await getServerAuthSession({ allowIncomplete: true });
  if (!session?.accountGeneration)
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401, headers: appDataHeaders },
    );
  if (
    request.headers.get("Origin") !== new URL(request.url).origin ||
    request.headers.get("X-DriveBeats-Generation") !== session.accountGeneration
  )
    return NextResponse.json(
      { error: "Account changed; reconnect before resetting backup" },
      { status: 403, headers: appDataHeaders },
    );
  const account = await resetCloudLibraryData(session.user);
  const response = NextResponse.json(
    {
      reset: true,
      generation: account.generation,
      cleanupPending: account.cleanupPending,
    },
    { headers: appDataHeaders },
  );
  response.cookies.set(
    AUTH_SESSION_COOKIE,
    serializeAuthSession({
      ...session,
      accountGeneration: account.generation,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    },
  );
  return response;
});
