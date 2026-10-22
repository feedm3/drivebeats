import { describe, expect, it } from "vitest";
import { googleDriveReadError } from "./drive-read-error";
import { DriveDeferredError } from "./drive-request-scheduler";
import { getPlaybackFailure } from "./playback-failure";

describe("playback scheduling failures", () => {
  it("retains the shared provider cooldown and retryability", () => {
    expect(
      getPlaybackFailure(new DriveDeferredError("rate_limited", 120_000)),
    ).toMatchObject({
      code: "drive_rate_limited",
      retryable: true,
      retryAfterMs: 120_000,
    });
  });
  it("reports a full queue as temporary contention", () => {
    expect(getPlaybackFailure(new DriveDeferredError("busy"))).toMatchObject({
      code: "drive_busy",
      retryable: true,
      retryAfterMs: 500,
    });
  });
  it("keeps a sanitized quota 403 retryable and preserves a long provider delay", () => {
    const error = googleDriveReadError(
      new Response(null, {
        status: 403,
        headers: { "X-DriveBeats-Rate-Limited": "true", "Retry-After": "600" },
      }),
    );
    expect(getPlaybackFailure(error)).toMatchObject({
      code: "drive_rate_limited",
      retryAfterMs: 600_000,
      retryable: true,
    });
    expect(
      getPlaybackFailure(
        googleDriveReadError(new Response(null, { status: 403 })),
      ),
    ).toMatchObject({ code: "drive_access_denied" });
  });
});
