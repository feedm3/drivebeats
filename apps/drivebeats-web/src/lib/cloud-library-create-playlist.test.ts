// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPlaylistTracksRecords,
  createPlaylistWithTracksRecord,
  deletePlaylistRecord,
  reorderPlaylistTracksRecords,
} from "./cloud-library-service";
import { applyCollectionCommand } from "./collection-commands";
import { PlaylistLimitError } from "./playlist-limits";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  append: vi.fn(),
  getOperation: vi.fn(),
  op: "create-1",
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "X-DriveBeats-Generation": "generation",
      "X-DriveBeats-Operation": mocks.op,
    }),
}));
vi.mock("@/lib/appdata-context", () => ({
  getAppDataContext: async () => ({
    identity: { accountId: "account", generation: "generation" },
    service: {
      readCollections: mocks.read,
      append: mocks.append,
      getOperation: mocks.getOperation,
    },
  }),
}));
const user = {
  id: "account",
  email: "a@example.com",
  name: null,
  picture: null,
};
const t = (id: string) => ({ fileId: id, fileName: `${id}.mp3` });
let envelopes: {
  operationId: string;
  kind: string;
  revision: number;
  payload: unknown;
}[];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.op = "create-1";
  envelopes = [
    {
      operationId: "migration",
      kind: "migration",
      revision: 1,
      payload: { playlists: [], favorites: [] },
    },
  ];
  mocks.getOperation.mockImplementation(async (_identity, id) => {
    const op = envelopes.find((entry) => entry.operationId === id);
    if (op?.kind !== "collections") return null;
    const payload = op.payload as { commandHash: string; result: unknown };
    return {
      ...op,
      status: "committed",
      commandHash: payload.commandHash,
      result: payload.result,
    };
  });
  mocks.read.mockImplementation(async () => ({
    envelopes: structuredClone(envelopes),
    revision: envelopes.length,
  }));
  mocks.append.mockImplementation(async (_identity, input) => {
    envelopes.push({ ...input, revision: envelopes.length + 1 });
  });
});
describe("Drive collection command interface", () => {
  it("returns durable forward progress after eight canceled predecessors", async () => {
    // Reserve a real semantic hash, then model repeated abandoned reservations.
    let hash: string | undefined;
    mocks.append.mockImplementationOnce(async (_identity, input) => {
      hash = input.payload.commandHash;
      throw new Error("interrupted");
    });
    const create = () =>
      createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, []);
    await expect(create()).rejects.toThrow("interrupted");
    mocks.getOperation.mockImplementationOnce(async () => ({
      status: "cancelled",
      revision: 2,
      commandHash: hash,
    }));
    for (let i = 1; i < 8; i++)
      mocks.getOperation.mockImplementationOnce(async () => ({
        status: "cancelled",
        revision: i + 2,
        commandHash: hash,
      }));
    const failure = await create().catch((error) => error);
    expect(failure).toMatchObject({
      code: "appdata_operation_resume",
      status: 409,
      resumeOperationId: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    mocks.op = failure.resumeOperationId;
    mocks.getOperation.mockResolvedValue(null);
    expect(await create()).toEqual({ trackCount: 0 });
    expect(mocks.append.mock.calls.at(-1)?.[1].operationId).toBe(
      failure.resumeOperationId,
    );
  });
  it("retries a cancelled unstarted reservation through the same durable successor", async () => {
    let cancelledHash: string | undefined;
    mocks.append.mockImplementationOnce(async (_identity, input) => {
      cancelledHash = input.payload.commandHash;
      throw new Error("lost before upload");
    });
    const create = () =>
      createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, [
        t("a"),
      ]);
    await expect(create()).rejects.toThrow("lost");
    const lookup = mocks.getOperation.getMockImplementation();
    mocks.getOperation.mockImplementation(async (...args) =>
      args[1] === "create-1"
        ? { status: "cancelled", revision: 2, commandHash: cancelledHash }
        : lookup?.(...args),
    );
    expect(await create()).toEqual({ trackCount: 1 });
    expect(await create()).toEqual({ trackCount: 1 });
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append.mock.calls[1][1].operationId).not.toBe("create-1");
  });
  it("waits for a background tag upload and then applies the collection intent", async () => {
    vi.useFakeTimers();
    try {
      mocks.append.mockRejectedValueOnce(
        Object.assign(new Error("busy"), { code: "appdata_pending_write" }),
      );
      const saving = createPlaylistWithTracksRecord(
        user,
        { id: "p", name: "Saved" },
        [t("a")],
      );
      await vi.advanceTimersByTimeAsync(250);
      expect(await saving).toEqual({ trackCount: 1 });
      expect(mocks.append).toHaveBeenCalledTimes(2);
      expect(mocks.append.mock.calls[1][1].payload.playlists[0].tracks).toEqual(
        [t("a")],
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("creates ordered unique tracks and retries a lost response exactly once", async () => {
    const create = () =>
      createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, [
        t("second"),
        t("first"),
        t("second"),
      ]);
    expect(await create()).toEqual({ trackCount: 2 });
    expect(await create()).toEqual({ trackCount: 2 });
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(
      mocks.append.mock.calls[0][1].payload.playlists[0].tracks.map(
        (track: { fileId: string }) => track.fileId,
      ),
    ).toEqual(["second", "first"]);
  });
  it("retries the originally reserved body after a lost server response", async () => {
    let reserved: Record<string, unknown> | undefined;
    mocks.append.mockImplementationOnce(async (_identity, input) => {
      reserved = input;
      throw new Error("connection lost");
    });
    const create = () =>
      createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, [
        t("a"),
      ]);
    await expect(create()).rejects.toThrow("lost");
    mocks.read.mockImplementation(async () => ({
      envelopes: structuredClone(envelopes),
      revision: 2,
    }));
    mocks.getOperation.mockResolvedValue({
      operationId: "create-1",
      revision: 2,
      status: "uploading",
      commandHash: (reserved as { payload: { commandHash: string } }).payload
        .commandHash,
    });
    await create();
    expect(mocks.append.mock.calls[1][1]).toEqual(reserved);
  });
  it("rejects identifier reuse for different user intent", async () => {
    await createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, []);
    await expect(
      createPlaylistWithTracksRecord(user, { id: "p", name: "Changed" }, []),
    ).rejects.toThrow("already used");
  });
  it("enforces limits before writing a partial snapshot", async () => {
    await expect(
      createPlaylistWithTracksRecord(
        user,
        { id: "p", name: "Saved" },
        Array.from({ length: 501 }, (_, i) => t(String(i))),
      ),
    ).rejects.toBeInstanceOf(PlaylistLimitError);
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("reapplies explicit add to the latest revision after a peer removes a track", async () => {
    await createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, [
      t("a"),
      t("b"),
    ]);
    mocks.op = "add-1";
    const conflict = Object.assign(new Error("conflict"), {
      code: "appdata_revision_conflict",
    });
    mocks.append.mockImplementationOnce(async () => {
      envelopes.push({
        operationId: "peer-remove",
        kind: "collections",
        revision: 3,
        payload: {
          playlists: [{ id: "p", name: "Saved", tracks: [t("b")] }],
          favorites: [],
        },
      });
      throw conflict;
    });
    expect(await addPlaylistTracksRecords(user, "p", [t("c")])).toMatchObject({
      addedCount: 1,
    });
    const last = mocks.append.mock.calls.at(-1)?.[1];
    expect(
      last.payload.playlists[0].tracks.map(
        (track: { fileId: string }) => track.fileId,
      ),
    ).toEqual(["b", "c"]);
  });
  it("rejects a stale reorder without resurrecting membership", async () => {
    await createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, [
      t("b"),
    ]);
    mocks.op = "order-1";
    await expect(
      reorderPlaylistTracksRecords(user, "p", ["a", "b"]),
    ).rejects.toThrow("changed");
  });
  it("keeps intentional deletion when another command is applied later", async () => {
    await createPlaylistWithTracksRecord(user, { id: "p", name: "Saved" }, []);
    mocks.op = "delete-1";
    await deletePlaylistRecord(user, "p");
    expect(
      applyCollectionCommand(
        { playlists: [], favorites: [] },
        { type: "favorite", track: t("c"), enabled: true },
      ).payload.playlists,
    ).toEqual([]);
    expect(mocks.append.mock.calls.at(-1)?.[1].payload.playlists).toEqual([]);
  });
});
