import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_SESSION_COOKIE = "auth_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthSession {
  grantedScopes: string[];
  user: AuthUser;
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "Missing required environment variable: AUTH_SESSION_SECRET",
    );
  }

  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function parseAuthUserPayload(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Partial<AuthUser>;
  if (!parsed.id || !parsed.email) {
    return null;
  }

  return {
    id: parsed.id,
    email: parsed.email,
    name: parsed.name ?? null,
    picture: parsed.picture ?? null,
  } satisfies AuthUser;
}

export function serializeAuthSession(session: AuthSession) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString(
    "base64url",
  );
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function serializeAuthUser(user: AuthUser) {
  return serializeAuthSession({
    user,
    grantedScopes: [],
  });
}

export function parseAuthSession(value: string | undefined) {
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
    ) as
      | Partial<AuthSession>
      | (Partial<AuthUser> & { grantedScopes?: unknown; user?: unknown });

    const user = parseAuthUserPayload(parsed.user ?? parsed);
    if (!user) {
      return null;
    }

    const grantedScopes = Array.isArray(parsed.grantedScopes)
      ? parsed.grantedScopes.filter(
          (scope): scope is string =>
            typeof scope === "string" && scope.length > 0,
        )
      : [];

    return {
      user,
      grantedScopes,
    } satisfies AuthSession;
  } catch {
    return null;
  }
}

export function parseAuthUser(value: string | undefined) {
  return parseAuthSession(value)?.user ?? null;
}
