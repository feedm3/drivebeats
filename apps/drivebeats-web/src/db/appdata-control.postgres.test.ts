// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AppDataError,
  type AppDataIdentity,
  claimAppDataMigration,
  getAppDataAccount,
  initializeAppDataAccount,
  isAppDataLegacySourceAvailable,
} from "@/db/appdata-control";
import { appDataControl } from "@/lib/appdata-control-service";
import { createDriveAppDataService } from "@/lib/drive-appdata-service";
import type { AppDataTransport } from "@/lib/drive-appdata-transport";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
} from "@/lib/metadata-cache-types";

const fixture = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("@/db/client", () => ({
  getSql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce(
        (text, part, index) => text + (index ? `$${index}` : "") + part,
        "",
      );
      if (!fixture.db) throw new Error("Database not initialized");
      return (await fixture.db.query(query, values)).rows;
    },
}));

function memoryDrive() {
  const files = new Map<string, string>();
  let next = 1;
  const transport: AppDataTransport = {
    generateId: vi.fn(async () => `generated_${next++}`),
    list: vi.fn(async () => [...files.keys()].map((id) => ({ id }))),
    read: vi.fn(async (id) => files.get(id) ?? null),
    create: vi.fn(async (id, json) => {
      files.set(id, json);
    }),
    delete: vi.fn(async (id) => {
      files.delete(id);
    }),
  };
  return {
    files,
    transport,
    service: createDriveAppDataService({ control: appDataControl, transport }),
  };
}
const empty = { playlists: [], favorites: [] };
async function ready(id = "account-a") {
  const account = await initializeAppDataAccount(id);
  const identity = { accountId: id, generation: account.generation };
  await claimAppDataMigration(identity);
  const drive = memoryDrive();
  await drive.service.append(identity, {
    kind: "migration",
    operationId: "migration-v1",
    baseRevision: 0,
    payload: empty,
  });
  return { ...drive, identity };
}

describe("durable app-data coordination against PostgreSQL", () => {
  beforeAll(async () => {
    fixture.db = new PGlite();
    const folder = resolve(process.cwd(), "../../db/migrations");
    for (const name of (await readdir(folder))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await fixture.db.exec(await readFile(resolve(folder, name), "utf8"));
    }
  }, 30_000);
  beforeEach(async () => {
    await fixture.db?.exec(
      "TRUNCATE appdata_operations,appdata_accounts,appdata_rollout,users CASCADE",
    );
  });
  afterAll(async () => {
    await fixture.db?.close();
  });

  it("reuses an acknowledged operation after response loss and rejects changed bodies", async () => {
    const { service, identity, transport } = await ready();
    const input = {
      kind: "roots",
      operationId: "remove-folder",
      baseRevision: 1,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "music" }],
      },
    };
    const first = await service.append(identity, input);
    expect(await service.append(identity, input)).toEqual(first);
    expect(transport.create).toHaveBeenCalledTimes(2); // initialization and one root removal
    await expect(
      service.append(identity, {
        ...input,
        payload: {
          operations: [{ type: "remove", rootKind: "folder", id: "other" }],
        },
      }),
    ).rejects.toThrow("appdata_operation_conflict");
    expect((await service.read(identity)).envelopes).toHaveLength(2);
  });

  it("accepts one concurrent authoritative revision and rejects stale resurrection", async () => {
    const { service, identity } = await ready();
    const input = {
      kind: "roots",
      baseRevision: 1,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "music" }],
      },
    };
    const results = await Promise.allSettled([
      service.append(identity, { ...input, operationId: "peer-a" }),
      service.append(identity, { ...input, operationId: "peer-b" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      service.append(identity, {
        ...input,
        operationId: "stale-add",
        payload: {
          operations: [
            {
              type: "add",
              rootKind: "folder",
              id: "music",
              descriptor: {
                id: "music",
                name: "Music",
                mimeType: "application/vnd.google-apps.folder",
              },
            },
          ],
        },
      }),
    ).rejects.toThrow("appdata_revision_conflict");
  });

  it("restores arbitrary disjoint completed tag subsets and rejects cross-account or future data", async () => {
    const { service, identity, transport, files } = await ready();
    const records = Array.from({ length: 17 }, (_, index) => ({
      accountId: identity.accountId,
      fileId: `track-${index}`,
      fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
      parserVersion: METADATA_PARSER_VERSION,
      policyVersion: METADATA_POLICY_VERSION,
      schemaVersion: METADATA_SCHEMA_VERSION,
      checkedAt: 1,
      checkedFields: ["title", "artist", "album"],
      status: index % 2 ? "ready" : "no_target_tags",
      tags: index % 2 ? { title: `Title ${index}` } : {},
      loadedVia: "drive_range",
    }));
    await service.append(identity, {
      kind: "tags",
      operationId: "subset-three",
      payload: { records: records.slice(0, 3) },
    });
    await service.append(identity, {
      kind: "tags",
      operationId: "subset-fourteen",
      payload: { records: records.slice(3) },
    });
    const restored = await service.read(identity);
    expect(
      restored.envelopes
        .filter((item) => item.kind === "tags")
        .flatMap((item) => (item.kind === "tags" ? item.payload.records : [])),
    ).toHaveLength(17);
    expect(transport.create).toHaveBeenCalledTimes(3);
    await expect(
      service.append(identity, {
        kind: "tags",
        operationId: "wrong-account",
        payload: { records: [{ ...records[0], accountId: "other-account" }] },
      }),
    ).rejects.toThrow("appdata_account_mismatch");
    await expect(
      service.append(identity, {
        kind: "tags",
        operationId: "future",
        payload: { records: [{ ...records[0], schemaVersion: 999 }] },
      }),
    ).rejects.toThrow("appdata_invalid_payload");
    const accountB = await initializeAppDataAccount("account-b");
    expect(
      (
        await service.read({
          accountId: accountB.accountId,
          generation: accountB.generation,
        })
      ).envelopes,
    ).toEqual([]);
    const savedId = [...files.keys()][1];
    files.set(savedId, "{corrupt");
    await expect(service.read(identity)).rejects.toThrow(
      "appdata_invalid_saved_file",
    );
    expect(files.size).toBe(3);
  });

  it("retains deletion fence until an already accepted upload actually finishes", async () => {
    const { service, identity, transport, files } = await ready();
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(transport.create).mockImplementationOnce(async (id, json) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      files.set(id, json);
    });
    const input = {
      kind: "collections",
      operationId: "writing",
      baseRevision: 1,
      payload: empty,
    };
    const writing = service.append(identity, input);
    await begun;
    await expect(service.append(identity, input)).rejects.toThrow(
      "appdata_pending_write",
    );
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    await expect(
      service.append(identity, {
        kind: "collections",
        operationId: "stale",
        baseRevision: 2,
        payload: empty,
      }),
    ).rejects.toThrow("appdata_pending_write");
    release();
    await writing;
    await service.delete(identity);
    expect(files.size).toBe(0);
    await appDataControl.finishDeletion(identity);
    const recreated = await initializeAppDataAccount(identity.accountId);
    expect(recreated.generation).not.toBe(identity.generation);
    await expect(service.read(identity)).rejects.toThrow(
      "appdata_stale_session",
    );
  });

  it("recovers a saved uncertain object but never claims an unresolved writer was drained", async () => {
    const { service, identity, transport, files } = await ready();
    vi.mocked(transport.create).mockImplementationOnce(async (id, json) => {
      files.set(id, json);
      throw new Error("connection lost after acceptance");
    });
    const input = {
      kind: "collections",
      operationId: "uncertain",
      baseRevision: 1,
      payload: empty,
    };
    await expect(service.append(identity, input)).rejects.toThrow(
      "connection lost",
    );
    expect(await service.append(identity, input)).toMatchObject({
      operationId: "uncertain",
      revision: 2,
    });
    expect(transport.create).toHaveBeenCalledTimes(2);
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    expect(files.size).toBe(2);
  });

  it("reconciles a server crash after provider acceptance without issuing another POST", async () => {
    const { service, identity, transport } = await ready();
    const finish = vi
      .spyOn(appDataControl, "complete")
      .mockRejectedValueOnce(
        new Error("process stopped before acknowledgement"),
      );
    const input = {
      kind: "collections",
      operationId: "crash",
      baseRevision: 1,
      payload: empty,
    };
    await expect(service.append(identity, input)).rejects.toThrow(
      "process stopped",
    );
    expect(await service.append(identity, input)).toMatchObject({
      operationId: "crash",
      revision: 2,
    });
    expect(transport.create).toHaveBeenCalledTimes(2);
    await service.delete(identity);
    finish.mockRestore();
  });

  it("fences legacy writes at claim, permits deletion cascades, and preserves auth/control rows independently", async () => {
    await fixture.db?.exec(
      "INSERT INTO users(google_user_id,email) VALUES('legacy','test@example.invalid'); INSERT INTO playlists(id,user_google_id,name) VALUES('playlist','legacy','Original'); INSERT INTO playlist_tracks(playlist_id,file_id,position,file_name) VALUES('playlist','track',0,'Track')",
    );
    const account = await initializeAppDataAccount("legacy");
    const identity: AppDataIdentity = {
      accountId: "legacy",
      generation: account.generation,
    };
    expect(await claimAppDataMigration(identity)).toBe(true);
    expect(await claimAppDataMigration(identity)).toBe(false);
    await expect(
      fixture.db?.exec("UPDATE playlists SET name='Stale' WHERE id='playlist'"),
    ).rejects.toThrow("appdata_legacy_fenced");
    await expect(
      fixture.db?.exec(
        "INSERT INTO favorite_tracks(user_google_id,file_id,file_name,is_favorite) VALUES('legacy','track','Track',TRUE)",
      ),
    ).rejects.toThrow("appdata_legacy_fenced");
    await appDataControl.fence(identity);
    await fixture.db?.exec("DELETE FROM users WHERE google_user_id='legacy'");
    expect((await getAppDataAccount("legacy"))?.state).toBe("deleting");
  });

  it("uses the database cutoff and initializes late users without legacy collections", async () => {
    await fixture.db?.exec(
      "INSERT INTO appdata_rollout(implemented_at,cleanup_due_at) VALUES(now()-interval '31 days',now()-interval '1 day')",
    );
    expect(await isAppDataLegacySourceAvailable()).toBe(false);
    const account = await initializeAppDataAccount("late");
    const identity = { accountId: "late", generation: account.generation };
    await claimAppDataMigration(identity);
    const { service } = memoryDrive();
    await expect(
      service.append(identity, {
        kind: "migration",
        operationId: "legacy",
        baseRevision: 0,
        payload: {
          playlists: [{ id: "p", name: "Old", tracks: [] }],
          favorites: [],
        },
      }),
    ).rejects.toThrow("appdata_legacy_cutoff");
    await service.append(identity, {
      kind: "migration",
      operationId: "late-empty",
      baseRevision: 0,
      payload: empty,
    });
    expect(await getAppDataAccount("late")).toMatchObject({
      source: "drive",
      migrationVersion: 1,
    });
  });

  it("cancels a legacy snapshot finishing after cutoff instead of publishing it", async () => {
    const account = await initializeAppDataAccount("slow");
    const identity = { accountId: "slow", generation: account.generation };
    await claimAppDataMigration(identity);
    const { service, transport, files } = memoryDrive();
    vi.mocked(transport.create).mockImplementationOnce(async (id, json) => {
      files.set(id, json);
      await fixture.db?.exec(
        "INSERT INTO appdata_rollout(implemented_at,cleanup_due_at) VALUES(now()-interval '31 days',now()-interval '1 day')",
      );
    });
    await expect(
      service.append(identity, {
        kind: "migration",
        operationId: "before-cutoff",
        baseRevision: 0,
        payload: {
          playlists: [{ id: "p", name: "Old", tracks: [] }],
          favorites: [],
        },
      }),
    ).rejects.toThrow("appdata_legacy_cutoff");
    expect((await getAppDataAccount("slow"))?.source).toBe("migrating");
    await service.append(identity, {
      kind: "migration",
      operationId: "empty-after-cutoff",
      baseRevision: 1,
      payload: empty,
    });
    expect(
      (await service.read(identity)).envelopes.map((item) => item.operationId),
    ).toEqual(["empty-after-cutoff"]);
  });

  it("atomically deletes credentials and the account or rolls both back", async () => {
    const { service, identity } = await ready();
    await fixture.db?.exec(
      "INSERT INTO users(google_user_id,email) VALUES('account-a','test@example.invalid'); INSERT INTO google_oauth_grants(google_user_id,encrypted_refresh_token) VALUES('account-a','isolated-test'); CREATE FUNCTION reject_test_tombstone() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='deleted' THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_tombstone BEFORE UPDATE ON appdata_accounts FOR EACH ROW EXECUTE FUNCTION reject_test_tombstone()",
    );
    await service.delete(identity);
    await expect(appDataControl.finishDeletion(identity)).rejects.toThrow(
      "appdata_control_unavailable",
    );
    expect(
      (
        await fixture.db?.query(
          "SELECT google_user_id FROM google_oauth_grants",
        )
      )?.rows,
    ).toHaveLength(1);
    expect((await getAppDataAccount(identity.accountId))?.state).toBe(
      "deleting",
    );
    await fixture.db?.exec(
      "DROP TRIGGER reject_test_tombstone ON appdata_accounts; DROP FUNCTION reject_test_tombstone()",
    );
    await appDataControl.finishDeletion(identity);
    expect(
      (
        await fixture.db?.query(
          "SELECT google_user_id FROM google_oauth_grants",
        )
      )?.rows,
    ).toEqual([]);
    expect((await getAppDataAccount(identity.accountId))?.state).toBe(
      "deleted",
    );
  });

  it("resets a verified hidden-data deletion to a new empty-only incarnation preserving credentials", async () => {
    const { service, identity } = await ready();
    await fixture.db?.exec(
      "INSERT INTO users(google_user_id,email) VALUES('account-a','test@example.invalid'); INSERT INTO google_oauth_grants(google_user_id,encrypted_refresh_token) VALUES('account-a','isolated-test')",
    );
    await expect(appDataControl.resetAccount(identity)).rejects.toThrow(
      "appdata_stale_session",
    );
    await service.delete(identity);
    const reset = await appDataControl.resetAccount(identity);
    expect(reset).toMatchObject({
      state: "active",
      source: "migrating",
      revision: 0,
      migrationVersion: -1,
    });
    expect(reset.generation).not.toBe(identity.generation);
    const fresh = { accountId: reset.accountId, generation: reset.generation };
    await expect(
      service.append(fresh, {
        kind: "migration",
        operationId: "stale-neon",
        baseRevision: 0,
        payload: {
          playlists: [{ id: "p", name: "Old", tracks: [] }],
          favorites: [],
        },
      }),
    ).rejects.toThrow("appdata_reset_requires_empty");
    await service.append(fresh, {
      kind: "migration",
      operationId: "reset-empty",
      baseRevision: 0,
      payload: empty,
    });
    await expect(service.read(identity)).rejects.toThrow(
      "appdata_stale_session",
    );
    expect(
      (
        await fixture.db?.query(
          "SELECT google_user_id FROM google_oauth_grants",
        )
      )?.rows,
    ).toHaveLength(1);
    expect((await service.read(fresh)).envelopes).toHaveLength(1);
  });

  it("prunes superseded collection bodies while retaining old command receipts and retry identity", async () => {
    const { service, identity, files, transport } = await ready();
    for (let index = 0; index < 20; index++) {
      await service.append(identity, {
        kind: "collections",
        operationId: `collection-${index}`,
        baseRevision: index + 1,
        payload: {
          ...empty,
          commandHash: index.toString(16).padStart(64, "0"),
          result: { addedCount: index },
        },
      });
    }
    expect(files.size).toBe(1);
    expect(
      (await service.read(identity)).envelopes.map((item) => item.operationId),
    ).toEqual(["collection-19"]);
    expect(await service.getOperation(identity, "collection-0")).toMatchObject({
      status: "superseded",
      commandHash: "0".repeat(64),
      result: { addedCount: 0 },
    });
    expect(
      await service.append(identity, {
        kind: "collections",
        operationId: "collection-0",
        baseRevision: 1,
        payload: {
          ...empty,
          commandHash: "0".repeat(64),
          result: { addedCount: 0 },
        },
      }),
    ).toMatchObject({ revision: 2 });
    expect(transport.create).toHaveBeenCalledTimes(21);
  });

  it("retains every unique completed tag when automatically combining whole batches", async () => {
    const { service, identity, files } = await ready();
    for (let index = 0; index < 64; index++) {
      const record = {
        accountId: identity.accountId,
        fileId: `track-${index}`,
        fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
        checkedAt: 1,
        checkedFields: ["title", "artist", "album"],
        status: "ready",
        tags: { title: `Title ${index}` },
        loadedVia: "drive_range",
      };
      await service.append(identity, {
        kind: "tags",
        operationId: `small-batch-${index}`,
        payload: { records: [record] },
      });
    }
    const tags = (await service.read(identity)).envelopes.filter(
      (item) => item.kind === "tags",
    );
    expect(tags).toHaveLength(1);
    expect(
      tags.flatMap((item) =>
        item.kind === "tags" ? item.payload.records : [],
      ),
    ).toHaveLength(64);
    expect(files.size).toBe(2);
  }, 30_000);

  it("compacts root tombstones without changing their original accepted revision", async () => {
    const { service, identity, files } = await ready();
    for (let index = 0; index < 64; index++) {
      const revision = (await service.read(identity)).revision;
      const operation =
        index % 2
          ? { type: "remove", rootKind: "folder", id: "music" }
          : {
              type: "add",
              rootKind: "folder",
              id: "music",
              descriptor: {
                id: "music",
                name: "Music",
                mimeType: "application/vnd.google-apps.folder",
              },
            };
      await service.append(identity, {
        kind: "roots",
        operationId: `root-event-${index}`,
        baseRevision: revision,
        payload: { operations: [operation] },
      });
    }
    const roots = (await service.read(identity)).envelopes.filter(
      (item) => item.kind === "roots",
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].payload.operations).toEqual([
      { type: "remove", rootKind: "folder", id: "music", sourceRevision: 65 },
    ]);
    expect(files.size).toBe(2);
  }, 30_000);

  it("can read, mutate and delete after more than ten thousand superseded receipts", async () => {
    const { service, identity, transport } = await ready();
    await fixture.db?.query(
      "INSERT INTO appdata_operations(account_id,generation,operation_id,revision,kind,body_hash,file_id,bytes,status,file_deleted) SELECT $1,$2::uuid,'history-'||n,n+1,'collections',repeat('a',64),'old-'||n,10,'superseded',TRUE FROM generate_series(1,10001) AS n",
      [identity.accountId, identity.generation],
    );
    await fixture.db?.exec(
      "UPDATE appdata_accounts SET revision=10002 WHERE account_id='account-a'",
    );
    expect((await service.read(identity)).envelopes).toHaveLength(1);
    await service.append(identity, {
      kind: "collections",
      operationId: "new-after-history",
      baseRevision: 10002,
      payload: empty,
    });
    await service.delete(identity);
    expect(transport.list).toHaveBeenCalledWith({ forDeletion: true });
    await appDataControl.finishDeletion(identity);
    expect((await getAppDataAccount(identity.accountId))?.state).toBe(
      "deleted",
    );
  });

  it("retries a definitively rejected collection reservation with its original base revision", async () => {
    const { service, identity, transport } = await ready();
    const input = {
      kind: "collections",
      operationId: "quota-retry",
      baseRevision: 1,
      payload: {
        ...empty,
        commandHash: "a".repeat(64),
        result: { addedCount: 2 },
      },
    };
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_storage_full"),
    );
    await expect(service.append(identity, input)).rejects.toThrow(
      "appdata_storage_full",
    );
    const snapshot = await service.read(identity);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.pendingOperations).toEqual([
      { operationId: "quota-retry", revision: 2, kind: "collections" },
    ]);
    await expect(
      service.append(identity, { ...input, baseRevision: 2 }),
    ).rejects.toThrow("appdata_operation_conflict");
    await service.append(identity, input);
    expect((await service.read(identity)).pendingOperations).toEqual([]);
  });

  it("keeps all source batches if compaction finalization fails and retries safely", async () => {
    const { service, identity, files } = await ready();
    for (let index = 0; index < 64; index++) {
      const record = {
        accountId: identity.accountId,
        fileId: `track-${index}`,
        fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
        checkedAt: 1,
        checkedFields: ["title", "artist", "album"],
        status: "ready",
        tags: { title: `Title ${index}` },
        loadedVia: "drive_range",
      };
      await service.append(
        identity,
        {
          kind: "tags",
          operationId: `source-${index}`,
          payload: { records: [record] },
        },
        { skipCompaction: true },
      );
    }
    await fixture.db?.exec(
      "CREATE FUNCTION reject_compaction_commit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='superseded' AND OLD.status='committed' THEN RAISE EXCEPTION 'isolated interruption'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_compaction_commit BEFORE UPDATE ON appdata_operations FOR EACH ROW EXECUTE FUNCTION reject_compaction_commit()",
    );
    await expect(service.compact(identity, "tags")).rejects.toThrow(
      "appdata_control_unavailable",
    );
    expect(
      (await service.read(identity)).envelopes.filter(
        (item) => item.kind === "tags",
      ),
    ).toHaveLength(64);
    expect(files.size).toBe(66);
    await fixture.db?.exec(
      "DROP TRIGGER reject_compaction_commit ON appdata_operations; DROP FUNCTION reject_compaction_commit()",
    );
    const pending = (await appDataControl.listPending(identity))[0];
    const envelope = JSON.parse(files.get(pending.fileId) as string);
    const {
      format: _format,
      accountId: _account,
      generation: _generation,
      revision: _revision,
      ...input
    } = envelope;
    await service.append(identity, input);
    await service.compact(identity, "tags");
    const tags = (await service.read(identity)).envelopes.filter(
      (item) => item.kind === "tags",
    );
    expect(tags).toHaveLength(1);
    expect(
      tags.flatMap((item) =>
        item.kind === "tags" ? item.payload.records : [],
      ),
    ).toHaveLength(64);
    expect(files.size).toBe(2);
  });

  it("never retires sources when a peer changes roots during compaction", async () => {
    const { service, identity, transport, files } = await ready();
    for (let index = 0; index < 64; index++) {
      await service.append(
        identity,
        {
          kind: "roots",
          operationId: `source-${index}`,
          baseRevision: index + 1,
          payload: {
            operations: [{ type: "remove", rootKind: "folder", id: "music" }],
          },
        },
        { skipCompaction: true },
      );
    }
    vi.mocked(transport.read).mockImplementationOnce(async (id) => {
      await service.append(
        identity,
        {
          kind: "roots",
          operationId: "peer-import",
          baseRevision: 65,
          payload: {
            operations: [
              {
                type: "add",
                rootKind: "folder",
                id: "music",
                descriptor: {
                  id: "music",
                  name: "Peer import",
                  mimeType: "application/vnd.google-apps.folder",
                },
              },
            ],
          },
        },
        { skipCompaction: true },
      );
      return files.get(id) ?? null;
    });
    await expect(service.compact(identity, "roots")).rejects.toThrow(
      "appdata_revision_conflict",
    );
    expect(
      (await service.read(identity)).envelopes.filter(
        (item) => item.kind === "roots",
      ),
    ).toHaveLength(65);
    await service.compact(identity, "roots");
    const roots = (await service.read(identity)).envelopes.filter(
      (item) => item.kind === "roots",
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].payload.operations[0]).toMatchObject({
      type: "add",
      sourceRevision: 66,
      descriptor: { name: "Peer import" },
    });
    expect(files.size).toBe(2);
  });

  it("returns the original saved acknowledgement after compaction removed its tag source file", async () => {
    const { service, identity, files, transport } = await ready();
    let original: unknown;
    let acknowledged: unknown;
    for (let index = 0; index < 64; index++) {
      const record = {
        accountId: identity.accountId,
        fileId: `track-${index}`,
        fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
        checkedAt: 1,
        checkedFields: ["title", "artist", "album"],
        status: "ready",
        tags: { title: `Title ${index}` },
        loadedVia: "drive_range",
      };
      const input = {
        kind: "tags",
        operationId: `source-${index}`,
        payload: { records: [record] },
      };
      const result = await service.append(identity, input);
      if (index === 0) {
        original = input;
        acknowledged = result;
      }
    }
    expect((await service.getOperation(identity, "source-0"))?.status).toBe(
      "superseded",
    );
    const posts = vi.mocked(transport.create).mock.calls.length;
    expect(await service.append(identity, original)).toEqual(acknowledged);
    expect(transport.create).toHaveBeenCalledTimes(posts);
    expect(files.size).toBe(2);
  }, 30_000);

  it("rejects a backup exceeding supported live bytes before provider upload, retaining the saved subset", async () => {
    const { service, identity, transport } = await ready();
    // Exercise the database aggregate near its byte limit without allocating a
    // 48MiB music-data fixture: existing verified objects remain valid JSON.
    for (let index = 0; index < 3; index++) {
      await service.append(identity, {
        kind: "roots",
        operationId: `large-source-${index}`,
        baseRevision: index + 1,
        payload: {
          operations: [
            { type: "remove", rootKind: "folder", id: `root-${index}` },
          ],
        },
      });
    }
    await fixture.db?.exec(
      "UPDATE appdata_operations SET bytes=16773120 WHERE kind='roots'",
    );
    const records = Array.from({ length: 30 }, (_, index) => ({
      accountId: identity.accountId,
      fileId: `new-${index}`,
      fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
      parserVersion: METADATA_PARSER_VERSION,
      policyVersion: METADATA_POLICY_VERSION,
      schemaVersion: METADATA_SCHEMA_VERSION,
      checkedAt: 1,
      checkedFields: ["title", "artist", "album"],
      status: "ready",
      tags: { title: "x".repeat(500) },
      loadedVia: "drive_range",
    }));
    const posts = vi.mocked(transport.create).mock.calls.length;
    await expect(
      service.append(identity, {
        kind: "tags",
        operationId: "beyond-capacity",
        payload: { records },
      }),
    ).rejects.toThrow("appdata_backup_capacity");
    expect(transport.create).toHaveBeenCalledTimes(posts);
    expect((await service.read(identity)).envelopes).toHaveLength(4);
    expect(await service.getOperation(identity, "beyond-capacity")).toBeNull();
  });

  it("resumes a definitively rejected server checkpoint with the same ID and original revision", async () => {
    const { service, identity, transport } = await ready();
    for (let index = 0; index < 64; index++) {
      const record = {
        accountId: identity.accountId,
        fileId: `track-${index}`,
        fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
        checkedAt: 1,
        checkedFields: ["title", "artist", "album"],
        status: "ready",
        tags: { title: `Title ${index}` },
        loadedVia: "drive_range",
      };
      await service.append(
        identity,
        {
          kind: "tags",
          operationId: `source-${index}`,
          payload: { records: [record] },
        },
        { skipCompaction: true },
      );
    }
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_storage_full"),
    );
    await expect(service.compact(identity, "tags")).rejects.toThrow(
      "appdata_storage_full",
    );
    expect((await appDataControl.listPending(identity))[0]).toMatchObject({
      kind: "tags",
      status: "reserved",
      revision: 66,
    });
    const restored = await service.read(identity);
    expect(restored.pendingOperations).toEqual([]);
    expect(
      restored.envelopes.filter((item) => item.kind === "tags"),
    ).toHaveLength(1);
    const attempts = vi.mocked(transport.create).mock.calls.slice(-2);
    expect(attempts[0][0]).toBe(attempts[1][0]);
    expect(attempts[0][1]).toBe(attempts[1][1]);
  }, 30_000);

  it("cancels abandoned unstarted reservations without permitting their old uploader to start", async () => {
    const { service, identity, transport } = await ready();
    const abandoned = {
      kind: "collections",
      operationId: "abandoned",
      baseRevision: 1,
      payload: empty,
    };
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_storage_full"),
    );
    await expect(service.append(identity, abandoned)).rejects.toThrow(
      "appdata_storage_full",
    );
    const head = await service.readCollections(identity);
    await service.append(identity, {
      kind: "collections",
      operationId: "replacement",
      baseRevision: head.revision,
      payload: empty,
    });
    expect((await service.getOperation(identity, "abandoned"))?.status).toBe(
      "cancelled",
    );
    expect(await appDataControl.startUpload(identity, "abandoned")).toBeNull();
    await expect(service.append(identity, abandoned)).rejects.toThrow(
      "appdata_operation_cancelled",
    );
    await service.delete(identity);
  });

  it("retries an uncertain absent immutable object without losing the old request's deletion fence", async () => {
    const { service, identity, transport } = await ready();
    const input = {
      kind: "collections",
      operationId: "retry-unknown",
      baseRevision: 1,
      payload: empty,
    };
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_provider_uncertain"),
    );
    await expect(service.append(identity, input)).rejects.toThrow(
      "appdata_provider_uncertain",
    );
    expect(await service.append(identity, input)).toMatchObject({
      operationId: "retry-unknown",
      revision: 2,
    });
    const attempts = vi.mocked(transport.create).mock.calls.slice(-2);
    expect(attempts[0][0]).toBe(attempts[1][0]);
    await service.append(identity, {
      kind: "roots",
      operationId: "later-save",
      baseRevision: 2,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "old" }],
      },
    });
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
  });

  it("settles only the actual upload callback after duplicate callers acknowledge an already existing object", async () => {
    const { service, identity, transport, files } = await ready();
    let finish!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(transport.create).mockImplementationOnce(async (id, json) => {
      files.set(id, json);
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const input = {
      kind: "collections",
      operationId: "slow-response",
      baseRevision: 1,
      payload: empty,
    };
    const original = service.append(identity, input);
    await begun;
    expect(await service.append(identity, input)).toMatchObject({
      revision: 2,
    });
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    finish();
    await original;
    await service.delete(identity);
    expect(files.size).toBe(0);
  });

  it("returns the latest collection with one media read and bounds full restore concurrency", async () => {
    const { service, identity, transport, files } = await ready();
    for (let index = 0; index < 17; index++) {
      const record = {
        accountId: identity.accountId,
        fileId: `track-${index}`,
        fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
        checkedAt: 1,
        checkedFields: ["title", "artist", "album"],
        status: "ready",
        tags: { title: `Title ${index}` },
        loadedVia: "drive_range",
      };
      await service.append(
        identity,
        {
          kind: "tags",
          operationId: `batch-${index}`,
          payload: { records: [record] },
        },
        { skipCompaction: true },
      );
    }
    vi.mocked(transport.read).mockClear();
    expect((await service.readCollections(identity)).envelopes).toHaveLength(1);
    expect(transport.read).toHaveBeenCalledTimes(1);
    let active = 0,
      peak = 0;
    vi.mocked(transport.read).mockImplementation(async (id) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return files.get(id) ?? null;
    });
    const restored = await service.read(identity);
    expect(restored.envelopes).toHaveLength(18);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("keeps a failed remote reset retryable after the account is fenced", async () => {
    const { service, identity, transport } = await ready();
    vi.mocked(transport.list).mockRejectedValueOnce(
      new AppDataError("appdata_provider_unavailable"),
    );
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_provider_unavailable",
    );
    expect((await getAppDataAccount(identity.accountId))?.state).toBe(
      "deleting",
    );
    await expect(service.read(identity)).rejects.toThrow(
      "appdata_deletion_in_progress",
    );
    await service.delete(identity);
    const reset = await appDataControl.resetAccount(identity);
    expect(reset.generation).not.toBe(identity.generation);
  });

  it("does not reuse a committed unresolved compaction ID for a different batch", async () => {
    const { service, identity, transport, files } = await ready();
    const record = (index: number) => ({
      accountId: identity.accountId,
      fileId: `track-${index}`,
      fingerprint: JSON.stringify(["2026-10-23T00:00:00Z", "42"]),
      parserVersion: METADATA_PARSER_VERSION,
      policyVersion: METADATA_POLICY_VERSION,
      schemaVersion: METADATA_SCHEMA_VERSION,
      checkedAt: 1,
      checkedFields: ["title", "artist", "album"],
      status: "ready",
      tags: { title: `Title ${index}` },
      loadedVia: "drive_range",
    });
    for (let index = 0; index < 64; index++)
      await service.append(
        identity,
        {
          kind: "tags",
          operationId: `first-${index}`,
          payload: { records: [record(index)] },
        },
        { skipCompaction: true },
      );
    vi.mocked(transport.create).mockImplementationOnce(async (id, json) => {
      files.set(id, json);
      throw new Error("lost compaction response");
    });
    await expect(service.compact(identity, "tags")).rejects.toThrow(
      "lost compaction response",
    );
    await service.read(identity);
    const old = (await appDataControl.listPending(identity)).find(
      (op) => op.kind === "tags",
    );
    expect(old).toMatchObject({ status: "committed", unresolvedUpload: true });
    for (let index = 64; index < 128; index++)
      await service.append(
        identity,
        {
          kind: "tags",
          operationId: `second-${index}`,
          payload: { records: [record(index)] },
        },
        { skipCompaction: true },
      );
    await service.compact(identity, "tags");
    const snapshot = await service.readCollections(identity);
    await service.append(identity, {
      kind: "collections",
      operationId: "collection-after-recovery",
      baseRevision: snapshot.revision,
      payload: empty,
    });
    expect(
      (await service.read(identity)).envelopes.filter(
        (op) => op.kind === "tags",
      ),
    ).toHaveLength(2);
  });

  it("preserves a 503 upload's unknown attempt after a successful same-ID retry", async () => {
    const { service, identity, transport, files } = await ready();
    const input = {
      kind: "collections",
      operationId: "http-503-retry",
      baseRevision: 1,
      payload: empty,
    };
    // A gateway/server 503 cannot prove that the original provider request
    // will never complete later, even if its object is currently absent.
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_provider_unavailable"),
    );
    await expect(service.append(identity, input)).rejects.toThrow(
      "appdata_provider_unavailable",
    );
    expect(await service.append(identity, input)).toMatchObject({
      operationId: "http-503-retry",
      revision: 2,
    });
    const uploads = vi.mocked(transport.create).mock.calls.slice(-2);
    expect(uploads[0][0]).toBe(uploads[1][0]);
    expect((await service.readCollections(identity)).envelopes).toHaveLength(1);
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    const attempts = await fixture.db?.query<{ state: string }>(
      "SELECT state FROM appdata_upload_attempts WHERE operation_id='http-503-retry' ORDER BY started_at,attempt_id",
    );
    expect(attempts?.rows.map((row) => row.state).sort()).toEqual([
      "settled",
      "unknown",
    ]);
    expect(files.size).toBe(1);
  });

  it("abandons an uncertain lost-client write for a new writer without erasing the deletion fence", async () => {
    const { service, identity, transport } = await ready();
    const abandoned = {
      kind: "collections",
      operationId: "lost-client",
      baseRevision: 1,
      payload: empty,
    };
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_provider_uncertain"),
    );
    await expect(service.append(identity, abandoned)).rejects.toThrow(
      "appdata_provider_uncertain",
    );
    const snapshot = await service.readCollections(identity);
    await service.append(identity, {
      kind: "roots",
      operationId: "new-device",
      baseRevision: snapshot.revision,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "old" }],
      },
    });
    expect(await appDataControl.find(identity, "lost-client")).toMatchObject({
      status: "cancelled",
      unresolvedUpload: true,
    });
    await expect(service.append(identity, abandoned)).rejects.toThrow(
      "appdata_operation_cancelled",
    );
    await expect(
      appDataControl.complete(identity, "lost-client"),
    ).rejects.toThrow("appdata_operation_cancelled");
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
  });

  it("uses a stale-attempt timeout only to abandon writes and never as deletion proof", async () => {
    const { service, identity } = await ready();
    await appDataControl.reserve(identity, {
      operationId: "stale-server",
      kind: "collections",
      bodyHash: "a".repeat(64),
      fileId: "stale-provider",
      bytes: 10,
      baseRevision: 1,
      migrationIsEmpty: false,
    });
    const attempt = await appDataControl.startUpload(identity, "stale-server");
    const next = {
      kind: "roots",
      operationId: "new-writer",
      baseRevision: 1,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "old" }],
      },
    };
    await expect(service.append(identity, next)).rejects.toThrow(
      "appdata_pending_write",
    );
    await fixture.db?.query(
      "UPDATE appdata_upload_attempts SET started_at=now()-interval '91 seconds' WHERE attempt_id=$1::uuid",
      [attempt],
    );
    await service.append(identity, next);
    expect(await appDataControl.find(identity, "stale-server")).toMatchObject({
      status: "cancelled",
      unresolvedUpload: true,
    });
    await expect(service.delete(identity)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    await appDataControl.finishUpload(
      identity,
      "stale-server",
      attempt as string,
      false,
    );
    await expect(
      appDataControl.complete(identity, "stale-server"),
    ).rejects.toThrow("appdata_operation_cancelled");
    await service.delete(identity);
  });

  it("isolates unknown uploads on reset while enforcing full-account deletion fences across every generation", async () => {
    const { service, identity, transport, files } = await ready();
    await fixture.db?.exec(
      "INSERT INTO users(google_user_id,email) VALUES('account-a','test@example.invalid'); INSERT INTO google_oauth_grants(google_user_id,encrypted_refresh_token) VALUES('account-a','isolated-test')",
    );
    vi.mocked(transport.create).mockRejectedValueOnce(
      new AppDataError("appdata_provider_uncertain"),
    );
    await expect(
      service.append(identity, {
        kind: "collections",
        operationId: "old-unknown",
        baseRevision: 1,
        payload: empty,
      }),
    ).rejects.toThrow("appdata_provider_uncertain");
    const attempts = await fixture.db?.query<{ attempt_id: string }>(
      "SELECT attempt_id FROM appdata_upload_attempts WHERE operation_id='old-unknown'",
    );
    const reset = await service.reset(identity);
    expect(reset.cleanupPending).toBe(true);
    const fresh = { accountId: reset.accountId, generation: reset.generation };
    expect(fresh.generation).not.toBe(identity.generation);
    await service.append(fresh, {
      kind: "migration",
      operationId: "reset-empty",
      baseRevision: 0,
      payload: empty,
    });
    await service.append(fresh, {
      kind: "roots",
      operationId: "fresh-import",
      baseRevision: 1,
      payload: {
        operations: [{ type: "remove", rootKind: "folder", id: "old" }],
      },
    });
    await expect(service.delete(fresh)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    await appDataControl.fence(fresh);
    await expect(appDataControl.finishDeletion(fresh)).rejects.toThrow(
      "appdata_cleanup_pending",
    );
    expect(
      (
        await fixture.db?.query(
          "SELECT google_user_id FROM google_oauth_grants",
        )
      )?.rows,
    ).toHaveLength(1);
    // An actual old callback can settle only its own request. Its generation's
    // cancelled content can never publish into the new account incarnation.
    files.set("late-old-generation", "old app-owned hidden fixture");
    await appDataControl.finishUpload(
      identity,
      "old-unknown",
      attempts?.rows[0].attempt_id as string,
      false,
    );
    await expect(
      appDataControl.complete(identity, "old-unknown"),
    ).rejects.toThrow("appdata_stale_session");
    await service.delete(fresh);
    await appDataControl.finishDeletion(fresh);
    expect(files.size).toBe(0);
  });

  it("retires at cutoff by cancelling unverified copies while retaining verified copies and hard-deletion journals", async () => {
    if (!fixture.db) throw new Error("Database not initialized");
    const retirement = await readFile(
      resolve(process.cwd(), "../../docs/operations/drop-neon-collections.sql"),
      "utf8",
    );
    await expect(fixture.db.exec(retirement)).rejects.toThrow(
      "cutoff has not been established or reached",
    );
    await fixture.db.exec("ROLLBACK");
    await fixture.db.exec(
      "INSERT INTO users(google_user_id,email) VALUES('retained','test@example.invalid'); INSERT INTO google_oauth_grants(google_user_id,encrypted_refresh_token) VALUES('retained','isolated-test-fixture')",
    );
    const verifiedAccount = await initializeAppDataAccount("retained");
    const verified = {
      accountId: verifiedAccount.accountId,
      generation: verifiedAccount.generation,
    };
    await claimAppDataMigration(verified);
    const drive = memoryDrive();
    const input = {
      kind: "migration",
      operationId: "verified-copy",
      baseRevision: 0,
      payload: empty,
    };
    vi.mocked(drive.transport.create).mockImplementationOnce(
      async (id, json) => {
        drive.files.set(id, json);
        throw new AppDataError("appdata_provider_uncertain");
      },
    );
    await expect(drive.service.append(verified, input)).rejects.toThrow(
      "appdata_provider_uncertain",
    );
    await drive.service.append(verified, input);
    const pendingAccount = await initializeAppDataAccount("not-verified");
    const pending = {
      accountId: pendingAccount.accountId,
      generation: pendingAccount.generation,
    };
    await claimAppDataMigration(pending);
    await appDataControl.reserve(pending, {
      operationId: "late-copy",
      kind: "migration",
      bodyHash: "a".repeat(64),
      fileId: "pending",
      bytes: 10,
      baseRevision: 0,
      migrationIsEmpty: false,
    });
    const attempt = await appDataControl.startUpload(pending, "late-copy");
    await fixture.db.exec(
      "INSERT INTO appdata_rollout(implemented_at,cleanup_due_at) VALUES(now()-interval '31 days',now()-interval '1 day')",
    );
    await fixture.db.exec(retirement);
    await fixture.db.exec(retirement);
    expect(await appDataControl.find(verified, "verified-copy")).toMatchObject({
      status: "committed",
      unresolvedUpload: true,
    });
    expect(await appDataControl.find(pending, "late-copy")).toMatchObject({
      status: "cancelled",
      unresolvedUpload: true,
    });
    await appDataControl.finishUpload(
      pending,
      "late-copy",
      attempt as string,
      false,
    );
    await expect(appDataControl.complete(pending, "late-copy")).rejects.toThrow(
      "appdata_operation_cancelled",
    );
    expect(
      (await fixture.db.query("SELECT google_user_id FROM users")).rows,
    ).toEqual([{ google_user_id: "retained" }]);
    expect(
      (await fixture.db.query("SELECT google_user_id FROM google_oauth_grants"))
        .rows,
    ).toEqual([{ google_user_id: "retained" }]);
    expect((await getAppDataAccount("retained"))?.source).toBe("drive");
    expect(
      (await drive.service.readCollections(verified)).envelopes,
    ).toHaveLength(1);
    expect(
      (
        await fixture.db.query(
          "SELECT to_regclass('playlists') AS p,to_regclass('playlist_tracks') AS t,to_regclass('favorite_tracks') AS f",
        )
      ).rows,
    ).toEqual([{ p: null, t: null, f: null }]);
    const late = await ready("after-drop");
    expect((await late.service.read(late.identity)).envelopes).toHaveLength(1);
  });
});
