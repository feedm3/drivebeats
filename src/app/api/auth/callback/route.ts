import { type NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const data = await exchangeCodeForTokens(code);
  if (data.error) {
    return NextResponse.json(
      { error: data.error_description },
      { status: 400 },
    );
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  const encoded = Buffer.from(JSON.stringify(tokens)).toString("base64");
  return NextResponse.redirect(
    `https://${process.env.NEXT_PUBLIC_VERCEL_URL}/?tokens=${encoded}`,
  );
}
