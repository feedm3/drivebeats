import { hasGoogleDriveScope } from "@/lib/google";
import { GOOGLE_APIS, refreshGoogleOAuthAccessToken } from "@/lib/google-api";

export const MAX_METADATA_RANGE_BYTES = 1024 * 1024;
export const METADATA_RANGE_TIMEOUT_MS = 12_000;
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export interface MetadataRangeInput {
  accountId: string;
  fileId: string;
  start: number;
  end: number;
  size: number;
}

class RangeServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502,
  ) {
    super(code);
  }
}
export function rangeError(
  code: string,
  status: number,
  retryAfter?: string | null,
  rateLimited = false,
) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-DriveBeats-Range-Error": code,
  });
  if (
    retryAfter &&
    retryAfter.length <= 128 &&
    (/^\d+(?:\.\d+)?$/.test(retryAfter) ||
      Number.isFinite(Date.parse(retryAfter)))
  )
    headers.set("Retry-After", retryAfter);
  if (rateLimited) headers.set("X-DriveBeats-Rate-Limited", "true");
  return new Response(JSON.stringify({ error: { code } }), { status, headers });
}

function metadataProviderError(
  code: string,
  status: number,
  retryAfter?: string | null,
  rateLimited = false,
) {
  const response = rangeError(code, status, retryAfter, rateLimited);
  response.headers.set("X-DriveBeats-Cooldown-Scope", "metadata");
  return response;
}

function driveProviderError(
  code: string,
  status: number,
  retryAfter?: string | null,
  rateLimited = false,
) {
  const response = rangeError(code, status, retryAfter, rateLimited);
  response.headers.set("X-DriveBeats-Cooldown-Scope", "drive");
  return response;
}

/** Bounds body consumption and cancellation, including a response stalled after headers. */
export async function readBoundedRangeBody(
  response: { body: ReadableStream<Uint8Array> | null },
  limit: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw new RangeServiceError("body_too_large", 413);
      chunks.push(part.value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    // Do not let a provider's cancellation acknowledgement extend the deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function boundedJson(response: Response, signal: AbortSignal) {
  const bytes = await readBoundedRangeBody(response, 16 * 1024, signal);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new RangeServiceError("provider_invalid_response");
  }
}

/** One media GET; refresh/userinfo are separate bounded OAuth reads, without durable token caching. */
export async function readDriveMetadataRange(
  input: MetadataRangeInput,
  refreshToken: string,
  callerSignal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(callerSignal.reason);
  callerSignal.addEventListener("abort", abort, { once: true });
  if (callerSignal.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Range deadline", "TimeoutError")),
    METADATA_RANGE_TIMEOUT_MS,
  );
  const signal = controller.signal;
  try {
    signal.throwIfAborted();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      return rangeError("service_unavailable", 503);
    const tokenResponse = await refreshGoogleOAuthAccessToken(
      { clientId, clientSecret },
      refreshToken,
      signal,
    );
    if (tokenResponse.status === 429) {
      void tokenResponse.body?.cancel().catch(() => {});
      const limited = metadataProviderError(
        "rate_limited",
        429,
        tokenResponse.headers.get("Retry-After"),
        true,
      );
      return limited;
    }
    const token = await boundedJson(tokenResponse, signal);
    if (!tokenResponse.ok || token.error) {
      return metadataProviderError(
        token.error === "invalid_grant"
          ? "sign_in_required"
          : "auth_unavailable",
        token.error === "invalid_grant" ? 401 : 503,
        tokenResponse.headers.get("Retry-After"),
      );
    }
    if (
      typeof token.access_token !== "string" ||
      !token.access_token ||
      (typeof token.scope === "string" && !hasGoogleDriveScope(token.scope))
    )
      return rangeError("sign_in_required", 401);
    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!userResponse.ok) {
      void userResponse.body?.cancel().catch(() => {});
      if (userResponse.status === 429) {
        const limited = metadataProviderError(
          "rate_limited",
          429,
          userResponse.headers.get("Retry-After"),
          true,
        );
        return limited;
      }
      return metadataProviderError(
        userResponse.status === 401 || userResponse.status === 403
          ? "sign_in_required"
          : "auth_unavailable",
        userResponse.status === 401 || userResponse.status === 403 ? 401 : 503,
        userResponse.headers.get("Retry-After"),
      );
    }
    const user = await boundedJson(userResponse, signal);
    if (user.sub !== input.accountId) return rangeError("account_changed", 401);
    const url = new URL(
      `${GOOGLE_APIS.driveFilesUrl}/${encodeURIComponent(input.fileId)}`,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Range: `bytes=${input.start}-${input.end}`,
      },
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (response.status !== 206) {
      if (response.status === 403) {
        const error = await boundedJson(response, signal).catch(() => ({}));
        signal.throwIfAborted();
        const quota =
          /userRateLimitExceeded|rateLimitExceeded|downloadQuotaExceeded|dailyLimitExceeded|quotaExceeded/.test(
            JSON.stringify(error),
          );
        return driveProviderError(
          quota ? "rate_limited" : "permission_denied",
          403,
          response.headers.get("Retry-After"),
          quota,
        );
      }
      void response.body?.cancel().catch(() => {});
      if ([401, 404, 416, 429].includes(response.status))
        return driveProviderError(
          response.status === 429
            ? "rate_limited"
            : response.status === 401
              ? "sign_in_required"
              : response.status === 404
                ? "not_found"
                : "version_changed",
          response.status,
          response.headers.get("Retry-After"),
          response.status === 429,
        );
      if (response.status >= 500)
        return driveProviderError(
          "provider_unavailable",
          503,
          response.headers.get("Retry-After"),
        );
      return rangeError("range_unsupported", 422);
    }
    const length = input.end - input.start + 1;
    const expected = `bytes ${input.start}-${input.end}/${input.size}`;
    const declared = response.headers.get("Content-Length");
    const contentRange = response.headers.get("Content-Range");
    const parts = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (
      parts &&
      Number(parts[1]) === input.start &&
      (Number(parts[2]) === input.end ||
        (Number(parts[2]) === Number(parts[3]) - 1 &&
          Number(parts[2]) < input.end)) &&
      Number.isSafeInteger(Number(parts[3])) &&
      Number(parts[2]) >= input.start &&
      Number(parts[3]) > Number(parts[2]) &&
      Number(parts[3]) !== input.size
    ) {
      void response.body?.cancel().catch(() => {});
      return rangeError("version_changed", 416);
    }
    if (
      contentRange !== expected ||
      (declared !== null && Number(declared) !== length)
    ) {
      void response.body?.cancel().catch(() => {});
      return rangeError("range_unsupported", 422);
    }
    const bytes = await readBoundedRangeBody(response, length, signal);
    if (bytes.byteLength !== length) return rangeError("incomplete_range", 502);
    return new Response(bytes, {
      status: 206,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/octet-stream",
        "Content-Range": expected,
        "Content-Length": String(length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (signal.aborted) return rangeError("timeout", 504);
    return rangeError(
      error instanceof RangeServiceError ? error.code : "provider_unavailable",
      error instanceof RangeServiceError ? error.status : 502,
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    callerSignal.removeEventListener("abort", abort);
  }
}
