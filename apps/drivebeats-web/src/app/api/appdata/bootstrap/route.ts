import { NextResponse } from "next/server";
import { getAppDataRollout } from "@/db/appdata-control";
import {
  appDataFailure,
  appDataHeaders,
  withAppDataErrors,
} from "@/lib/appdata-response";
import { bootstrapAppData } from "@/lib/cloud-library-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const POST = withAppDataErrors(async function POST(request: Request) {
  const session = await getServerAuthSession({ allowIncomplete: true });
  if (!session)
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401, headers: appDataHeaders },
    );
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 403, headers: appDataHeaders },
    );
  try {
    return NextResponse.json(await bootstrapAppData(session.user), {
      headers: appDataHeaders,
    });
  } catch (error) {
    const response = appDataFailure(error);
    const rollout = await getAppDataRollout().catch(() => null);
    const body = await response.json();
    return NextResponse.json(
      { ...body, cutoff: rollout?.cleanupDueAt ?? null },
      { status: response.status, headers: appDataHeaders },
    );
  }
});
