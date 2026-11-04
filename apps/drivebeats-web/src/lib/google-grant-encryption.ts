import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const GOOGLE_SESSION_GRANT_COOKIE = "google_appdata_grant";
export const GOOGLE_SESSION_GRANT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api",
} as const;

function getEncryptionKey() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("Missing AUTH_SESSION_SECRET");
  // Separate the encryption key from the key used to sign session cookies.
  return Buffer.from(
    hkdfSync("sha256", secret, "drivebeats", "google-oauth-grants:v1", 32),
  );
}

export function encryptGoogleRefreshToken(token: string, googleUserId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(googleUserId));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptGoogleRefreshToken(value: string, googleUserId: string) {
  const [version, iv, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra !== undefined) {
    throw new Error("Invalid Google grant ciphertext");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(googleUserId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function sessionGrantBinding(googleUserId: string, sessionId: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID");
  return JSON.stringify([googleUserId, clientId, sessionId]);
}

/** Session grants cannot be moved between Google accounts or OAuth clients. */
export function encryptSessionGoogleGrant(
  token: string,
  googleUserId: string,
  sessionId: string,
) {
  return encryptGoogleRefreshToken(
    token,
    sessionGrantBinding(googleUserId, sessionId),
  );
}

export function decryptSessionGoogleGrant(
  value: string,
  googleUserId: string,
  sessionId: string,
) {
  return decryptGoogleRefreshToken(
    value,
    sessionGrantBinding(googleUserId, sessionId),
  );
}
