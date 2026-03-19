import type { DriveFile } from "@/types";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

export const GOOGLE_APIS = {
  authUrl: GOOGLE_AUTH_URL,
  driveFilesUrl: GOOGLE_DRIVE_FILES_URL,
  jwksUrl: GOOGLE_JWKS_URL,
  tokenUrl: GOOGLE_TOKEN_URL,
} as const;

export interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleJwk {
  alg?: string;
  e: string;
  kid: string;
  kty: string;
  n: string;
  use?: string;
}

export interface GoogleJwksResponse {
  keys?: GoogleJwk[];
}

export interface GoogleDriveFileMetadataResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
}

export interface GoogleDriveFilesListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface GoogleOAuthTokenRequest {
  clientId: string;
  clientSecret: string;
}

function getGoogleAuthHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function getGoogleDriveFileUrl(
  fileId: string,
  params: URLSearchParams | Record<string, string>,
) {
  const searchParams =
    params instanceof URLSearchParams ? params : new URLSearchParams(params);

  return `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${searchParams.toString()}`;
}

export function getGoogleAuthUrlBase() {
  return GOOGLE_AUTH_URL;
}

export async function fetchGoogleSigningKeys() {
  return fetch(GOOGLE_JWKS_URL);
}

export async function exchangeGoogleOAuthCode(
  { clientId, clientSecret }: GoogleOAuthTokenRequest,
  code: string,
  redirectUri: string,
) {
  return fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
}

export async function refreshGoogleOAuthAccessToken(
  { clientId, clientSecret }: GoogleOAuthTokenRequest,
  refreshToken: string,
) {
  return fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
}

export async function listGoogleDriveFiles(
  accessToken: string,
  params: URLSearchParams | Record<string, string>,
) {
  const searchParams =
    params instanceof URLSearchParams ? params : new URLSearchParams(params);

  return fetch(`${GOOGLE_DRIVE_FILES_URL}?${searchParams.toString()}`, {
    headers: getGoogleAuthHeaders(accessToken),
  });
}

export async function getGoogleDriveFileMetadata(
  fileId: string,
  accessToken: string,
  params: URLSearchParams | Record<string, string>,
) {
  return fetch(getGoogleDriveFileUrl(fileId, params), {
    headers: getGoogleAuthHeaders(accessToken),
  });
}

export async function downloadGoogleDriveFileMedia(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return fetch(
    getGoogleDriveFileUrl(fileId, {
      alt: "media",
      supportsAllDrives: "true",
    }),
    {
      headers: getGoogleAuthHeaders(accessToken),
      signal,
    },
  );
}
