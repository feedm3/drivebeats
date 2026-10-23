import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertAppDataIdentity } from "@/db/appdata-control";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import {
  MAX_METADATA_RANGE_BYTES,
  rangeError,
  readBoundedRangeBody,
  readDriveMetadataRange,
} from "@/lib/drive-metadata-range-service";
import { hasRequiredGoogleScopes } from "@/lib/google";

const inputSchema = z
  .object({
    accountId: z.string().min(1).max(512),
    fileId: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-zA-Z0-9_-]+$/),
    start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    end: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    size: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(
    (input) =>
      input.end >= input.start &&
      input.end < input.size &&
      input.end - input.start + 1 <= MAX_METADATA_RANGE_BYTES,
  );

export async function POST(request: NextRequest) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    origin !== request.nextUrl.origin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  )
    return rangeError("invalid_origin", 403);
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return rangeError("invalid_input", 415);
  const session = parseAuthSession(
    request.cookies.get(AUTH_SESSION_COOKIE)?.value,
  );
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (
    !session ||
    !hasRequiredGoogleScopes(session.grantedScopes) ||
    !refreshToken ||
    !session.accountGeneration
  )
    return rangeError("sign_in_required", 401);
  try {
    const account = await assertAppDataIdentity({
      accountId: session.user.id,
      generation: session.accountGeneration,
    });
    if (account.state !== "active" || account.source !== "drive")
      return rangeError("appdata_not_ready", 409);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (
      code === "appdata_stale_session" ||
      code === "appdata_deletion_in_progress"
    )
      return rangeError("sign_in_required", 401);
    return rangeError("auth_unavailable", 503);
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const body = await readBoundedRangeBody(request, 4096, signal);
    const parsed = inputSchema.safeParse(
      JSON.parse(new TextDecoder().decode(body)),
    );
    if (!parsed.success) return rangeError("invalid_input", 400);
    if (parsed.data.accountId !== session.user.id)
      return rangeError("account_changed", 401);
    return await readDriveMetadataRange(parsed.data, refreshToken, signal);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 413)
      return rangeError("body_too_large", 413);
    return rangeError(
      signal.aborted ? "timeout" : "invalid_input",
      signal.aborted ? 504 : 400,
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
