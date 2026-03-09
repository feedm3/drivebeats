const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_PROFILE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

interface GoogleIdTokenClaims {
  aud: string | string[];
  email?: string;
  exp: number;
  iss: string;
  name?: string;
  picture?: string;
  sub: string;
}

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
    scope: [GOOGLE_DRIVE_SCOPE, ...GOOGLE_PROFILE_SCOPES].join(" "),
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

export function getUserFromIdToken(idToken: string) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const [, payload] = idToken.split(".");

  if (!payload) {
    throw new Error("Invalid id_token payload");
  }

  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as GoogleIdTokenClaims;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const isIssuerValid =
    claims.iss === "https://accounts.google.com" ||
    claims.iss === "accounts.google.com";

  if (!isIssuerValid) {
    throw new Error("Invalid id_token issuer");
  }

  if (!audiences.includes(clientId)) {
    throw new Error("Invalid id_token audience");
  }

  if (claims.exp * 1000 <= Date.now()) {
    throw new Error("Expired id_token");
  }

  if (!claims.sub || !claims.email) {
    throw new Error("Missing required id_token claims");
  }

  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
