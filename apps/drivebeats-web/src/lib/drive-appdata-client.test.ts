import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";

const mocks = vi.hoisted(() => ({
  entries: new Map<
    string,
    {
      id: string;
      kind: string;
      accountId: string;
      generation: string;
      bytes: number;
      payload: unknown;
      sealed?: boolean;
      readyToSeal?: boolean;
    }
  >(),
  records: new Map<string, MetadataRecord>(),
  local: [] as MetadataRecord[],
  scanBarrier: null as Promise<void> | null,
  roots: [] as { id: string; name: string; mimeType: string }[],
  fetch: vi.fn(),
  audio: vi.fn(),
  descriptor: vi.fn(),
  restore: vi.fn(),
  pause: vi.fn(),
  auth: {
    user: { id: "a" },
    appDataReady: true,
    appDataOfflineReady: true,
    appDataConsentRequired: false,
    accessToken: "token" as string | null,
    expiresAt: 999999 as number | null,
  },
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  readPortableCache: async (accountId: string) =>
    [...mocks.entries.values()]
      .filter((entry) => entry.accountId === accountId)
      .map((entry) => structuredClone(entry)),
  readPortableOutbox: async (id: string) =>
    structuredClone(mocks.entries.get(id)),
  savePortableOutbox: async (
    entry: {
      id: string;
      kind: string;
      accountId: string;
      generation: string;
      bytes: number;
      payload: unknown;
      sealed?: boolean;
    },
    draftMode?: "create" | "append",
  ) => {
    const existing = mocks.entries.get(entry.id);
    if (
      (draftMode === "append" && (!existing || existing.sealed)) ||
      (draftMode === "create" && existing)
    )
      return false;
    mocks.entries.set(
      entry.id,
      structuredClone({
        ...entry,
        sealed: draftMode ? false : (entry.sealed ?? true),
      }),
    );
    return true;
  },
  sealPortableOutbox: async (accountId: string) => {
    const entries = [...mocks.entries.values()].filter(
      (entry) =>
        entry.accountId === accountId &&
        entry.kind === "outbox" &&
        entry.readyToSeal !== false,
    );
    for (const entry of entries) entry.sealed = true;
    return structuredClone(entries);
  },
  renewPortableOutboxIdentity: async (
    entry: {
      id: string;
      kind: string;
      accountId: string;
      generation: string;
      bytes: number;
      payload: unknown;
    },
    expectedPayload: unknown,
  ) => {
    const originalId = (expectedPayload as { operationId: string }).operationId;
    const existing = mocks.entries.get(originalId);
    if (
      !existing ||
      JSON.stringify(existing.payload) !== JSON.stringify(expectedPayload)
    )
      return existing ?? null;
    mocks.entries.set(entry.id, structuredClone(entry));
    mocks.entries.delete(originalId);
    return entry;
  },
  replacePortableOutbox: async (
    entry: {
      id: string;
      kind: string;
      accountId: string;
      generation: string;
      bytes: number;
      payload: unknown;
    },
    expectedPayload: unknown,
  ) => {
    const existing = mocks.entries.get(entry.id);
    if (
      !existing ||
      JSON.stringify(existing.payload) !== JSON.stringify(expectedPayload)
    )
      return existing ?? null;
    mocks.entries.set(entry.id, structuredClone(entry));
    return entry;
  },
  markPortableMetadataDirty: async (accountId: string, generation: string) => {
    mocks.entries.set("dirty", {
      id: "dirty",
      accountId,
      generation,
      kind: "dirty",
      bytes: 0,
      payload: null,
    });
  },
  clearPortableMetadataDirty: async () => {
    mocks.entries.delete("dirty");
  },
  acknowledgePortableOutbox: async (id: string, payload: unknown) => {
    const existing = mocks.entries.get(id);
    if (
      existing &&
      JSON.stringify(existing.payload) !== JSON.stringify(payload)
    )
      return false;
    mocks.entries.delete(id);
    return true;
  },
  clearPortableCache: async () => mocks.entries.clear(),
  scanMetadataRecords: async (
    _accountId: string,
    visit: (record: MetadataRecord) => void,
  ) => {
    await mocks.scanBarrier;
    for (const record of mocks.local) visit(record);
    return true;
  },
}));
vi.mock("@/stores/id3-metadata-store", () => {
  const record = (track: {
    id: string;
    modifiedTime: string;
    size: string;
  }) => ({
    record: mocks.records.get(track.id),
    freshness:
      mocks.records.get(track.id)?.fingerprint ===
      JSON.stringify([track.modifiedTime, track.size])
        ? "current"
        : "unknown",
  });
  const state = {
    accountId: "a",
    generation: 1,
    setAccount: async () => {},
    observeDescriptor: () => {},
    getRecord: record,
    loadRecord: async (track: {
      id: string;
      modifiedTime: string;
      size: string;
    }) => record(track),
    restoreRecord: async (value: MetadataRecord) => {
      mocks.restore(value);
      mocks.records.set(value.fileId, value);
      return true;
    },
  };
  return { useId3MetadataStore: { getState: () => state } };
});
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: {
    getState: () => ({
      rootFolders: [],
      rootFiles: [],
      bindAccount: vi.fn(),
      hydrateRemoteRoots: (roots: typeof mocks.roots) => {
        mocks.roots = roots;
      },
    }),
  },
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => ({
      authStatus: "authenticated",
      ...mocks.auth,
      isLoggingOut: false,
      getValidAccessToken: async () => "token",
    }),
    setState: vi.fn((patch: object) => Object.assign(mocks.auth, patch)),
    subscribe: vi.fn(),
  },
}));
vi.mock("@/lib/known-track-resolver", () => ({
  assertKnownTrack: () => true,
  updateKnownTrackDescriptor: () => true,
}));
vi.mock("@/stores/player-store", () => ({
  getAvailablePlaybackBlob: mocks.audio,
  usePlayerStore: { getState: () => ({ pause: mocks.pause }) },
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: mocks.descriptor,
}));

function metadata(index: number): MetadataRecord {
  return {
    accountId: "a",
    fileId: `track-${index}`,
    fingerprint: JSON.stringify(["2026-10-23T10:00:00Z", "1234"]),
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    status: index % 2 ? "ready" : "no_target_tags",
    ...(index % 2 ? { tags: { title: `Title ${index}` } } : {}),
    loadedVia: "drive_range",
    checkedAt: 1,
    checkedFields: ["title", "artist", "album"],
  };
}
function envelope(kind: string, payload: unknown, revision = 1) {
  return {
    format: 1,
    accountId: "a",
    generation: "generation-a",
    operationId: `op-${revision}`,
    revision,
    kind,
    payload,
  };
}
function remote(envelopes: unknown[] = []) {
  return { generation: "generation-a", revision: envelopes.length, envelopes };
}
function respond(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
async function load() {
  const client = await import("./drive-appdata-client");
  const { useDriveAppDataStore } = await import("@/stores/drive-appdata-store");
  return { client, state: useDriveAppDataStore };
}
async function settleLocalCheckpoint() {
  await vi.advanceTimersByTimeAsync(100);
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.entries.clear();
  mocks.records.clear();
  mocks.local = [];
  mocks.scanBarrier = null;
  mocks.roots = [];
  Object.assign(mocks.auth, {
    user: { id: "a" },
    appDataReady: true,
    appDataOfflineReady: true,
    appDataConsentRequired: false,
    accessToken: "token",
    expiresAt: 999999,
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (_url: string, options?: RequestInit) =>
    options?.method === "POST"
      ? respond({
          ...JSON.parse(String(options.body)),
          revision: 2,
          savedAt: "2026-10-23T10:00:00Z",
          bytes: 1024,
        })
      : respond(remote()),
  );
});
afterEach(async () => {
  const { client } = await load();
  await client.stopDriveAppData();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("portable metadata and imported choices", () => {
  it.each([3, 67, 129])(
    "restores %i acknowledged tags before loader work without descriptor/audio requests",
    async (count) => {
      const records = Array.from({ length: count }, (_, index) =>
        metadata(index),
      );
      mocks.fetch.mockResolvedValue(
        respond(remote([envelope("tags", { records })])),
      );
      const { client, state } = await load();
      await client.restoreDriveAppData("a");
      await settleLocalCheckpoint();
      const { ensureTrackMetadata } = await import("./track-metadata-loader");
      for (const record of records) {
        const result = await ensureTrackMetadata({
          accountId: "a",
          scopeKey: "catalog",
          source: "catalog",
          track: {
            id: record.fileId,
            name: "track.mp3",
            mimeType: "audio/mpeg",
            modifiedTime: "2026-10-23T10:00:00Z",
            size: "1234",
          },
        });
        expect(result.loadedNow).toBe(false);
        expect(result.metadata.status).toBe(record.status);
      }
      expect(state.getState().savedCount).toBe(count);
      expect(mocks.audio).not.toHaveBeenCalled();
      expect(mocks.descriptor).not.toHaveBeenCalled();
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("selects the exact saved content variant even when one file has multiple size fingerprints", async () => {
    const saved = metadata(1);
    const other = {
      ...saved,
      fingerprint: JSON.stringify(["2026-10-23T10:00:00Z", "9999"]),
      tags: { title: "Other content version" },
    };
    mocks.fetch.mockResolvedValue(
      respond(remote([envelope("tags", { records: [saved, other] })])),
    );
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    expect(mocks.records.get(saved.fileId)?.tags?.title).toBe(
      "Other content version",
    );
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const result = await ensureTrackMetadata({
      accountId: "a",
      scopeKey: "catalog",
      source: "catalog",
      track: {
        id: saved.fileId,
        name: "track.mp3",
        mimeType: "audio/mpeg",
        modifiedTime: "2026-10-23T10:00:00Z",
        size: "1234",
      },
    });
    expect(result.metadata.tags?.title).toBe("Title 1");
    expect(result.loadedNow).toBe(false);
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("defers extraction on failed restore and does not scan or use a timeout fallback", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const { client, state } = await load();
    await expect(client.restoreDriveAppData("a")).rejects.toThrow("offline");
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const result = await ensureTrackMetadata({
      accountId: "a",
      scopeKey: "catalog",
      source: "catalog",
      track: {
        id: "unknown",
        name: "track.mp3",
        mimeType: "audio/mpeg",
        modifiedTime: "v1",
        size: "1234",
      },
    });
    expect(result.metadata.error?.code).toBe("appdata_restore_required");
    expect(state.getState().status).toBe("error");
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
  });

  it("opens normal use after remote apply while existing-cache scanning and saving remain deferred", async () => {
    let finishScan!: () => void;
    const held = new Promise<void>((resolve) => {
      finishScan = resolve;
    });
    mocks.local = Array.from({ length: 137 }, (_, index) => metadata(index));
    mocks.scanBarrier = held;
    const { client, state } = await load();
    await client.restoreDriveAppData("a");
    expect(state.getState()).toMatchObject({
      status: "ready",
      pendingCount: 0,
    });
    expect(await client.waitForDriveAppDataRestore("a")).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.getState().status).toBe("ready");
    finishScan();
    await settleLocalCheckpoint();
    expect(state.getState()).toMatchObject({
      status: "ready",
      pendingCount: 137,
    });
    await client.flushDriveAppData();
    expect(state.getState()).toMatchObject({
      savedCount: 137,
      pendingCount: 0,
    });
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
  });

  it.each(["save_first", "snapshot_first"] as const)(
    "restores without awaiting the upload backlog while preserving newer root intent (%s)",
    async (order) => {
      const folder = {
        id: "folder",
        name: "Music",
        mimeType: "application/vnd.google-apps.folder",
      };
      const snapshot = remote([
        envelope("roots", {
          operations: [
            {
              type: "add",
              rootKind: "folder",
              id: "folder",
              descriptor: folder,
            },
          ],
        }),
      ]);
      mocks.fetch.mockResolvedValueOnce(respond(snapshot));
      const { client, state } = await load();
      await client.restoreDriveAppData("a");
      await settleLocalCheckpoint();
      await client.queueImportedRootOperations([
        { type: "remove", rootKind: "folder", id: "folder" },
      ]);
      let finishSave!: (response: Response) => void;
      let saveStarted!: () => void;
      const saving = new Promise<void>((resolve) => {
        saveStarted = resolve;
      });
      mocks.fetch.mockImplementationOnce(() => {
        saveStarted();
        return new Promise<Response>((resolve) => {
          finishSave = resolve;
        });
      });
      const flush = client.flushDriveAppData();
      await saving;
      const command = JSON.parse(
        String(mocks.fetch.mock.calls.at(-1)?.[1].body),
      );
      let finishRead!: (response: Response) => void;
      let readStarted!: () => void;
      const reading = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      mocks.fetch.mockImplementationOnce(() => {
        readStarted();
        return new Promise<Response>((resolve) => {
          finishRead = resolve;
        });
      });
      const restoring = client.restoreDriveAppData("a");
      await reading;
      const acknowledgment = respond({
        generation: "generation-a",
        revision: 2,
        operationId: command.operationId,
        savedAt: 1,
        bytes: 50,
      });
      if (order === "save_first") {
        finishSave(acknowledgment);
        await flush;
      }
      finishRead(respond(snapshot));
      await restoring;
      expect(state.getState().status).toBe("ready");
      expect(mocks.roots).toEqual([]);
      if (order === "snapshot_first") {
        finishSave(acknowledgment);
        await flush;
      }
    },
  );

  it("uploads valid existing cache in bounded batches and acknowledges only completed uploads", async () => {
    mocks.local = Array.from({ length: 137 }, (_, index) => metadata(index));
    mocks.local.push({
      ...metadata(200),
      status: "unresolved",
      reason: "budget_exceeded",
    });
    const { client, state } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    expect(state.getState()).toMatchObject({
      savedCount: 0,
      pendingCount: 137,
    });
    await client.flushDriveAppData();
    const commands = mocks.fetch.mock.calls
      .filter(([, options]) => options?.method === "POST")
      .map(([, options]) => JSON.parse(options.body));
    expect(commands.map((command) => command.payload.records.length)).toEqual([
      64, 64, 9,
    ]);
    expect(state.getState()).toMatchObject({
      savedCount: 137,
      pendingCount: 0,
    });
    expect(mocks.audio).not.toHaveBeenCalled();
  });

  it("reuses a durable batch ID after lost acknowledgment and a restarted browser client", async () => {
    const first = await load();
    await first.client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await first.client.queuePortableMetadata(metadata(1));
    mocks.fetch.mockRejectedValueOnce(new Error("response_lost"));
    await expect(first.client.flushDriveAppData()).rejects.toThrow(
      "response_lost",
    );
    expect(first.state.getState()).toMatchObject({
      pendingCount: 1,
      savedCount: 0,
    });
    const command = [...mocks.entries.values()].find(
      (entry) => entry.kind === "outbox",
    )?.payload;
    await first.client.stopDriveAppData();
    vi.resetModules();
    const second = await load();
    await second.client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await second.client.flushDriveAppData();
    const retry = mocks.fetch.mock.calls
      .filter(([, options]) => options?.method === "POST")
      .at(-1);
    expect(JSON.parse(String(retry?.[1].body))).toEqual(command);
    expect(second.state.getState()).toMatchObject({
      pendingCount: 0,
      savedCount: 1,
    });
  });

  it("replays removals without hydration writes and preserves a newly imported root", async () => {
    const folder = {
      id: "folder",
      name: "Music",
      mimeType: "application/vnd.google-apps.folder",
    };
    mocks.fetch.mockResolvedValue(
      respond(
        remote([
          envelope(
            "roots",
            {
              operations: [
                {
                  type: "add",
                  rootKind: "folder",
                  id: "folder",
                  descriptor: folder,
                },
              ],
            },
            1,
          ),
          envelope(
            "roots",
            {
              operations: [
                { type: "remove", rootKind: "folder", id: "folder" },
              ],
            },
            2,
          ),
        ]),
      ),
    );
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    expect(mocks.roots).toEqual([]);
    expect(mocks.entries.size).toBe(0);
    await client.queueImportedRootOperations([
      {
        type: "add",
        rootKind: "folder",
        id: "new",
        descriptor: { ...folder, id: "new" },
      },
    ]);
    expect(mocks.entries.size).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for overlapping restore before any missing metadata extraction", async () => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { client } = await load();
    const restore = client.restoreDriveAppData("a");
    await Promise.resolve();
    const { ensureTrackMetadata } = await import("./track-metadata-loader");
    const pending = ensureTrackMetadata({
      accountId: "a",
      scopeKey: "catalog",
      source: "catalog",
      track: {
        id: "track-1",
        name: "track.mp3",
        mimeType: "audio/mpeg",
        modifiedTime: "2026-10-23T10:00:00Z",
        size: "1234",
      },
    });
    await Promise.resolve();
    expect(mocks.audio).not.toHaveBeenCalled();
    finish(respond(remote([envelope("tags", { records: [metadata(1)] })])));
    await restore;
    expect((await pending).metadata.tags?.title).toBe("Title 1");
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
  });

  it("preserves a deliberate new import made while restore is still in flight", async () => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { client } = await load();
    const restore = client.restoreDriveAppData("a", "generation-a");
    await client.queueImportedRootOperations([
      {
        type: "add",
        rootKind: "folder",
        id: "folder",
        descriptor: {
          id: "folder",
          name: "Music",
          mimeType: "application/vnd.google-apps.folder",
        },
      },
    ]);
    finish(
      respond(
        remote([
          envelope("roots", {
            operations: [{ type: "remove", rootKind: "folder", id: "folder" }],
          }),
        ]),
      ),
    );
    await restore;
    await settleLocalCheckpoint();
    expect(mocks.roots.map((root) => root.id)).toEqual(["folder"]);
    expect([...mocks.entries.values()][0].payload).toMatchObject({
      baseRevision: 1,
    });
  });

  it("retains the exact command on pending-write conflicts instead of poisoning its retry ID", async () => {
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await client.queueImportedRootOperations([
      { type: "remove", rootKind: "folder", id: "folder" },
    ]);
    const original = structuredClone([...mocks.entries.values()][0].payload);
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "appdata_pending_write" }), {
        status: 409,
      }),
    );
    await expect(client.flushDriveAppData()).rejects.toThrow(
      "appdata_pending_write",
    );
    expect([...mocks.entries.values()][0].payload).toEqual(original);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect an offline pending add after a newer remote removal", async () => {
    const { client, state } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await client.queueImportedRootOperations([
      {
        type: "add",
        rootKind: "folder",
        id: "folder",
        descriptor: {
          id: "folder",
          name: "Music",
          mimeType: "application/vnd.google-apps.folder",
        },
      },
    ]);
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "appdata_revision_conflict" }), {
        status: 409,
      }),
    );
    mocks.fetch.mockResolvedValueOnce(
      respond(
        remote([
          envelope("roots", {
            operations: [{ type: "remove", rootKind: "folder", id: "folder" }],
          }),
        ]),
      ),
    );
    await client.flushDriveAppData();
    expect(mocks.roots).toEqual([]);
    expect(state.getState().pendingCount).toBe(0);
    expect(
      mocks.fetch.mock.calls.filter(
        ([, options]) => options?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("uses original tombstone revision from a later checkpoint when retaining newer pending imports", async () => {
    mocks.fetch.mockResolvedValueOnce(respond({ ...remote(), revision: 5 }));
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await client.queueImportedRootOperations([
      {
        type: "add",
        rootKind: "folder",
        id: "folder",
        descriptor: {
          id: "folder",
          name: "Music",
          mimeType: "application/vnd.google-apps.folder",
        },
      },
    ]);
    mocks.fetch.mockResolvedValueOnce(
      respond({
        ...remote([
          envelope(
            "roots",
            {
              operations: [
                {
                  type: "remove",
                  rootKind: "folder",
                  id: "folder",
                  sourceRevision: 1,
                },
              ],
            },
            10,
          ),
        ]),
        revision: 10,
      }),
    );
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    expect(mocks.roots.map((root) => root.id)).toEqual(["folder"]);
    expect([...mocks.entries.values()][0].payload).toMatchObject({
      baseRevision: 5,
    });
  });

  it("rejects checkpoint root revisions newer than their containing envelope", async () => {
    mocks.fetch.mockResolvedValueOnce(
      respond(
        remote([
          envelope(
            "roots",
            {
              operations: [
                {
                  type: "remove",
                  rootKind: "folder",
                  id: "folder",
                  sourceRevision: 11,
                },
              ],
            },
            10,
          ),
        ]),
      ),
    );
    const { client } = await load();
    await expect(client.restoreDriveAppData("a")).rejects.toThrow(
      "invalid_backup",
    );
  });

  it("normalizes optional tag values and implementation details before strict server validation", async () => {
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await client.queuePortableMetadata({
      ...metadata(1),
      tags: { title: "Title", artist: undefined },
      rangeStrategyVersion: 4,
      retryCount: 1,
      reason: "old_local_detail",
    });
    const command = [...mocks.entries.values()][0].payload as {
      payload: { records: MetadataRecord[] };
    };
    expect(command.payload.records[0].tags).toEqual({ title: "Title" });
    expect(command.payload.records[0]).not.toHaveProperty("reason");
    expect(command.payload.records[0]).not.toHaveProperty(
      "rangeStrategyVersion",
    );
  });

  it("gates immediately on revoked app-data access, clears offline proof/tokens and pauses playback", async () => {
    const { client, state } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    const { saveVerifiedAppDataReadiness, APPDATA_READINESS_KEY_PREFIX } =
      await import("@/lib/appdata-readiness");
    saveVerifiedAppDataReadiness("a", "generation-a", 1);
    await client.queuePortableMetadata(metadata(1));
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "appdata_access_required" }), {
        status: 403,
      }),
    );
    await expect(client.flushDriveAppData()).rejects.toThrow(
      "appdata_access_required",
    );
    expect(mocks.auth).toMatchObject({
      appDataReady: false,
      appDataOfflineReady: false,
      appDataConsentRequired: true,
      accessToken: null,
      expiresAt: null,
    });
    expect(localStorage.getItem(`${APPDATA_READINESS_KEY_PREFIX}a`)).toBeNull();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(state.getState().status).toBe("error");
    expect(await client.waitForDriveAppDataRestore("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not apply a late revoked-access response to a different account", async () => {
    const { client } = await load();
    await client.restoreDriveAppData("a");
    await settleLocalCheckpoint();
    await client.queuePortableMetadata(metadata(1));
    let finish!: (response: Response) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.fetch.mockImplementationOnce(() => {
      started();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const flushing = client.flushDriveAppData();
    await requested;
    await client.stopDriveAppData();
    Object.assign(mocks.auth, {
      user: { id: "b" },
      accessToken: "other-account-token",
    });
    finish(
      new Response(JSON.stringify({ code: "appdata_access_required" }), {
        status: 403,
      }),
    );
    await expect(flushing).rejects.toThrow("appdata_access_required");
    expect(mocks.auth).toMatchObject({
      appDataReady: true,
      appDataConsentRequired: false,
      accessToken: "other-account-token",
    });
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  it("recovers a transient restore in bounded background attempts without holding normal-use readiness", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("network_error"));
    const { client, state } = await load();
    await expect(client.restoreDriveAppData("a")).rejects.toThrow(
      "network_error",
    );
    expect(state.getState().status).toBe("error");
    mocks.fetch.mockResolvedValue(
      respond(remote([envelope("tags", { records: [metadata(1)] })])),
    );
    await vi.advanceTimersByTimeAsync(2100);
    expect(state.getState()).toMatchObject({ status: "ready", savedCount: 1 });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
  });

  it("stops automatic restore retries after two background failures", async () => {
    mocks.fetch.mockRejectedValue(new Error("network_error"));
    const { client, state } = await load();
    await expect(client.restoreDriveAppData("a")).rejects.toThrow(
      "network_error",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(state.getState().status).toBe("error");
    expect(await client.waitForDriveAppDataRestore("a")).toBe(false);
  });

  it("warns about an unqueued local checkpoint on logout without flushing or making HTTP calls", async () => {
    let finish!: () => void;
    mocks.scanBarrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { client } = await load();
    await client.restoreDriveAppData("a");
    const before = mocks.fetch.mock.calls.length;
    expect(await client.getDriveAppDataLogoutState()).toEqual({
      pendingCount: 0,
      checkpointPending: true,
      incomplete: true,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(before);
    finish();
    await settleLocalCheckpoint();
    expect(await client.getDriveAppDataLogoutState()).toEqual({
      pendingCount: 0,
      checkpointPending: false,
      incomplete: false,
    });
  });

  it("rejects future schemas, wrong accounts, oversized tags and device-specific failures", async () => {
    const { client } = await load();
    for (const record of [
      { ...metadata(1), schemaVersion: 999 },
      { ...metadata(1), accountId: "other" },
      { ...metadata(1), tags: { title: "x".repeat(501) } },
      { ...metadata(1), status: "unresolved", reason: "range_unsupported" },
    ])
      expect(client.isPortableMetadata(record, "a")).toBe(false);
  });
});
