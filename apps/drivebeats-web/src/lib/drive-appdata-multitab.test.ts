import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";

vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: {
    getState: () => ({
      setAccount: async () => {},
      restoreRecord: async () => true,
    }),
  },
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: {
    getState: () => ({
      accountId: "a",
      accountGeneration: "generation-a",
      rootFolders: [],
      rootFiles: [],
      bindAccount: () => {},
      hydrateRemoteRoots: () => {},
    }),
  },
}));

const clients: typeof import("./drive-appdata-client")[] = [];
function record(index: number): MetadataRecord {
  return {
    accountId: "a",
    fileId: `track-${index}`,
    fingerprint: JSON.stringify(["2026-10-23", "1234"]),
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    status: "ready",
    tags: { title: `Track ${index}` },
    checkedAt: 1,
    checkedFields: ["title", "artist", "album"],
    loadedVia: "drive_range",
  };
}
function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
async function tab() {
  vi.resetModules();
  const client = await import("./drive-appdata-client");
  const { useDriveAppDataStore: store } = await import(
    "@/stores/drive-appdata-store"
  );
  clients.push(client);
  await client.restoreDriveAppData("a", "generation-a");
  const database = await import("./metadata-cache-db");
  await vi.waitFor(async () => {
    expect(
      (await database.readPortableCache("a")).some(
        (entry) => entry.kind === "dirty",
      ),
    ).toBe(false);
  });
  return { client, store, database };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stopDriveAppData();
  vi.unstubAllGlobals();
});

it.each(["in_flight", "already_acknowledged"] as const)(
  "preserves another tab's newly appended tail when its previous draft is %s",
  async (timing) => {
    let accept!: () => void;
    let started!: () => void;
    const posted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const commands: {
      operationId: string;
      payload: { records: MetadataRecord[] };
    }[] = [];
    const acknowledged = new Set<string>();
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== "POST")
        return response({
          generation: "generation-a",
          revision: 0,
          envelopes: [],
        });
      const command = JSON.parse(String(options.body));
      commands.push(command);
      if (commands.length === 1) {
        started();
        await new Promise<void>((resolve) => {
          accept = resolve;
        });
      }
      for (const record of command.payload.records)
        acknowledged.add(record.fileId);
      return response({
        generation: "generation-a",
        revision: commands.length,
        operationId: command.operationId,
        savedAt: 1,
        bytes: 500,
      });
    });
    vi.stubGlobal("fetch", fetch);
    const producer = await tab();
    const peer = await tab();
    await producer.client.queuePortableMetadata(record(1));
    const firstId = (await producer.database.readPortableCache("a"))[0].id;
    const flushing = peer.client.flushDriveAppData();
    await posted;
    const sealed = await producer.database.readPortableCache("a");
    expect(sealed[0].sealed).toBe(true);
    expect(peer.store.getState().savedCount).toBe(0);
    if (timing === "already_acknowledged") {
      accept();
      await flushing;
    }
    await producer.client.queuePortableMetadata(record(2));
    const pendingTail = (await producer.database.readPortableCache("a")).find(
      (entry) => entry.id !== firstId,
    );
    expect(pendingTail).toBeDefined();
    if (!pendingTail) throw new Error("missing durable tail");
    expect(
      (
        pendingTail.payload as { payload: { records: MetadataRecord[] } }
      ).payload.records.map((record) => record.fileId),
    ).toEqual(["track-2"]);
    if (timing === "in_flight") {
      accept();
      await flushing;
    }
    expect(peer.store.getState().savedCount).toBe(1);
    const afterAck = await producer.database.readPortableCache("a");
    expect(afterAck.map((entry) => entry.id)).toEqual([pendingTail?.id]);
    expect(acknowledged).toEqual(new Set(["track-1"]));
    await producer.client.flushDriveAppData();
    expect(commands[1].operationId).not.toBe(firstId);
    expect(commands[1].payload.records.map((record) => record.fileId)).toEqual([
      "track-2",
    ]);
    expect(acknowledged).toEqual(new Set(["track-1", "track-2"]));
    expect(await producer.database.readPortableCache("a")).toEqual([]);
    expect(producer.store.getState().pendingCount).toBe(0);
  },
);

it("does not delete a changed stored payload for an older server acknowledgment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({ generation: "generation-a", revision: 0, envelopes: [] }),
    ),
  );
  const { client, database } = await tab();
  await client.queuePortableMetadata(record(1));
  const original = (await database.readPortableCache("a"))[0];
  const changed = {
    ...original,
    payload: {
      ...(original.payload as object),
      payload: { records: [record(1), record(2)] },
    },
  };
  await database.savePortableOutbox(changed);
  expect(
    await database.acknowledgePortableOutbox(original.id, original.payload),
  ).toBe(false);
  expect((await database.readPortableCache("a"))[0].payload).toEqual(
    changed.payload,
  );
});

it("uses the persisted winner when two tabs rebase one root command against different snapshots", async () => {
  let reads = 0;
  let originalPosts = 0;
  let acceptedBody: string | undefined;
  const accepted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== "POST") {
        reads++;
        return response({
          generation: "generation-a",
          revision: Math.max(0, reads - 2),
          envelopes: [],
        });
      }
      const body = String(options.body);
      const command = JSON.parse(body);
      if (command.baseRevision === 0 && originalPosts++ < 2)
        return new Response(
          JSON.stringify({ code: "appdata_revision_conflict" }),
          { status: 409 },
        );
      if (acceptedBody && acceptedBody !== body)
        throw new Error("appdata_operation_conflict");
      acceptedBody = body;
      accepted.push(body);
      return response({
        generation: "generation-a",
        revision: command.baseRevision + 1,
        operationId: command.operationId,
        savedAt: 1,
        bytes: body.length,
      });
    }),
  );
  const first = await tab();
  const second = await tab();
  await first.client.queueImportedRootOperations([
    { type: "remove", rootKind: "folder", id: "removed" },
  ]);
  await Promise.all([
    first.client.flushDriveAppData(),
    second.client.flushDriveAppData(),
  ]);
  expect(accepted).toHaveLength(2);
  expect(new Set(accepted).size).toBe(1);
  expect(await first.database.readPortableCache("a")).toEqual([]);
});

it("durably marks queue pressure and rescans the skipped local tail after capacity is freed", async () => {
  const saved = new Set<string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== "POST")
        return response({
          generation: "generation-a",
          revision: 0,
          envelopes: [],
        });
      const command = JSON.parse(String(options.body));
      for (const record of command.payload.records) saved.add(record.fileId);
      return response({
        generation: "generation-a",
        revision: saved.size,
        operationId: command.operationId,
        savedAt: 1,
        bytes: 500,
      });
    }),
  );
  const { client, database, store } = await tab();
  const operationId = "existing-full-capacity-batch";
  // Inject a capacity-sized existing batch so the ordinary public enqueue path
  // must exercise its real IndexedDB quota transaction and durable dirty marker.
  await database.savePortableOutbox({
    id: operationId,
    accountId: "a",
    generation: "generation-a",
    kind: "outbox",
    bytes: 8 * 1024 * 1024,
    payload: {
      operationId,
      generation: "generation-a",
      kind: "tags",
      payload: { records: [record(1)] },
    },
  });
  expect(await database.saveMetadataRecord(record(2), 0)).toBe(true);
  await client.queuePortableMetadata(record(2));
  expect(store.getState().error).toBe("backup_queue_full");
  expect(
    (await database.readPortableCache("a")).some(
      (entry) => entry.kind === "dirty",
    ),
  ).toBe(true);
  await client.flushDriveAppData();
  await vi.waitFor(() => {
    expect(store.getState()).toMatchObject({ savedCount: 1, pendingCount: 1 });
  });
  expect(saved).toEqual(new Set(["track-1"]));
  const tail = (await database.readPortableCache("a")).filter(
    (entry) => entry.kind === "outbox",
  );
  expect(tail).toHaveLength(1);
  expect(
    (
      tail[0].payload as { payload: { records: MetadataRecord[] } }
    ).payload.records.map((record) => record.fileId),
  ).toEqual(["track-2"]);
  await client.flushDriveAppData();
  expect(saved).toEqual(new Set(["track-1", "track-2"]));
  expect(store.getState()).toMatchObject({ savedCount: 2, pendingCount: 0 });
  expect(await database.readPortableCache("a")).toEqual([]);
});

it("keeps failed-restore notifications local and never permits missing metadata extraction", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("offline");
  });
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  const client = await import("./drive-appdata-client");
  clients.push(client);
  const { useDriveAppDataStore: store } = await import(
    "@/stores/drive-appdata-store"
  );
  const database = await import("./metadata-cache-db");
  await expect(client.restoreDriveAppData("a", "generation-a")).rejects.toThrow(
    "offline",
  );
  window.dispatchEvent(
    new CustomEvent("drivebeats-portable-metadata", { detail: record(1) }),
  );
  await vi.waitFor(async () => {
    expect(
      (await database.readPortableCache("a")).filter(
        (entry) => entry.kind === "outbox",
      ),
    ).toHaveLength(1);
    expect(store.getState().pendingCount).toBe(1);
  });
  expect(store.getState()).toMatchObject({
    status: "error",
    error: "offline",
    pendingCount: 1,
  });
  expect(await client.waitForDriveAppDataRestore("a")).toBe(false);
  await client.flushDriveAppData();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "preserves local remove/reimport order while respecting a newer peer removal (peer=%s)",
  async (peerRemoval) => {
    let revision = 5;
    const envelopes: unknown[] = [];
    const accepted: {
      kind: string;
      payload: { operations?: { type: string; id: string }[] };
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method !== "POST")
          return response({ generation: "generation-a", revision, envelopes });
        const command = JSON.parse(String(options.body));
        if (command.baseRevision !== revision)
          return new Response(
            JSON.stringify({ code: "appdata_revision_conflict" }),
            { status: 409 },
          );
        revision++;
        const committedRevision = revision;
        accepted.push(command);
        envelopes.push({ ...command, format: 1, accountId: "a", revision });
        if (peerRemoval && accepted.length === 1) {
          revision++;
          envelopes.push({
            format: 1,
            accountId: "a",
            generation: "generation-a",
            operationId: "peer-removal",
            revision,
            kind: "roots",
            payload: {
              operations: [
                { type: "remove", rootKind: "folder", id: "folder" },
              ],
            },
          });
        }
        return response({
          generation: "generation-a",
          revision: committedRevision,
          operationId: command.operationId,
          savedAt: 1,
          bytes: 100,
        });
      }),
    );
    const { client, database } = await tab();
    const folder = {
      id: "folder",
      name: "Music",
      mimeType: "application/vnd.google-apps.folder",
    };
    await client.queueImportedRootOperations([
      { type: "remove", rootKind: "folder", id: folder.id },
    ]);
    await client.queueImportedRootOperations([
      { type: "add", rootKind: "folder", id: folder.id, descriptor: folder },
    ]);
    await client.flushDriveAppData();
    expect(
      accepted.map((command) => command.payload.operations?.[0].type),
    ).toEqual(peerRemoval ? ["remove"] : ["remove", "add"]);
    expect(await database.readPortableCache("a")).toEqual([]);
  },
);

it("creates one durable successor when two tabs retry the same cancelled reservation", async () => {
  let originalId = "";
  let cancelledPosts = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== "POST")
        return response({
          generation: "generation-a",
          revision: 0,
          envelopes: [],
        });
      const command = JSON.parse(String(options.body));
      if (command.operationId === originalId) {
        if (++cancelledPosts === 2) release();
        await both;
        return new Response(
          JSON.stringify({ code: "appdata_operation_cancelled" }),
          { status: 409 },
        );
      }
      accepted.push(command.operationId);
      return response({
        generation: "generation-a",
        revision: 1,
        operationId: command.operationId,
        savedAt: 1,
        bytes: 100,
      });
    }),
  );
  const first = await tab();
  const second = await tab();
  await first.client.queuePortableMetadata(record(1));
  originalId = (await first.database.readPortableCache("a"))[0].id;
  await Promise.all([
    first.client.flushDriveAppData(),
    second.client.flushDriveAppData(),
  ]);
  expect(cancelledPosts).toBe(2);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).not.toBe(originalId);
  expect(await first.database.readPortableCache("a")).toEqual([]);
});

it("preserves the successor ID across a lost response after cancelled-reservation recovery", async () => {
  let originalId = "";
  const successors: string[] = [];
  let lose = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== "POST")
        return response({
          generation: "generation-a",
          revision: 0,
          envelopes: [],
        });
      const command = JSON.parse(String(options.body));
      if (command.operationId === originalId)
        return new Response(
          JSON.stringify({ code: "appdata_operation_cancelled" }),
          { status: 409 },
        );
      successors.push(command.operationId);
      if (lose) {
        lose = false;
        throw new Error("response_lost");
      }
      return response({
        generation: "generation-a",
        revision: 1,
        operationId: command.operationId,
        savedAt: 1,
        bytes: 100,
      });
    }),
  );
  const first = await tab();
  await first.client.queuePortableMetadata(record(1));
  originalId = (await first.database.readPortableCache("a"))[0].id;
  await expect(first.client.flushDriveAppData()).rejects.toThrow(
    "response_lost",
  );
  const pending = await first.database.readPortableCache("a");
  expect(pending).toHaveLength(1);
  expect(pending[0].id).not.toBe(originalId);
  await first.client.stopDriveAppData();
  const resumed = await tab();
  await resumed.client.flushDriveAppData();
  expect(successors).toEqual([pending[0].id, pending[0].id]);
  expect(await resumed.database.readPortableCache("a")).toEqual([]);
});
