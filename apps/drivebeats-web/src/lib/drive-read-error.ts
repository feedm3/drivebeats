export class GoogleDriveReadError extends Error {
  constructor(
    public readonly status: number,
    message = `Google Drive read failed (${status})`,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GoogleDriveReadError";
  }
}

export class LibraryIncompleteError extends Error {
  constructor() {
    super("Google Drive returned an incomplete Library Search");
    this.name = "LibraryIncompleteError";
  }
}

export function googleDriveReadError(response: Response) {
  const status =
    response.headers?.get("X-DriveBeats-Rate-Limited") === "true"
      ? 429
      : response.status;
  const retryAfter = response.headers?.get("Retry-After");
  const seconds = Number(retryAfter);
  const retryAfterMs = retryAfter
    ? Math.max(
        0,
        Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now(),
      )
    : 0;
  return new GoogleDriveReadError(
    status,
    undefined,
    Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
  );
}

export interface DriveReadFailure {
  code: "drive_rate_limited" | "drive_busy";
  message: string;
  retryable: true;
  retryAfterMs: number;
}
/** A pure mapping shared by navigation and playback, without importing browser coordination. */
export function getDriveReadFailure(error: unknown): DriveReadFailure | null {
  if (!error || typeof error !== "object") return null;
  const deferred =
    "name" in error && error.name === "DriveDeferredError" && "reason" in error
      ? error.reason
      : undefined;
  const rateLimited =
    deferred === "rate_limited" ||
    (error instanceof GoogleDriveReadError && error.status === 429);
  if (!rateLimited && deferred !== "busy") return null;
  const delay =
    "retryAfterMs" in error &&
    typeof error.retryAfterMs === "number" &&
    Number.isFinite(error.retryAfterMs)
      ? Math.max(0, error.retryAfterMs)
      : 0;
  return {
    code: rateLimited ? "drive_rate_limited" : "drive_busy",
    message: rateLimited
      ? "Google Drive is receiving too many requests. Wait a moment, then try again."
      : "DriveBeats is busy. Try again shortly.",
    retryable: true,
    retryAfterMs: rateLimited ? delay : Math.max(500, delay),
  };
}
