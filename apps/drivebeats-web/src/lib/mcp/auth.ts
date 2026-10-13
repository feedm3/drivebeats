import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt, jwtVerify, SignJWT } from "jose";
import {
  getMcpGrant,
  revokeMcpGrant,
  updateMcpGoogleCredential,
} from "@/db/mcp-grants";
import type { AuthUser } from "@/lib/auth-session";
import { hasGoogleDriveScope, refreshAccessToken } from "@/lib/google";

export const MCP_SCOPES = [
  "profile:read",
  "library:read",
  "media:read",
] as const;
export const MCP_ACCESS_SECONDS = 15 * 60;
export const MCP_GRANT_SECONDS = 30 * 24 * 60 * 60;
export interface McpPrincipal {
  googleUserId: string;
  grantId: string;
  profile: AuthUser;
  scopes: string[];
}

function key(name: string) {
  const value = process.env[name];
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new Error(
      `Missing or invalid ${name}: expected a 32-byte base64url key`,
    );
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32) throw new Error(`Invalid ${name}`);
  return bytes;
}
export function getMcpAuthConfig() {
  const issuer = process.env.MCP_AUTH_ISSUER;
  const clientId = process.env.MCP_CLIENT_ID;
  const callback = process.env.MCP_CLIENT_REDIRECT_URIS;
  if (!issuer || !clientId || !callback)
    throw new Error("Missing MCP authorization configuration");
  const url = new URL(issuer);
  if (url.protocol !== "https:" || url.origin !== issuer)
    throw new Error(
      "MCP_AUTH_ISSUER must be an HTTPS origin without a trailing slash",
    );
  const redirectUris = callback.split(",").map((value) => value.trim());
  if (
    !redirectUris.length ||
    redirectUris.some((value) => {
      const u = new URL(value);
      return (
        u.protocol !== "https:" ||
        Boolean(u.hash) ||
        Boolean(u.username) ||
        Boolean(u.password)
      );
    })
  )
    throw new Error("Invalid MCP client callback allowlist");
  return {
    issuer,
    resource: `${issuer}/mcp`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    clientId,
    redirectUris,
    scopes: [...MCP_SCOPES] as string[],
  };
}
export class McpAuthError extends Error {
  constructor(
    public code: "invalid_token" | "insufficient_scope" = "invalid_token",
    public status: 401 | 403 = 401,
  ) {
    super(code);
  }
}
export function getMcpAuthChallenge(scopes: readonly string[] = MCP_SCOPES) {
  const { resourceMetadataUrl } = getMcpAuthConfig();
  return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scopes.join(" ")}"`;
}
export function hashMcpSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export async function encryptMcpSecret(
  value: Record<string, unknown>,
  purpose: string,
) {
  return new EncryptJWT(value)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(getMcpAuthConfig().issuer)
    .setAudience(purpose)
    .encrypt(key("MCP_CREDENTIAL_ENCRYPTION_KEY"));
}
export async function decryptMcpSecret(value: string, purpose: string) {
  const result = await jwtDecrypt(value, key("MCP_CREDENTIAL_ENCRYPTION_KEY"), {
    issuer: getMcpAuthConfig().issuer,
    audience: purpose,
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  return result.payload;
}
export async function issueMcpAccessToken(principal: {
  googleUserId: string;
  grantId: string;
  scopes: string[];
}) {
  const config = getMcpAuthConfig();
  return new SignJWT({
    grant_id: principal.grantId,
    scope: principal.scopes.join(" "),
  })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(config.issuer)
    .setAudience(config.resource)
    .setSubject(principal.googleUserId)
    .setIssuedAt()
    .setExpirationTime(`${MCP_ACCESS_SECONDS}s`)
    .sign(key("MCP_ACCESS_TOKEN_SIGNING_KEY"));
}
export async function authenticateMcpRequest(
  request: Request,
  requiredScopes: readonly string[] = [],
): Promise<McpPrincipal> {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer [^\s]+$/i.test(header)) throw new McpAuthError();
  const token = header.slice(7);
  try {
    const config = getMcpAuthConfig();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      key("MCP_ACCESS_TOKEN_SIGNING_KEY"),
      {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ["HS256"],
        requiredClaims: ["exp", "iat", "sub", "grant_id", "scope"],
      },
    );
    if (
      protectedHeader.typ !== "at+jwt" ||
      typeof payload.grant_id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(payload.grant_id) ||
      typeof payload.scope !== "string"
    )
      throw new McpAuthError();
    const grant = await getMcpGrant(payload.grant_id);
    if (
      !grant ||
      grant.googleUserId !== payload.sub ||
      grant.profile.id !== grant.googleUserId ||
      grant.clientId !== config.clientId ||
      grant.revokedAt ||
      grant.expiresAt.getTime() <= Date.now()
    )
      throw new McpAuthError();
    const scopes = payload.scope.split(" ");
    if (scopes.some((scope) => !grant.scopes.includes(scope)))
      throw new McpAuthError();
    if (requiredScopes.some((scope) => !scopes.includes(scope)))
      throw new McpAuthError("insufficient_scope", 403);
    return {
      googleUserId: grant.googleUserId,
      grantId: grant.id,
      profile: grant.profile,
      scopes,
    };
  } catch (error) {
    if (error instanceof McpAuthError) throw error;
    throw new McpAuthError();
  }
}
export async function getMcpGoogleAccessToken(principal: McpPrincipal) {
  const grant = await getMcpGrant(principal.grantId);
  if (
    !grant ||
    grant.googleUserId !== principal.googleUserId ||
    grant.profile.id !== grant.googleUserId ||
    grant.revokedAt ||
    grant.expiresAt.getTime() <= Date.now() ||
    !grant.encryptedGoogleRefreshToken
  )
    throw new McpAuthError();
  const decrypted = await decryptMcpSecret(
    grant.encryptedGoogleRefreshToken,
    `google:${grant.id}`,
  );
  if (typeof decrypted.token !== "string") throw new McpAuthError();
  const data = await refreshAccessToken(decrypted.token);
  if (data.error || (data.scope && !hasGoogleDriveScope(data.scope))) {
    await revokeMcpGrant(grant.id, principal.googleUserId);
    throw new McpAuthError();
  }
  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number" ||
    data.expires_in <= 0
  )
    throw new McpAuthError();
  if (data.refresh_token)
    await updateMcpGoogleCredential(
      grant.id,
      await encryptMcpSecret(
        { token: data.refresh_token },
        `google:${grant.id}`,
      ),
    );
  return data.access_token;
}
