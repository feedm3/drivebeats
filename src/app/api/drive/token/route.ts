import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { accessToken } = await request.json();
  if (!accessToken) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("drive_access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 3500, // just under 1h token lifetime
    path: "/api/drive/stream",
  });
  return response;
}
