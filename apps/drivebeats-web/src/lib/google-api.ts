import {
  type DriveRequestOptions,
  scheduleDriveRequest,
} from "@/lib/drive-request-scheduler";
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
  incompleteSearch?: boolean;
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

function waitForDriveReadRetry(delay: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchGoogleDriveRead(
  url: string,
  accessToken: string,
  signal?: AbortSignal,
  options: DriveRequestOptions = {},
  headers?: Record<string, string>,
) {
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let response: Response | undefined;
    let delay = 200 * 2 ** attempt;
    try {
      response = await scheduleDriveRequest(
        (scheduledSignal) =>
          fetch(url, {
            headers: { ...getGoogleAuthHeaders(accessToken), ...headers },
            signal: scheduledSignal,
          }),
        {
          ...options,
          get budget() {
            return options.budget;
          },
          signal: signal ?? options.signal,
        },
      );
      if (
        ![429, 500, 502, 503, 504].includes(response.status) ||
        attempt >= maxAttempts - 1
      )
        return response;
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const requestedDelay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        // Leave longer rate limits to the caller instead of holding a tool
        // request open or retrying sooner than Google asks.
        if (!Number.isFinite(requestedDelay) || requestedDelay > 1000)
          return response;
        delay = Math.max(delay, requestedDelay);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !(error instanceof TypeError) ||
        attempt >= maxAttempts - 1 ||
        (typeof navigator !== "undefined" && navigator.onLine === false)
      )
        throw error;
    }
    if (response?.body) await response.body.cancel().catch(() => {});
    await waitForDriveReadRetry(delay, signal);
  }
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
  signal?: AbortSignal,
) {
  return fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal,
    redirect: "error",
    cache: "no-store",
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
  signal?: AbortSignal,
  options?: DriveRequestOptions,
) {
  const searchParams =
    params instanceof URLSearchParams ? params : new URLSearchParams(params);

  return fetchGoogleDriveRead(
    `${GOOGLE_DRIVE_FILES_URL}?${searchParams.toString()}`,
    accessToken,
    signal,
    options,
  );
}

export async function getGoogleDriveFileMetadata(
  fileId: string,
  accessToken: string,
  params: URLSearchParams | Record<string, string>,
  options?: DriveRequestOptions,
) {
  return fetchGoogleDriveRead(
    getGoogleDriveFileUrl(fileId, params),
    accessToken,
    options?.signal,
    options,
  );
}

export async function downloadGoogleDriveFileMedia(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal,
  options?: DriveRequestOptions,
) {
  return fetchGoogleDriveRead(
    getGoogleDriveFileUrl(fileId, {
      alt: "media",
      supportsAllDrives: "true",
    }),
    accessToken,
    signal,
    options,
  );
}

/** Authenticated sparse read. Header/body validation remains the reader's responsibility. */
export async function readGoogleDriveFileRange(
  fileId: string,
  _accessToken: string,
  start: number,
  end: number,
  signal?: AbortSignal,
  options?: DriveRequestOptions & { fileSize?: number },
) {
  return scheduleDriveRequest(
    (scheduledSignal) =>
      fetch("/api/auth/drive-range", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: options?.accountId,
          fileId,
          start,
          end,
          size: options?.fileSize,
        }),
        signal: scheduledSignal,
        cache: "no-store",
      }),
    {
      ...options,
      cooldownScope: "metadata",
      signal,
      maxAttempts: options?.maxAttempts ?? 1,
      maxBytes: Math.min(options?.maxBytes ?? end - start + 1, end - start + 1),
    },
  );
}
