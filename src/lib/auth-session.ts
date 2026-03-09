export const AUTH_SESSION_COOKIE = "auth_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export function serializeAuthUser(user: AuthUser) {
  return Buffer.from(JSON.stringify(user), "utf8").toString("base64url");
}

export function parseAuthUser(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
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
