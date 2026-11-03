import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type AppDataControl,
  AppDataError,
  type AppDataIdentity,
  type AppDataOperation,
} from "@/db/appdata-types";
import {
  APPDATA_MAX_PAGE_BYTES,
  readDriveAppDataPage,
} from "@/lib/drive-appdata-pages";
import type { AppDataEnvelope } from "@/lib/drive-appdata-schema";
import {
  getMetadataFingerprint,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";

const mocks = vi.hoisted(() => ({
  records: new Map<string, MetadataRecord>(),
  restore: vi.fn(),
  audio: vi.fn(),
  descriptor: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => ({
      authStatus: "authenticated",
      user: { id: "a" },
      isLoggingOut: false,
      getValidAccessToken: async () => "token",
    }),
    subscribe: vi.fn(),
    setState: vi.fn(),
  },
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: {
    getState: () => ({
      accountId: "a",
      accountGeneration: "00000000-0000-4000-8000-000000000001",
      rootFolders: [],
      rootFiles: [],
      bindAccount: () => {},
      hydrateRemoteRoots: () => {},
    }),
  },
}));
vi.mock("@/stores/id3-metadata-store", () => {
  const getRecord = (track: {
    id: string;
    size: string;
    modifiedTime: string;
  }) => ({
    record: mocks.records.get(track.id),
    freshness:
      mocks.records.get(track.id)?.fingerprint ===
      JSON.stringify([track.modifiedTime, track.size])
        ? "current"
        : "unknown",
  });
  return {
    useId3MetadataStore: {
      getState: () => ({
        accountId: "a",
        generation: 1,
        setAccount: async () => {},
        observeDescriptor: () => {},
        getRecord,
        loadRecord: async (track: {
          id: string;
          size: string;
          modifiedTime: string;
        }) => getRecord(track),
        restoreRecord: async (record: MetadataRecord) => {
          mocks.restore(record);
          mocks.records.set(record.fileId, record);
          return true;
        },
      }),
    },
  };
});
vi.mock("@/lib/known-track-resolver", () => ({
  assertKnownTrack: () => true,
  updateKnownTrackDescriptor: () => true,
}));
vi.mock("@/stores/player-store", () => ({
  getAvailablePlaybackBlob: mocks.audio,
  usePlayerStore: { getState: () => ({ pause: vi.fn() }) },
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: mocks.descriptor,
}));

const identity: AppDataIdentity = {
  accountId: "a",
  generation: "00000000-0000-4000-8000-000000000001",
};
function record(index: number): MetadataRecord {
  return {
    accountId: "a",
    fileId: `track-${index}`,
    fingerprint: JSON.stringify(["2026-10-23T10:00:00Z", "1234"]),
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    status: "ready",
    tags: {
      title: `${"音".repeat(300)}${index}`,
      artist: "楽".repeat(300),
      album: "曲".repeat(300),
    },
    checkedAt: 1,
    checkedFields: ["title", "artist", "album"],
    loadedVia: "drive_range",
  };
}
function fixture(count = 1709) {
  const records = Array.from({ length: count }, (_, index) => record(index));
  const operations: AppDataOperation[] = [];
  const envelopes = new Map<string, AppDataEnvelope>();
  const account = {
    ...identity,
    state: "active" as const,
    source: "drive" as const,
    revision: 0,
    migrationVersion: 1,
  };
  function append(kind: "tags" | "roots" | "collections", payload: unknown) {
    const revision = ++account.revision;
    const operationId = `saved-${revision}`;
    const envelope = {
      ...identity,
      format: 1,
      operationId,
      revision,
      kind,
      payload,
      ...(kind !== "tags" ? { baseRevision: revision - 1 } : {}),
    } as AppDataEnvelope;
    envelopes.set(operationId, envelope);
    operations.push({
      ...identity,
      operationId,
      revision,
      kind,
      bodyHash: `hash-${revision}`,
      fileId: `hidden-${revision}`,
      bytes: Buffer.byteLength(JSON.stringify(envelope)),
      status: "committed",
      unresolvedUpload: false,
      savedAt: "2026-10-23",
    });
  }
  for (let offset = 0; offset < records.length; offset += 53)
    append("tags", { records: records.slice(offset, offset + 53) });
  const control = {
    assertIdentity: async (scope: AppDataIdentity) => {
      if (scope.generation !== account.generation)
        throw new AppDataError("appdata_stale_session");
      return { ...account };
    },
    list: async () => operations.map((op) => ({ ...op })),
    getRollout: async () => null,
  } as unknown as AppDataControl;
  const readEnvelope = vi.fn(async (op: AppDataOperation) => {
    const value = envelopes.get(op.operationId);
    if (!value) throw new Error("missing test envelope");
    return value;
  });
  const dependencies = {
    control,
    readEnvelope,
    cursorSecret: "local-pagination-test-secret",
    fingerprint: async (fileIds: string[]) =>
      JSON.stringify(
        fileIds.map((id) => {
          const op = operations.find((op) => op.fileId === id);
          return op && envelopes.get(op.operationId);
        }),
      ),
  };
  return { records, operations, envelopes, account, append, dependencies };
}
const clients: typeof import("./drive-appdata-client")[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.records.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stopDriveAppData();
  vi.unstubAllGlobals();
});

it("revalidates a completed multipage restore without downloading unchanged Drive files", async () => {
  const data = fixture();
  const inventory = vi.spyOn(data.dependencies, "fingerprint");
  const requests: { cursor?: string; checkpoint?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const cursor =
        new URL(path, "https://drivebeats.test").searchParams.get("cursor") ??
        undefined;
      const checkpoint =
        new Headers(init?.headers).get("X-DriveBeats-Checkpoint") ?? undefined;
      requests.push({ cursor, checkpoint });
      return Response.json(
        await readDriveAppDataPage(
          data.dependencies,
          identity,
          cursor,
          checkpoint,
        ),
      );
    }),
  );
  const client = await import("./drive-appdata-client");
  clients.push(client);
  await client.restoreDriveAppData("a", identity.generation);
  expect(requests.length).toBeGreaterThan(1);
  expect(inventory).toHaveBeenCalledTimes(1);
  const downloads = data.dependencies.readEnvelope.mock.calls.length;
  requests.length = 0;
  await client.restoreDriveAppData("a", identity.generation);
  expect(requests).toHaveLength(1);
  expect(inventory).toHaveBeenCalledTimes(2);
  expect(requests[0].checkpoint).toEqual(expect.any(String));
  expect(data.dependencies.readEnvelope).toHaveBeenCalledTimes(downloads);
  expect(mocks.restore).toHaveBeenCalledTimes(data.records.length);
  // A peer's new committed tags invalidate the manifest, even on this device.
  data.append("tags", { records: [record(9999)] });
  await client.restoreDriveAppData("a", identity.generation);
  expect(mocks.records.has("track-9999")).toBe(true);
  await client.stopDriveAppData();
  requests.length = 0;
  await client.restoreDriveAppData("a", identity.generation);
  expect(requests[0].checkpoint).toBeUndefined();
}, 15_000);

it("rejects a modified checkpoint inside a signed continuation cursor", async () => {
  const data = fixture();
  const inventory = vi.spyOn(data.dependencies, "fingerprint");
  const first = await readDriveAppDataPage(data.dependencies, identity);
  expect(first.nextCursor).toEqual(expect.any(String));
  const [body, signature] = (first.nextCursor as string).split(".");
  const changed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  changed.checkpoint = "0".repeat(64);
  const tampered = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
  await expect(
    readDriveAppDataPage(data.dependencies, identity, tampered),
  ).rejects.toMatchObject({ code: "appdata_invalid_cursor" });
  expect(inventory).toHaveBeenCalledTimes(1);
});

it("detects an upload committing at the same account revision and keeps final deletion fences", async () => {
  const data = fixture(1);
  const op = data.operations[0];
  op.status = "uploading";
  const before = await readDriveAppDataPage(data.dependencies, identity);
  op.status = "committed"; // Completion does not reserve another revision.
  const after = await readDriveAppDataPage(
    data.dependencies,
    identity,
    undefined,
    before.checkpoint,
  );
  expect(after.unchanged).toBeUndefined();
  expect(after.fragments).toHaveLength(1);
  const assert = vi.spyOn(data.dependencies.control, "assertIdentity");
  assert
    .mockResolvedValueOnce({ ...data.account })
    .mockRejectedValueOnce(new AppDataError("appdata_stale_session"));
  await expect(
    readDriveAppDataPage(
      data.dependencies,
      identity,
      undefined,
      after.checkpoint,
    ),
  ).rejects.toMatchObject({ code: "appdata_stale_session" });
});

it("never reuses a checkpoint from an incomplete restore", async () => {
  const data = fixture();
  let failSecondPage = true;
  const checkpoints: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const cursor =
        new URL(path, "https://drivebeats.test").searchParams.get("cursor") ??
        undefined;
      const checkpoint = new Headers(init?.headers).get(
        "X-DriveBeats-Checkpoint",
      );
      if (!cursor) checkpoints.push(checkpoint);
      if (cursor && failSecondPage)
        return Response.json(
          { code: "appdata_restore_changed" },
          { status: 409 },
        );
      return Response.json(
        await readDriveAppDataPage(
          data.dependencies,
          identity,
          cursor,
          checkpoint ?? undefined,
        ),
      );
    }),
  );
  const client = await import("./drive-appdata-client");
  clients.push(client);
  await expect(
    client.restoreDriveAppData("a", identity.generation),
  ).rejects.toThrow("appdata_restore_changed");
  expect(mocks.restore).not.toHaveBeenCalled();
  failSecondPage = false;
  await client.restoreDriveAppData("a", identity.generation);
  expect(checkpoints).toEqual([null, null]);
  expect(mocks.records.size).toBe(data.records.length);
}, 15_000);

it("falls back to full restore when a root choice is made during an unchanged check", async () => {
  const data = fixture(1);
  let release!: () => void;
  let checked!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    checked = resolve;
  });
  const requests: (string | undefined)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      const checkpoint =
        new Headers(init?.headers).get("X-DriveBeats-Checkpoint") ?? undefined;
      requests.push(checkpoint);
      const page = await readDriveAppDataPage(
        data.dependencies,
        identity,
        undefined,
        checkpoint,
      );
      if (page.unchanged) {
        checked();
        await held;
      }
      return Response.json(page);
    }),
  );
  const client = await import("./drive-appdata-client");
  clients.push(client);
  await client.restoreDriveAppData("a", identity.generation);
  const restoring = client.restoreDriveAppData("a", identity.generation);
  await reached;
  await client.queueImportedRootOperations([
    {
      type: "add",
      rootKind: "folder",
      id: "new",
      descriptor: {
        id: "new",
        name: "New",
        mimeType: "application/vnd.google-apps.folder",
      },
    },
  ]);
  release();
  await restoring;
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(expect.any(String));
  expect(requests[2]).toBeUndefined();
  const { readPortableCache } = await import("./metadata-cache-db");
  expect(
    (await readPortableCache("a")).some(
      (entry) => entry.kind === "outbox" && entry.readyToSeal === true,
    ),
  ).toBe(true);
});

it("bounds every encoded page below2MiB and avoids rereading the entire >4.5MiB backup", async () => {
  const data = fixture();
  expect(
    Buffer.byteLength(JSON.stringify([...data.envelopes.values()])),
  ).toBeGreaterThan(4.5 * 1024 * 1024);
  let cursor: string | undefined;
  let pages = 0;
  const decoded = new Map<string, Buffer[]>();
  do {
    const page = await readDriveAppDataPage(
      data.dependencies,
      identity,
      cursor,
    );
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
      APPDATA_MAX_PAGE_BYTES,
    );
    if (pages === 0) {
      expect(data.dependencies.readEnvelope.mock.calls.length).toBeLessThan(
        data.operations.length,
      );
      data.append("tags", { records: [record(9999)] }); // Concurrent tags are outside the pinned snapshot.
    }
    for (const fragment of page.fragments) {
      const chunks = decoded.get(fragment.operationId) ?? [];
      chunks.push(Buffer.from(fragment.data, "base64"));
      decoded.set(fragment.operationId, chunks);
    }
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  const restored = [...decoded.values()].flatMap(
    (chunks) =>
      (
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as Extract<
          AppDataEnvelope,
          { kind: "tags" }
        >
      ).payload.records,
  );
  expect(restored).toEqual(data.records);
  expect(data.dependencies.readEnvelope.mock.calls.length).toBeLessThan(
    data.operations.length + pages,
  );
}, 15_000);

it("fragments one oversized envelope without exceeding the response bound", async () => {
  const data = fixture(0);
  data.append("collections", {
    playlists: [],
    favorites: Array.from({ length: 2300 }, (_, index) => ({
      fileId: `favorite-${index}`,
      fileName: "音".repeat(700),
    })),
  });
  const chunks: Buffer[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await readDriveAppDataPage(
      data.dependencies,
      identity,
      cursor,
    );
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
      APPDATA_MAX_PAGE_BYTES,
    );
    chunks.push(
      ...page.fragments.map((part) => Buffer.from(part.data, "base64")),
    );
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(
    [...data.envelopes.values()][0],
  );
}, 15_000);

it("rejects cursor tampering, account changes and authoritative edits between pages", async () => {
  const data = fixture();
  const first = await readDriveAppDataPage(data.dependencies, identity);
  expect(first.nextCursor).not.toBeNull();
  await expect(
    readDriveAppDataPage(data.dependencies, identity, `${first.nextCursor}x`),
  ).rejects.toMatchObject({ code: "appdata_invalid_cursor" });
  await expect(
    readDriveAppDataPage(
      data.dependencies,
      { ...identity, accountId: "other" },
      first.nextCursor ?? undefined,
    ),
  ).rejects.toMatchObject({ code: "appdata_invalid_cursor" });
  data.append("roots", {
    operations: [{ type: "remove", rootKind: "folder", id: "music" }],
  });
  await expect(
    readDriveAppDataPage(
      data.dependencies,
      identity,
      first.nextCursor ?? undefined,
    ),
  ).rejects.toMatchObject({ code: "appdata_restore_changed" });
}, 15_000);

it("publishes no partial tags, then restores the full variable saved subset with zero descriptor/audio reads", async () => {
  const data = fixture(1717);
  let release!: () => void;
  let secondPage!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    secondPage = resolve;
  });
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const url = new URL(path, "https://drivebeats.test");
      const cursor = url.searchParams.get("cursor") ?? undefined;
      if (++requests === 2) {
        secondPage();
        await held;
      }
      const page = await readDriveAppDataPage(
        data.dependencies,
        identity,
        cursor,
      );
      return new Response(JSON.stringify(page), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const client = await import("./drive-appdata-client");
  clients.push(client);
  const { useDriveAppDataStore: state } = await import(
    "@/stores/drive-appdata-store"
  );
  const restoring = client.restoreDriveAppData("a", identity.generation);
  await reached;
  expect(state.getState().status).toBe("restoring");
  expect(mocks.restore).not.toHaveBeenCalled();
  release();
  await restoring;
  expect(state.getState()).toMatchObject({
    status: "ready",
    savedCount: data.records.length,
  });
  const { ensureTrackMetadata } = await import("./track-metadata-loader");
  for (const index of [0, 52, 1301, 1716]) {
    const record = data.records[index];
    const track = {
      id: record.fileId,
      name: "track.mp3",
      mimeType: "audio/mpeg",
      modifiedTime: "2026-10-23T10:00:00Z",
      size: "1234",
    };
    expect(getMetadataFingerprint(track)).toBe(record.fingerprint);
    const result = await ensureTrackMetadata({
      accountId: "a",
      scopeKey: "catalog",
      source: "catalog",
      track,
    });
    expect(result.loadedNow).toBe(false);
    expect(result.metadata.tags).toEqual(record.tags);
  }
  expect(mocks.audio).not.toHaveBeenCalled();
  expect(mocks.descriptor).not.toHaveBeenCalled();
}, 15_000);

it("discards collected pages when a root edit invalidates the snapshot", async () => {
  const data = fixture();
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (++requests === 2)
        data.append("roots", {
          operations: [{ type: "remove", rootKind: "folder", id: "music" }],
        });
      try {
        const page = await readDriveAppDataPage(
          data.dependencies,
          identity,
          new URL(path, "https://drivebeats.test").searchParams.get("cursor") ??
            undefined,
        );
        return new Response(JSON.stringify(page), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ code: (error as AppDataError).code }),
          { status: 409 },
        );
      }
    }),
  );
  const client = await import("./drive-appdata-client");
  clients.push(client);
  await expect(
    client.restoreDriveAppData("a", identity.generation),
  ).rejects.toThrow("appdata_restore_changed");
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.records.size).toBe(0);
}, 15_000);
