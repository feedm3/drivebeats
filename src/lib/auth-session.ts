import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_SESSION_COOKIE = "auth_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

function getSessionSecret() {
  const secret =
    process.env.AUTH_SESSION_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

  if (!secret) {
    throw new Error(
      "Missing required environment variable: AUTH_SESSION_SECRET or GOOGLE_CLIENT_SECRET",
    );
  }

  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

export function serializeAuthUser(user: AuthUser) {
  const payload = Buffer.from(JSON.stringify(user), "utf8").toString(
    "base64url",
  );
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function parseAuthUser(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const [payload, signature] = value.split(".");

    if (!payload || !signature) {
      return null;
    }

    const expectedSignature = signPayload(payload);
    const provided = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<AuthUser>;

    if (!parsed.id || !parsed.email) {
      return null;
    }

    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name ?? null,
      picture: parsed.picture ?? null,
    } satisfies AuthUser;
  } catch {
    return null;
  }
}
