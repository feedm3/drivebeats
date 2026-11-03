import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnownTrack } from "@/lib/known-track-resolver";
import type { MetadataOutcome } from "@/lib/metadata-cache-types";

const mocks = vi.hoisted(() => ({
  current: true,
  records: new Map<
    string,
    MetadataOutcome & { fingerprint: string; checkedAt: number }
  >(),
  blob: vi.fn(),
  extract: vi.fn(),
  range: vi.fn(),
  descriptor: vi.fn(),
  media: vi.fn(),
  put: vi.fn(),
  generation: 1,
  retryRecord: vi.fn(),
  token: vi.fn(),
  refresh: vi.fn(),
  peek: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => ({
      user: { id: "a" },
      authStatus: "authenticated",
      getValidAccessToken: mocks.token,
      refreshAccessToken: mocks.refresh,
    }),
    subscribe: vi.fn(),
  },
}));
vi.mock("@/stores/player-store", () => ({
  getAvailablePlaybackBlob: mocks.blob,
}));
vi.mock("@/lib/id3-metadata", () => ({
  extractId3MetadataResult: mocks.extract,
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: mocks.descriptor,
  readGoogleDriveFileRange: mocks.media,
}));
vi.mock("@/lib/drive-metadata-reader", async (original) => ({
  ...(await original<typeof import("@/lib/drive-metadata-reader")>()),
  readDriveTrackMetadata: mocks.range,
}));
vi.mock("@/lib/known-track-resolver", () => ({
  assertKnownTrack: () => mocks.current,
  updateKnownTrackDescriptor: (
    known: KnownTrack,
    descriptor: KnownTrack["track"],
  ) => {
    known.track = descriptor;
    return mocks.current;
  },
}));
vi.mock("@/stores/id3-metadata-store", () => {
  const getRecord = (track: KnownTrack["track"]) => {
    const record = mocks.records.get(track.id);
    return {
      record,
      freshness: !record
        ? "unknown"
        : record.fingerprint ===
            JSON.stringify([track.modifiedTime, track.size])
          ? "current"
          : "stale",
    };
  };
  return {
    useId3MetadataStore: {
      getState: () => ({
        authStatus: "authenticated",
        accountId: "a",
        generation: mocks.generation,
        setAccount: async () => {},
        getRecord,
        peekRecord: async (track: KnownTrack["track"]) => {
          await mocks.peek();
          return getRecord(track);
        },
        retryUnavailableRecord: mocks.retryRecord,
        observeDescriptor: vi.fn(),
        loadRecord: async (track: KnownTrack["track"]) => getRecord(track),
        putRecord: async (
          track: KnownTrack["track"],
          outcome: MetadataOutcome,
          generation: number,
        ) => {
          mocks.put(track, outcome, generation);
          if (generation !== mocks.generation) return false;
          mocks.records.set(track.id, {
            ...outcome,
            fingerprint: JSON.stringify([track.modifiedTime, track.size]),
            checkedAt: Date.now(),
          });
          return true;
        },
      }),
    },
  };
});
const track = {
  id: "track",
  name: "track.mp3",
  mimeType: "audio/mpeg",
  modifiedTime: "v1",
  size: "5000",
};
const known = (): KnownTrack => ({
  accountId: "a",
  track: { ...track },
  originalMimeType: "audio/mpeg",
  scopeKey: "scope",
  source: "catalog",
});
const blobSource = () => ({
  accountId: "a",
  fileId: track.id,
  modifiedTime: track.modifiedTime,
  size: track.size,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.current = true;
  mocks.records.clear();
  mocks.generation = 1;
  mocks.token.mockResolvedValue("token");
  mocks.refresh.mockResolvedValue(true);
  mocks.peek.mockResolvedValue(undefined);
  mocks.retryRecord.mockImplementation(async (track: KnownTrack["track"]) => {
    mocks.records.delete(track.id);
  });
  mocks.blob.mockResolvedValue(null);
  mocks.extract.mockResolvedValue({
    status: "ready",
    tags: { title: "Local" },
    loadedVia: "local_blob",
  });
  mocks.range.mockResolvedValue({
    status: "ready",
    tags: { title: "Remote" },
    loadedVia: "drive_range",
  });
  mocks.descriptor.mockImplementation(
    async () => new Response(JSON.stringify(track)),
  );
});

describe("shared metadata consumer boundary", () => {
  it.each([
    { modifiedTime: "old-version" },
    { accountId: "other-account" },
    { fileId: "other-track" },
    { size: "4999" },
  ])(
    "never adopts an incorrectly bound playback Blob: %j",
    async (difference) => {
      const { ensureTrackMetadataFromBlob } = await import(
        "./track-metadata-loader"
      );
      const source = {
        accountId: "a",
        fileId: track.id,
        modifiedTime: track.modifiedTime,
        size: track.size,
        ...difference,
      };
      const result = await ensureTrackMetadataFromBlob(
        known(),
        new Blob([new Uint8Array(5000)]),
        source,
        { priority: "navigation" },
      );
      expect(result.metadata.tags).toEqual({ title: "Remote" });
      expect(mocks.extract).not.toHaveBeenCalled();
      expect(mocks.range).toHaveBeenCalledOnce();
      expect(mocks.put).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tags: { title: "Remote" } }),
        1,
      );
    },
  );

  it("does not accept a truncated Blob even when its supplied descriptor matches", async () => {
    const { ensureTrackMetadataFromBlob } = await import(
      "./track-metadata-loader"
    );
    const result = await ensureTrackMetadataFromBlob(
      known(),
      new Blob(["short"]),
      {
        accountId: "a",
        fileId: track.id,
        modifiedTime: track.modifiedTime,
        size: track.size,
      },
      { priority: "navigation" },
    );
    expect(result.metadata.tags).toEqual({ title: "Remote" });
    expect(mocks.extract).not.toHaveBeenCalled();
  });
  it("finishes a bounded reader limit without retrying the unchanged track after reload", async () => {
    const { MetadataReadError } = await import("./drive-metadata-reader");
    mocks.range.mockRejectedValueOnce(new MetadataReadError("budget_exceeded"));
    let { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: {
        status: "unresolved",
        reason: "budget_exceeded",
        error: { retryable: false },
      },
    });
    vi.resetModules();
    ({ ensureTrackMetadata } = await import("./track-metadata-loader"));
    await ensureTrackMetadata(known());
    expect(mocks.range).toHaveBeenCalledOnce();
  });

  it.each(["transport_error", "version_unknown", "version_changed"])(
    "allows one short %s retry across reloads, then finishes until content changes",
    async (code) => {
      const { MetadataReadError } = await import("./drive-metadata-reader");
      mocks.range.mockRejectedValue(new MetadataReadError(code, true));
      let { ensureTrackMetadata } = await import("./track-metadata-loader");
      await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
        metadata: {
          status: "deferred",
          error: { code, retryable: true },
        },
      });
      const checkedAt = Number(mocks.records.get(track.id)?.checkedAt);
      expect(mocks.records.get(track.id)?.retryCount).toBe(1);
      vi.resetModules();
      ({ ensureTrackMetadata } = await import("./track-metadata-loader"));
      await ensureTrackMetadata(known());
      expect(mocks.range).toHaveBeenCalledOnce();
      const clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt + 30_000);
      try {
        await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
          metadata: {
            status: "unresolved",
            reason: code,
            error: { retryable: false },
          },
        });
        expect(mocks.range).toHaveBeenCalledTimes(2);
        vi.resetModules();
        ({ ensureTrackMetadata } = await import("./track-metadata-loader"));
        clock.mockReturnValue(checkedAt + 24 * 60 * 60_000);
        await ensureTrackMetadata(known());
        expect(mocks.range).toHaveBeenCalledTimes(2);
        mocks.range.mockResolvedValue({
          status: "ready",
          tags: { title: "New version" },
          loadedVia: "drive_range",
        });
        const updated = known();
        updated.track.modifiedTime = "v2";
        mocks.descriptor.mockResolvedValue(Response.json(updated.track));
        await expect(ensureTrackMetadata(updated)).resolves.toMatchObject({
          metadata: { status: "ready" },
        });
        expect(mocks.range).toHaveBeenCalledTimes(3);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("only retries an explicitly requested unavailable track and preserves successful hits", async () => {
    const { MetadataReadError } = await import("./drive-metadata-reader");
    mocks.range.mockRejectedValueOnce(new MetadataReadError("parse_error"));
    const { ensureTrackMetadata, retryUnavailableTrackMetadata } = await import(
      "./track-metadata-loader"
    );
    await ensureTrackMetadata(known());
    await ensureTrackMetadata(known());
    expect(mocks.range).toHaveBeenCalledOnce();
    await retryUnavailableTrackMetadata(known());
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: { status: "ready" },
    });
    expect(mocks.range).toHaveBeenCalledTimes(2);
    await retryUnavailableTrackMetadata(known());
    await ensureTrackMetadata(known());
    expect(mocks.retryRecord).toHaveBeenCalledOnce();
    expect(mocks.range).toHaveBeenCalledTimes(2);
  });

  it("reserves the post-read version check after consuming the full permitted media byte allowance", async () => {
    const { scheduleDriveRequest } = await import("./drive-request-scheduler");
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const descriptor = {
      ...track,
      id: "full-boundary",
      size: String(2 * 1024 * 1024),
    };
    const current = { ...known(), track: descriptor };
    mocks.descriptor.mockImplementation(
      async (_id, _token, _params, requestOptions) =>
        scheduleDriveRequest(
          async () => Response.json(descriptor),
          requestOptions,
        ),
    );
    mocks.range.mockImplementation(async ({ requestOptions }) => {
      for (const length of [16, 128, 1024 * 1024 - 144]) {
        const response = await scheduleDriveRequest(
          async () => new Response(new Uint8Array(length), { status: 206 }),
          { ...requestOptions, maxBytes: length },
        );
        await response.arrayBuffer();
      }
      return {
        status: "ready",
        tags: { title: "At the full media boundary" },
        loadedVia: "drive_range",
      };
    });
    await expect(
      ensureTrackMetadata(current, { priority: "navigation" }),
    ).resolves.toMatchObject({
      metadata: {
        status: "ready",
        tags: { title: "At the full media boundary" },
      },
      loadedNow: true,
    });
    expect(mocks.descriptor).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledOnce();
  });

  it("reconsiders a saved reader limit when the file version changes", async () => {
    mocks.records.set(track.id, {
      status: "unresolved",
      reason: "budget_exceeded",
      loadedVia: "drive_range",
      fingerprint: JSON.stringify(["old-version", track.size]),
      checkedAt: Date.now(),
      retryCount: 7,
    });
    const { MetadataReadError } = await import("./drive-metadata-reader");
    mocks.range.mockRejectedValueOnce(new MetadataReadError("budget_exceeded"));
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: {
        status: "unresolved",
        reason: "budget_exceeded",
      },
    });
    expect(mocks.range).toHaveBeenCalledOnce();
    expect(mocks.records.get(track.id)?.retryCount).toBeUndefined();
  });

  it("keeps saved terminal outcomes discovered after strengthening an incomplete descriptor", async () => {
    mocks.records.set(track.id, {
      status: "unresolved",
      reason: "budget_exceeded",
      loadedVia: "drive_range",
      fingerprint: JSON.stringify([track.modifiedTime, track.size]),
      checkedAt: Date.now(),
      retryCount: 3,
    });
    const incomplete = known();
    incomplete.track = {
      ...incomplete.track,
      modifiedTime: undefined,
      size: undefined,
    };
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(incomplete)).resolves.toMatchObject({
      metadata: { status: "unresolved", error: { retryable: false } },
    });
    expect(mocks.descriptor).toHaveBeenCalledOnce();
    expect(mocks.range).not.toHaveBeenCalled();
  });

  it("keeps a caller's exhausted batch allowance retryable instead of persisting a per-track failure", async () => {
    const { scheduleDriveRequest, createDriveRequestBudget } = await import(
      "./drive-request-scheduler"
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    mocks.descriptor.mockImplementation(
      async (_id, _token, _params, requestOptions) =>
        scheduleDriveRequest(async () => Response.json(track), requestOptions),
    );
    const transport = vi.fn(
      async () => new Response(new Uint8Array(16), { status: 206 }),
    );
    mocks.range.mockImplementation(async ({ requestOptions }) => {
      const response = await scheduleDriveRequest(transport, {
        ...requestOptions,
        maxBytes: 16,
      });
      await response.arrayBuffer();
      return {
        status: "ready",
        tags: { title: "Should not publish" },
        loadedVia: "drive_range",
      };
    });
    const budget = createDriveRequestBudget({
      maxRequests: 1,
      maxBytes: 2 * 1024 * 1024,
    });
    await expect(
      ensureTrackMetadata(known(), { priority: "navigation", budget }),
    ).resolves.toMatchObject({
      metadata: {
        status: "deferred",
        error: {
          code: "budget_exceeded",
          budgetScope: "consumer",
          retryable: true,
        },
      },
      loadedNow: false,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.records.size).toBe(0);
  });

  it("lets already available playback audio resolve a prior remote terminal outcome", async () => {
    mocks.records.set(track.id, {
      status: "unresolved",
      reason: "budget_exceeded",
      loadedVia: "drive_range",
      fingerprint: JSON.stringify([track.modifiedTime, track.size]),
      checkedAt: Date.now(),
    });
    const { ensureTrackMetadataFromBlob } = await import(
      "./track-metadata-loader"
    );
    await expect(
      ensureTrackMetadataFromBlob(
        known(),
        new Blob([new Uint8Array(5000)]),
        blobSource(),
      ),
    ).resolves.toMatchObject({
      metadata: {
        status: "ready",
        loadedVia: "local_blob",
        tags: { title: "Local" },
      },
    });
    expect(mocks.descriptor).not.toHaveBeenCalled();
  });
  it("finishes access failures without an automatic per-track retry", async () => {
    mocks.descriptor.mockImplementation(
      async () => new Response(null, { status: 403 }),
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: {
        status: "unresolved",
        error: {
          code: "permission_denied",
          retryable: false,
        },
      },
    });
    await ensureTrackMetadata(known());
    expect(mocks.descriptor).toHaveBeenCalledOnce();
  });
  it("rejects an unproven ID before any descriptor, audio or cache write", async () => {
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    mocks.current = false;
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: { status: "unavailable" },
    });
    expect(mocks.blob).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("shares an extraction between a visible row and playback's existing Blob without Drive reads", async () => {
    const local = new Blob([new Uint8Array(5000)]);
    const extraction = deferred<MetadataOutcome>();
    mocks.extract.mockReturnValue(extraction.promise);
    const { ensureTrackMetadataFromBlob, ensureTrackMetadata } = await import(
      "./track-metadata-loader"
    );
    const first = ensureTrackMetadata(known());
    const second = ensureTrackMetadataFromBlob(known(), local, blobSource());
    await vi.waitFor(() => expect(mocks.extract).toHaveBeenCalledOnce());
    extraction.resolve({
      status: "ready",
      tags: { title: "From audio" },
      loadedVia: "local_blob",
    });
    expect((await first).metadata.tags?.title).toBe("From audio");
    expect((await second).metadata.tags?.title).toBe("From audio");
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
    expect(mocks.put).toHaveBeenCalledOnce();
  });
  it("detaches one cancelled consumer while another keeps the shared read alive", async () => {
    const reading = deferred<MetadataOutcome>();
    mocks.range.mockReturnValue(reading.promise);
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const controller = new AbortController();
    const first = ensureTrackMetadata(known(), { signal: controller.signal });
    const cancelled = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = ensureTrackMetadata(known());
    await vi.waitFor(() => expect(mocks.range).toHaveBeenCalledOnce());
    controller.abort();
    await cancelled;
    expect(mocks.range.mock.calls[0][0].signal.aborted).toBe(false);
    reading.resolve({ status: "no_target_tags", loadedVia: "drive_range" });
    await expect(second).resolves.toMatchObject({
      metadata: { status: "no_target_tags", freshness: "current" },
    });
  });
  it("copies source identity before asynchronous extraction and rejects a changed proof before publication", async () => {
    const extraction = deferred<MetadataOutcome>();
    mocks.extract.mockReturnValue(extraction.promise);
    const { ensureTrackMetadataFromBlob } = await import(
      "./track-metadata-loader"
    );
    const source = blobSource();
    const job = ensureTrackMetadataFromBlob(
      known(),
      new Blob([new Uint8Array(5000)]),
      source,
    );
    source.modifiedTime = "mutated-after-call";
    await vi.waitFor(() => expect(mocks.extract).toHaveBeenCalledOnce());
    mocks.current = false;
    extraction.resolve({
      status: "ready",
      tags: { title: "Old audio" },
      loadedVia: "local_blob",
    });
    await expect(job).resolves.toMatchObject({
      metadata: { status: "unavailable" },
    });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
  });
  it("does not charge a token wait after a descriptor request was granted", async () => {
    const item = known();
    item.track.modifiedTime = undefined;
    item.track.size = undefined;
    mocks.token
      .mockResolvedValueOnce("token")
      .mockImplementationOnce(() => new Promise(() => {}));
    mocks.descriptor.mockImplementation(
      async (_id, _token, _params, options) => {
        options.onGranted?.();
        return Response.json(track);
      },
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(
      ensureTrackMetadata(item, { deadline: Date.now() + 30 }),
    ).resolves.toMatchObject({ metadata: { status: "deferred" } });
    expect(mocks.token).toHaveBeenCalledTimes(2);
    expect(mocks.descriptor).toHaveBeenCalledOnce();
    expect(mocks.range).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.records.size).toBe(0);
  });

  it("publishes timeout backoff before a cold failure lookup so concurrent consumers cannot restart the request", async () => {
    const cold = deferred<void>();
    mocks.peek.mockReturnValueOnce(cold.promise);
    mocks.range.mockImplementation(({ signal, requestOptions }) => {
      requestOptions.onGranted?.();
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    });
    const {
      ensureTrackMetadata,
      getTrackMetadataState,
      getTrackMetadataRetryAt,
    } = await import("./track-metadata-loader");
    const first = ensureTrackMetadata(known(), { deadline: Date.now() + 30 });
    try {
      await vi.waitFor(() => expect(mocks.peek).toHaveBeenCalledOnce());
      expect(getTrackMetadataState(known())).toMatchObject({
        status: "deferred",
        reason: "timeout",
      });
      expect(getTrackMetadataRetryAt(known())).toBeGreaterThan(Date.now());
      await expect(
        ensureTrackMetadata(known(), { deadline: Date.now() + 30 }),
      ).resolves.toMatchObject({
        metadata: { status: "deferred", error: { code: "timeout" } },
      });
      expect(mocks.range).toHaveBeenCalledOnce();
    } finally {
      cold.resolve();
      await first;
    }
    expect(mocks.records.get(track.id)).toMatchObject({
      reason: "timeout",
      retryCount: 1,
    });
  });

  it("does not spend per-track attempts when subscriber deadlines expire before a request is granted", async () => {
    mocks.range.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        ensureTrackMetadata(known(), { deadline: Date.now() + 30 }),
      ).resolves.toMatchObject({ metadata: { status: "deferred" } });
      expect(mocks.records.size).toBe(0);
      expect(mocks.put).not.toHaveBeenCalled();
    }
    expect(mocks.range).toHaveBeenCalledTimes(2);
  });

  it("does not charge a later range's queue wait after an earlier request was granted", async () => {
    const { scheduleDriveRequest } = await import("./drive-request-scheduler");
    let blocker: Response | undefined;
    const firstRange = vi.fn(async () => new Response("first bytes"));
    const queuedRange = vi.fn(async () => new Response("later bytes"));
    mocks.range.mockImplementation(async ({ requestOptions }) => {
      const first = await scheduleDriveRequest(firstRange, requestOptions);
      await first.text();
      blocker = await scheduleDriveRequest(
        async () => new Response("playback"),
        {
          accountId: "a",
          priority: "playback",
        },
      );
      const queued = await scheduleDriveRequest(queuedRange, requestOptions);
      await queued.text();
      return { status: "no_target_tags", loadedVia: "drive_range" };
    });
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    try {
      await expect(
        ensureTrackMetadata(known(), {
          priority: "navigation",
          deadline: Date.now() + 100,
        }),
      ).resolves.toMatchObject({ metadata: { status: "deferred" } });
      expect(firstRange).toHaveBeenCalledOnce();
      expect(queuedRange).not.toHaveBeenCalled();
      expect(mocks.records.size).toBe(0);
      expect(mocks.put).not.toHaveBeenCalled();
    } finally {
      await blocker?.text();
    }
  });

  it("keeps a settled scope-only timeout after the aborted descriptor request unwinds", async () => {
    const item = known();
    item.track.modifiedTime = undefined;
    item.track.size = undefined;
    mocks.descriptor.mockImplementation((_id, _token, _params, options) => {
      options.onGranted?.();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        ),
      );
    });
    const { ensureTrackMetadata, getTrackMetadataState } = await import(
      "./track-metadata-loader"
    );
    await expect(
      ensureTrackMetadata(item, { deadline: Date.now() + 30 }),
    ).resolves.toMatchObject({
      metadata: { status: "deferred", reason: "timeout" },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
    try {
      await expect(
        ensureTrackMetadata(item, { deadline: Date.now() + 30 }),
      ).resolves.toMatchObject({
        metadata: {
          status: "unresolved",
          freshness: "unknown",
          attemptComplete: true,
          reason: "timeout",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(getTrackMetadataState(item)).toMatchObject({
        status: "unresolved",
        freshness: "unknown",
        attemptComplete: true,
        reason: "timeout",
      });
      await ensureTrackMetadata(item);
      expect(mocks.descriptor).toHaveBeenCalledTimes(2);
      expect(mocks.put).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("does not count shared metadata setup failures as per-track attempts", async () => {
    const { MetadataReadError } = await import("./drive-metadata-reader");
    mocks.range.mockRejectedValue(
      new MetadataReadError("metadata_setup_error", true),
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: { error: { code: "metadata_setup_error", retryable: true } },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
    try {
      await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
        metadata: { error: { code: "metadata_setup_error", retryable: true } },
      });
      expect(mocks.range).toHaveBeenCalledTimes(2);
      expect(mocks.records.size).toBe(0);
      expect(mocks.put).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("bounds real subscriber timeouts across reloads and never publishes late tags", async () => {
    const reading = deferred<MetadataOutcome>();
    mocks.range.mockImplementation(({ requestOptions }) => {
      requestOptions.onGranted?.();
      return reading.promise;
    });
    let { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(
      ensureTrackMetadata(known(), { deadline: Date.now() + 80 }),
    ).resolves.toMatchObject({
      metadata: {
        status: "deferred",
        reason: "timeout",
        error: { retryable: true },
      },
    });
    const checkedAt = Number(mocks.records.get(track.id)?.checkedAt);
    expect(mocks.range.mock.calls[0][0].signal.aborted).toBe(true);
    vi.resetModules();
    ({ ensureTrackMetadata } = await import("./track-metadata-loader"));
    await ensureTrackMetadata(known());
    expect(mocks.range).toHaveBeenCalledOnce();
    const clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt + 30_000);
    try {
      await expect(
        ensureTrackMetadata(known(), { deadline: Date.now() + 80 }),
      ).resolves.toMatchObject({
        metadata: {
          status: "unresolved",
          reason: "timeout",
          error: { retryable: false },
        },
      });
      vi.resetModules();
      ({ ensureTrackMetadata } = await import("./track-metadata-loader"));
      await ensureTrackMetadata(known());
      expect(mocks.range).toHaveBeenCalledTimes(2);
      reading.resolve({
        status: "ready",
        tags: { title: "Too late" },
        loadedVia: "drive_range",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.records.get(track.id)).toMatchObject({
        status: "unresolved",
        reason: "timeout",
        retryCount: 2,
      });
      expect(mocks.put).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("bounds failures without content validators in this session without claiming freshness", async () => {
    const item = known();
    item.track.modifiedTime = undefined;
    item.track.size = undefined;
    mocks.descriptor.mockResolvedValue(new Response(null, { status: 503 }));
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(item)).resolves.toMatchObject({
      metadata: { status: "deferred", freshness: "unknown" },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
    try {
      await expect(ensureTrackMetadata(item)).resolves.toMatchObject({
        metadata: {
          status: "unresolved",
          freshness: "unknown",
          attemptComplete: true,
        },
      });
      await ensureTrackMetadata(item);
      expect(mocks.descriptor).toHaveBeenCalledTimes(2);
      expect(mocks.put).not.toHaveBeenCalled();
      const stronger = known();
      stronger.scopeKey = "strengthened";
      mocks.range.mockResolvedValue({
        status: "ready",
        tags: { title: "Recovered" },
        loadedVia: "drive_range",
      });
      mocks.descriptor.mockResolvedValue(Response.json(stronger.track));
      await expect(ensureTrackMetadata(stronger)).resolves.toMatchObject({
        metadata: { status: "ready" },
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("discards bytes when the post-read descriptor observes a different version", async () => {
    mocks.descriptor.mockResolvedValue(
      Response.json({ ...track, modifiedTime: "v2" }),
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
      metadata: { status: "error", error: { code: "version_changed" } },
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("refreshes a stale-size descriptor after a rejected range and can retry the new version", async () => {
    const { MetadataReadError } = await import("./drive-metadata-reader");
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const current = { ...track, size: "6000", modifiedTime: "v2" };
    mocks.descriptor.mockImplementation(async () => Response.json(current));
    mocks.range.mockRejectedValueOnce(
      new MetadataReadError("version_changed", true),
    );
    const item = known();
    await expect(ensureTrackMetadata(item)).resolves.toMatchObject({
      metadata: { status: "error", error: { code: "version_changed" } },
    });
    expect(item.track).toEqual(current);
    expect(mocks.put).not.toHaveBeenCalled();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31000);
    try {
      await expect(ensureTrackMetadata(item)).resolves.toMatchObject({
        metadata: { status: "ready", tags: { title: "Remote" } },
      });
      expect(mocks.put).toHaveBeenCalledWith(
        current,
        expect.objectContaining({ status: "ready" }),
        1,
      );
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["parse_error", "budget_exceeded", "range_unsupported"])(
    "does not save %s against an unvalidated old version",
    async (code) => {
      const { MetadataReadError } = await import("./drive-metadata-reader");
      mocks.range.mockRejectedValueOnce(new MetadataReadError(code));
      mocks.descriptor.mockImplementation(async () =>
        Response.json({ ...track, modifiedTime: "v2" }),
      );
      const { ensureTrackMetadata } = await import("./track-metadata-loader");
      await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
        metadata: { status: "error", error: { code: "version_changed" } },
      });
      expect(mocks.put).not.toHaveBeenCalled();
    },
  );

  it("does not use a collection converter's synthetic MPEG MIME to fetch an unsupported file", async () => {
    const item = known();
    item.source = "collection";
    item.originalMimeType = undefined;
    item.track.name = "track.flac";
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    await expect(ensureTrackMetadata(item)).resolves.toMatchObject({
      metadata: { status: "unresolved", reason: "unsupported_format" },
    });
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
  });
  it("requeues a preempted Range read immediately without a network-error backoff", async () => {
    const { DrivePreemptedError } = await import("./drive-request-scheduler");
    mocks.range.mockRejectedValueOnce(new DrivePreemptedError());
    const { ensureTrackMetadata, getTrackMetadataRetryAt } = await import(
      "./track-metadata-loader"
    );
    const first = known();
    expect((await ensureTrackMetadata(first)).metadata).toMatchObject({
      status: "deferred",
      error: { code: "preempted", retryAfterMs: 0 },
    });
    expect(getTrackMetadataRetryAt(first)).toBeLessThanOrEqual(Date.now());
    expect((await ensureTrackMetadata(known())).metadata.status).toBe("ready");
    expect(mocks.range).toHaveBeenCalledTimes(2);
  });
});

it("reuses a proven version and verifies it once after the sparse reads", async () => {
  const bytes = Buffer.alloc(5000);
  const text = Buffer.from("\0Synthetic title", "binary");
  bytes.write("ID3");
  bytes[3] = 3;
  bytes[9] = 10 + text.length;
  bytes.write("TIT2", 10);
  bytes.writeUInt32BE(text.length, 14);
  text.copy(bytes, 20);
  mocks.media.mockImplementation(
    async (_id, _token, start, end) =>
      new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": String(end - start + 1),
        },
      }),
  );
  const actual = await vi.importActual<
    typeof import("@/lib/drive-metadata-reader")
  >("@/lib/drive-metadata-reader");
  mocks.range.mockImplementation(actual.readDriveTrackMetadata);
  const { ensureTrackMetadata } = await import("./track-metadata-loader");
  await expect(ensureTrackMetadata(known())).resolves.toMatchObject({
    metadata: { status: "ready", tags: { title: "Synthetic title" } },
    loadedNow: true,
  });
  expect(mocks.media).toHaveBeenCalledOnce();
  expect(mocks.descriptor).toHaveBeenCalledOnce();
  expect(
    mocks.media.mock.calls.length + mocks.descriptor.mock.calls.length,
  ).toBe(2);
});
