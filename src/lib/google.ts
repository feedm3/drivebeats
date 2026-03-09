import { createPublicKey, verify as verifySignature } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_PROFILE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

interface GoogleJwtHeader {
  alg?: string;
  kid?: string;
}

interface GoogleIdTokenClaims {
  aud: string | string[];
  email?: string;
  email_verified?: boolean;
  exp: number;
  iss: string;
  name?: string;
  nonce?: string;
  picture?: string;
  sub: string;
}

interface GoogleJwk {
  alg?: string;
  e: string;
  kid: string;
  kty: string;
  n: string;
  use?: string;
}

interface GoogleJwksResponse {
  keys?: GoogleJwk[];
}

let googleJwksCache: {
  expiresAt: number;
  keys: GoogleJwk[];
} | null = null;

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
  nonce: string;
  state: string;
  prompt?: "consent";
}

function decodeBase64UrlJson<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function parseMaxAgeSeconds(cacheControl: string | null) {
  if (!cacheControl) {
    return 3600;
  }

  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) {
    return 3600;
  }

  const maxAge = Number(match[1]);
  return Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 3600;
}

async function getGoogleSigningKeys() {
  if (googleJwksCache && googleJwksCache.expiresAt > Date.now()) {
    return googleJwksCache.keys;
  }

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error("Failed to load Google signing keys");
  }

  const data = (await res.json()) as GoogleJwksResponse;
  const keys = data.keys ?? [];

  if (keys.length === 0) {
    throw new Error("Google signing keys missing");
  }

  googleJwksCache = {
    expiresAt:
      Date.now() + parseMaxAgeSeconds(res.headers.get("cache-control")) * 1000,
    keys,
  };

  return keys;
}

function verifyJwtSignature(
  headerSegment: string,
  payloadSegment: string,
  signatureSegment: string,
  jwk: GoogleJwk,
) {
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const publicKey = createPublicKey({
    key: jwk as JsonWebKey,
    format: "jwk",
  });

  return verifySignature(
    "RSA-SHA256",
    Buffer.from(signingInput, "utf8"),
    publicKey,
    Buffer.from(signatureSegment, "base64url"),
  );
}

export function getGoogleAuthUrl({
  state,
  nonce,
  prompt,
}: GoogleAuthUrlOptions) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/callback`,
    response_type: "code",
    scope: [GOOGLE_DRIVE_SCOPE, ...GOOGLE_PROFILE_SCOPES].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    nonce,
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

export async function getUserFromIdToken(
  idToken: string,
  expectedNonce: string,
) {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const [headerSegment, payloadSegment, signatureSegment] = idToken.split(".");

  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new Error("Invalid id_token");
  }

  const header = decodeBase64UrlJson<GoogleJwtHeader>(headerSegment);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid id_token header");
  }

  const signingKeys = await getGoogleSigningKeys();
  const signingKey = signingKeys.find(
    (key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      (key.use === undefined || key.use === "sig"),
  );

  if (!signingKey) {
    throw new Error("Unknown Google signing key");
  }

  if (
    !verifyJwtSignature(
      headerSegment,
      payloadSegment,
      signatureSegment,
      signingKey,
    )
  ) {
    throw new Error("Invalid id_token signature");
  }

  const claims = decodeBase64UrlJson<GoogleIdTokenClaims>(payloadSegment);
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

  if (!claims.nonce || claims.nonce !== expectedNonce) {
    throw new Error("Invalid id_token nonce");
  }

  if (!claims.sub || !claims.email) {
    throw new Error("Missing required id_token claims");
  }

  if (claims.email_verified === false) {
    throw new Error("Unverified Google account email");
  }

  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
