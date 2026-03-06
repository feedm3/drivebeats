const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function getRequiredEnv(
  name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "NEXT_PUBLIC_APP_URL",
) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface GoogleAuthUrlOptions {
  state: string;
  prompt?: "consent";
}

export function getGoogleAuthUrl({ state, prompt }: GoogleAuthUrlOptions) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    access_type: "offline",
    include_granted_scopes: "true",
    state,
  });

  if (prompt) {
    params.set("prompt", prompt);
  }

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
  const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

export async function refreshAccessToken(refreshToken: string) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  return res.json();
}
