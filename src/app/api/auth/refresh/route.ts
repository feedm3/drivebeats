import { type NextRequest, NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/google";

export async function POST(request: NextRequest) {
  const refresh_token = request.cookies.get("refresh_token")?.value;
  if (!refresh_token) {
    return NextResponse.json(
      { error: "No refresh token provided" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const data = await refreshAccessToken(refresh_token);
  if (data.error) {
    const response = NextResponse.json(
      { error: data.error_description },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
    response.cookies.set("refresh_token", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 0,
    });
    return response;
  }

  return NextResponse.json(
    {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
