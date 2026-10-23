import { NextResponse } from "next/server";
import { CollectionCommandError } from "@/lib/collection-commands";

export const appDataHeaders = { "Cache-Control": "private, no-store" };

export function withAppDataErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return appDataFailure(error);
    }
  };
}

export function appDataFailure(error: unknown) {
  if (error instanceof CollectionCommandError)
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.resumeOperationId
          ? { resumeOperationId: error.resumeOperationId }
          : {}),
      },
      { status: error.status, headers: appDataHeaders },
    );
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^appdata_[a-z_]+$/.test(error.code)
      ? error.code
      : "appdata_unavailable";
  const status =
    code === "appdata_request_too_large"
      ? 413
      : /conflict|busy|pending|in_progress/.test(code)
        ? 409
        : /consent|scope|stale_session|access_required/.test(code)
          ? 403
          : /invalid|too_large/.test(code)
            ? 400
            : 503;
  return NextResponse.json(
    {
      error:
        "Your Google Drive backup is not ready. Retry or reconnect Google.",
      code,
    },
    { status, headers: appDataHeaders },
  );
}
