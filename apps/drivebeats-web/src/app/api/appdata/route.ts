import { NextResponse } from "next/server";
import { getAppDataContext } from "@/lib/appdata-context";
import { readAppDataCommand } from "@/lib/appdata-request";
import { appDataHeaders, withAppDataErrors } from "@/lib/appdata-response";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

export const GET = withAppDataErrors(async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session)
    return NextResponse.json(
      { error: "App-folder approval and migration required" },
      { status: 403, headers: appDataHeaders },
    );
  const { identity, service } = await getAppDataContext(session.user);
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  return NextResponse.json(await service.readPage(identity, cursor), {
    headers: appDataHeaders,
  });
});

export const POST = withAppDataErrors(async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session)
    return NextResponse.json(
      { error: "App-folder approval and migration required" },
      { status: 403, headers: appDataHeaders },
    );
  if (
    request.headers.get("Origin") !== new URL(request.url).origin ||
    !request.headers.get("Content-Type")?.startsWith("application/json")
  )
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 403, headers: appDataHeaders },
    );
  const { identity, service } = await getAppDataContext(session.user);
  const command = await readAppDataCommand(request, identity.generation);
  return NextResponse.json(await service.append(identity, command), {
    headers: appDataHeaders,
  });
});
