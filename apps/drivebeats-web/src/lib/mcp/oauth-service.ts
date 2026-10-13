import { randomUUID } from "node:crypto";
import OAuth2Server from "@node-oauth/oauth2-server";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  consumeMcpAuthorizationCode,
  getMcpAuthorizationCode,
  saveMcpAuthorizationCode,
} from "@/db/mcp-authorization-codes";
import {
  clearExpiredMcpCredentials,
  createMcpGrant,
  getMcpGrant,
  revokeMcpGrant,
} from "@/db/mcp-grants";
import {
  consumeMcpLinkRequest,
  getMcpLinkRequest,
  saveMcpLinkRequest,
  updateMcpLinkRequest,
} from "@/db/mcp-link-requests";
import {
  consumeMcpRefreshToken,
  getMcpRefreshToken,
  saveMcpRefreshToken,
} from "@/db/mcp-refresh-tokens";
import { upsertUser } from "@/db/users";
import type { AuthUser } from "@/lib/auth-session";
import {
  GOOGLE_DRIVE_SCOPE,
  getUserFromIdToken,
  hasGoogleDriveScope,
} from "@/lib/google";
import {
  exchangeGoogleOAuthCode,
  getGoogleAuthUrlBase,
} from "@/lib/google-api";
import {
  authenticateMcpRequest,
  decryptMcpSecret,
  encryptMcpSecret,
  getMcpAuthConfig,
  hashMcpSecret,
  issueMcpAccessToken,
  MCP_ACCESS_SECONDS,
  MCP_GRANT_SECONDS,
} from "./auth";

import {
  AUTHORIZATION_START_CSP,
  renderMcpAuthorizationStartPage,
} from "./authorization-start-page";

const LINK_COOKIE = "__Host-mcp_link";
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };
interface LinkRequest {
  query: Record<string, string>;
  state: string;
  nonce: string;
  csrf: string;
  profile?: AuthUser;
  googleRefreshToken?: string;
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function client() {
  const config = getMcpAuthConfig();
  return {
    id: config.clientId,
    grants: ["authorization_code", "refresh_token"],
    redirectUris: config.redirectUris,
  };
}
async function userForGrant(grantId: string) {
  const grant = await getMcpGrant(grantId);
  if (
    !grant ||
    grant.revokedAt ||
    grant.clientId !== getMcpAuthConfig().clientId ||
    grant.profile.id !== grant.googleUserId ||
    grant.expiresAt.getTime() <= Date.now()
  )
    return null;
  return { id: grant.googleUserId, grantId: grant.id };
}
export function createMcpOAuthServer() {
  const model: OAuth2Server.AuthorizationCodeModel &
    OAuth2Server.RefreshTokenModel = {
    async getClient(id, secret) {
      return id === client().id && !secret ? client() : null;
    },
    async validateScope(_user, _client, scope) {
      return scope?.length &&
        scope.every((value) => getMcpAuthConfig().scopes.includes(value))
        ? scope
        : false;
    },
    async generateAccessToken(_client, user, scope) {
      return issueMcpAccessToken({
        googleUserId: user.id,
        grantId: user.grantId,
        scopes: scope,
      });
    },
    async saveToken(token, oauthClient, user) {
      const grant = await getMcpGrant(user.grantId);
      if (
        !grant ||
        grant.revokedAt ||
        grant.googleUserId !== user.id ||
        grant.profile.id !== grant.googleUserId ||
        grant.clientId !== getMcpAuthConfig().clientId ||
        grant.clientId !== oauthClient.id ||
        !token.scope?.length ||
        token.scope.some((scope) => !grant.scopes.includes(scope)) ||
        grant.expiresAt.getTime() <= Date.now()
      )
        return false;
      if (token.refreshToken && token.refreshTokenExpiresAt)
        await saveMcpRefreshToken({
          hash: hashMcpSecret(token.refreshToken),
          grantId: user.grantId,
          scopes: token.scope ?? [],
          expiresAt: new Date(
            Math.min(
              token.refreshTokenExpiresAt.getTime(),
              grant.expiresAt.getTime(),
            ),
          ),
        });
      return { ...token, client: oauthClient, user };
    },
    async getAccessToken(accessToken) {
      const principal = await authenticateMcpRequest(
        new Request(getMcpAuthConfig().resource, {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      );
      return {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + MCP_ACCESS_SECONDS * 1000),
        scope: principal.scopes,
        client: client(),
        user: { id: principal.googleUserId, grantId: principal.grantId },
      };
    },
    async saveAuthorizationCode(code, oauthClient, user) {
      if (!code.codeChallenge || code.codeChallengeMethod !== "S256")
        return false;
      await saveMcpAuthorizationCode({
        hash: hashMcpSecret(code.authorizationCode),
        grantId: user.grantId,
        redirectUri: code.redirectUri,
        challenge: code.codeChallenge,
        expiresAt: code.expiresAt,
      });
      return { ...code, client: oauthClient, user };
    },
    async getAuthorizationCode(value) {
      const code = await getMcpAuthorizationCode(hashMcpSecret(value));
      if (!code) return null;
      const user = await userForGrant(code.grant_id);
      if (!user) return null;
      const grant = await getMcpGrant(code.grant_id);
      return {
        authorizationCode: value,
        expiresAt: new Date(code.expires_at),
        redirectUri: code.redirect_uri,
        codeChallenge: code.code_challenge,
        codeChallengeMethod: "S256",
        scope: grant?.scopes,
        client: client(),
        user,
      };
    },
    async revokeAuthorizationCode(code) {
      return consumeMcpAuthorizationCode(hashMcpSecret(code.authorizationCode));
    },
    async getRefreshToken(value) {
      const token = await getMcpRefreshToken(hashMcpSecret(value));
      if (!token) return null;
      if (token.consumed_at) {
        await revokeMcpGrant(token.grant_id);
        return null;
      }
      const user = await userForGrant(token.grant_id);
      if (!user) return null;
      return {
        refreshToken: value,
        refreshTokenExpiresAt: new Date(token.expires_at),
        scope: token.scopes,
        client: client(),
        user,
      };
    },
    async revokeToken(token) {
      const consumed = await consumeMcpRefreshToken(
        hashMcpSecret(token.refreshToken),
      );
      if (!consumed) {
        // A concurrent winner already rotated this credential. Revoke the family
        // so a stolen descendant cannot survive this detected replay.
        const user = token.user;
        if (
          token.client.id === getMcpAuthConfig().clientId &&
          typeof user.grantId === "string" &&
          typeof user.id === "string"
        ) {
          await revokeMcpGrant(user.grantId, user.id);
        }
      }
      return consumed;
    },
  };
  return new OAuth2Server({
    model,
    accessTokenLifetime: MCP_ACCESS_SECONDS,
    refreshTokenLifetime: MCP_GRANT_SECONDS,
    authorizationCodeLifetime: 120,
  });
}
export function validateMcpAuthorizationQuery(query: Record<string, string>) {
  const config = getMcpAuthConfig();
  if (
    query.client_id !== config.clientId ||
    !config.redirectUris.includes(query.redirect_uri)
  )
    throw new Error("invalid_client");
  if (
    query.response_type !== "code" ||
    query.resource !== config.resource ||
    query.code_challenge_method !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge ?? "") ||
    !query.state ||
    query.state.length > 1024
  )
    throw new Error("invalid_request");
  const scopes = (query.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.length || scopes.some((scope) => !config.scopes.includes(scope)))
    throw new Error("invalid_scope");
}
function requestQuery(params: URLSearchParams) {
  if ([...params.keys()].some((key) => params.getAll(key).length > 1))
    throw new Error("invalid_request");
  return Object.fromEntries(params);
}
async function readSmallForm(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded") ||
    Number(request.headers.get("content-length") ?? 0) > 8192
  )
    throw new Error("invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("invalid_request");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return { body: requestQuery(new URLSearchParams(raw)), length: size };
}
function setLinkCookie(response: NextResponse, id: string, maxAge = 600) {
  response.cookies.set(LINK_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  if (!response.headers.has("Cache-Control"))
    response.headers.set("Cache-Control", "no-store");
  return response;
}
async function loadLink(id: string | undefined): Promise<LinkRequest | null> {
  if (!id || !uuidPattern.test(id)) return null;
  const encrypted = await getMcpLinkRequest(id);
  if (!encrypted) return null;
  try {
    return (await decryptMcpSecret(
      encrypted,
      `link:${id}`,
    )) as unknown as LinkRequest;
  } catch {
    return null;
  }
}
export async function getMcpConsentSession() {
  const cookieStore = await cookies();
  const link = await loadLink(cookieStore.get(LINK_COOKIE)?.value);
  if (!link?.profile || !link.googleRefreshToken) return null;
  return {
    profile: link.profile,
    scopes: link.query.scope.split(" ").filter(Boolean),
    csrf: link.csrf,
  };
}
export async function startMcpAuthorization(request: NextRequest) {
  try {
    const query = requestQuery(request.nextUrl.searchParams);
    validateMcpAuthorizationQuery(query);
    await clearExpiredMcpCredentials();
    const id = randomUUID();
    const state = randomUUID();
    const nonce = randomUUID();
    const link: LinkRequest = { query, state, nonce, csrf: randomUUID() };
    await saveMcpLinkRequest(
      id,
      await encryptMcpSecret(
        link as unknown as Record<string, unknown>,
        `link:${id}`,
      ),
    );
    const config = getMcpAuthConfig();
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) throw new Error("server_error");
    const url = new URL(getGoogleAuthUrlBase());
    url.search = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: `${config.issuer}/api/mcp/oauth/google`,
      response_type: "code",
      scope: `${GOOGLE_DRIVE_SCOPE} openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
      access_type: "offline",
      prompt: "consent",
      state,
      nonce,
    }).toString();
    // Copying the original authorization request into another browser creates
    // that browser's own pending cookie while preserving the host's PKCE/state.
    const authorizationUrl = `${config.issuer}/api/mcp/oauth/authorize${request.nextUrl.search}`;
    return setLinkCookie(
      new NextResponse(
        renderMcpAuthorizationStartPage(authorizationUrl, url.toString()),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": AUTHORIZATION_START_CSP,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
          },
        },
      ),
      id,
    );
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: noStore },
    );
  }
}
function callbackRedirect(link: LinkRequest, error?: string) {
  validateMcpAuthorizationQuery(link.query);
  const url = new URL(link.query.redirect_uri);
  url.searchParams.set("state", link.query.state);
  url.searchParams.set("iss", getMcpAuthConfig().issuer);
  if (error) url.searchParams.set("error", error);
  return url;
}
export async function completeMcpGoogleAuthorization(request: NextRequest) {
  const id = request.cookies.get(LINK_COOKIE)?.value;
  const link = await loadLink(id);
  if (!link || !id || request.nextUrl.searchParams.get("state") !== link.state)
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: noStore },
    );
  try {
    if (request.nextUrl.searchParams.has("error")) {
      await consumeMcpLinkRequest(id);
      return setLinkCookie(
        NextResponse.redirect(callbackRedirect(link, "access_denied")),
        "",
        0,
      );
    }
    const code = request.nextUrl.searchParams.get("code");
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret || link.profile)
      throw new Error("invalid_request");
    const response = await exchangeGoogleOAuthCode(
      { clientId, clientSecret },
      code,
      `${getMcpAuthConfig().issuer}/api/mcp/oauth/google`,
    );
    const data = await response.json();
    if (
      !response.ok ||
      !data.id_token ||
      !data.refresh_token ||
      !hasGoogleDriveScope(data.scope)
    )
      throw new Error("access_denied");
    link.profile = await getUserFromIdToken(data.id_token, link.nonce);
    link.googleRefreshToken = data.refresh_token;
    await updateMcpLinkRequest(
      id,
      await encryptMcpSecret(
        link as unknown as Record<string, unknown>,
        `link:${id}`,
      ),
    );
    return NextResponse.redirect(`${getMcpAuthConfig().issuer}/mcp/connect`, {
      headers: noStore,
    });
  } catch {
    await consumeMcpLinkRequest(id);
    return setLinkCookie(
      NextResponse.redirect(callbackRedirect(link, "access_denied")),
      "",
      0,
    );
  }
}
export async function approveMcpAuthorization(request: NextRequest) {
  const config = getMcpAuthConfig();
  if (
    request.headers.get("origin") !== config.issuer ||
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 403, headers: noStore },
    );
  const id = request.cookies.get(LINK_COOKIE)?.value;
  const link = await loadLink(id);
  let form: Record<string, string>;
  try {
    form = (await readSmallForm(request)).body;
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: noStore },
    );
  }
  if (
    !id ||
    !link?.profile ||
    !link.googleRefreshToken ||
    form.csrf !== link.csrf ||
    !["approve", "cancel"].includes(String(form.decision))
  )
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 403, headers: noStore },
    );
  if (!(await consumeMcpLinkRequest(id)))
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 403, headers: noStore },
    );
  if (form.decision === "cancel")
    return setLinkCookie(
      NextResponse.redirect(callbackRedirect(link, "access_denied"), 303),
      "",
      0,
    );
  const grantId = randomUUID();
  await upsertUser(link.profile);
  await createMcpGrant({
    id: grantId,
    googleUserId: link.profile.id,
    profile: link.profile,
    clientId: config.clientId,
    scopes: link.query.scope.split(" ").filter(Boolean),
    encryptedGoogleRefreshToken: await encryptMcpSecret(
      { token: link.googleRefreshToken },
      `google:${grantId}`,
    ),
    expiresAt: new Date(Date.now() + MCP_GRANT_SECONDS * 1000),
  });
  const oauth = createMcpOAuthServer();
  const response = new OAuth2Server.Response();
  try {
    await oauth.authorize(
      new OAuth2Server.Request({
        method: "GET",
        query: link.query,
        headers: {},
      }),
      response,
      {
        authenticateHandler: {
          handle: async () => ({ id: link.profile?.id, grantId }),
        },
        authorizationCodeLifetime: 120,
      },
    );
    const location = new URL(String(response.get("location")));
    location.searchParams.set("iss", config.issuer);
    return setLinkCookie(NextResponse.redirect(location, 303), "", 0);
  } catch {
    await revokeMcpGrant(grantId, link.profile.id);
    return setLinkCookie(
      NextResponse.redirect(callbackRedirect(link, "server_error"), 303),
      "",
      0,
    );
  }
}
export async function exchangeMcpToken(request: NextRequest) {
  try {
    const { body, length } = await readSmallForm(request);
    if (
      body.resource !== getMcpAuthConfig().resource ||
      !["authorization_code", "refresh_token"].includes(body.grant_type)
    )
      throw new Error("invalid_request");
    const response = new OAuth2Server.Response();
    await createMcpOAuthServer().token(
      new OAuth2Server.Request({
        method: "POST",
        query: {},
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(length),
        },
      }),
      response,
      {
        requireClientAuthentication: {
          authorization_code: false,
          refresh_token: false,
        },
        alwaysIssueNewRefreshToken: true,
      },
    );
    return NextResponse.json(response.body, {
      status: response.status,
      headers: noStore,
    });
  } catch {
    return NextResponse.json(
      { error: "invalid_grant" },
      { status: 400, headers: noStore },
    );
  }
}
export async function revokeMcpAuthorization(request: NextRequest) {
  // RFC 7009: invalid/already revoked tokens also succeed, avoiding a token oracle.
  try {
    if (request.headers.has("authorization")) {
      const principal = await authenticateMcpRequest(request);
      await revokeMcpGrant(principal.grantId, principal.googleUserId);
    } else {
      const { body } = await readSmallForm(request);
      if (body.client_id !== getMcpAuthConfig().clientId)
        return NextResponse.json(
          { error: "invalid_client" },
          { status: 400, headers: noStore },
        );
      if (body.token) {
        const refresh = await getMcpRefreshToken(hashMcpSecret(body.token));
        if (refresh) await revokeMcpGrant(refresh.grant_id);
        else {
          try {
            const principal = await authenticateMcpRequest(
              new Request(getMcpAuthConfig().resource, {
                headers: { authorization: `Bearer ${body.token}` },
              }),
            );
            await revokeMcpGrant(principal.grantId, principal.googleUserId);
          } catch {}
        }
      }
    }
    return NextResponse.json({ revoked: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ revoked: true }, { headers: noStore });
  }
}
