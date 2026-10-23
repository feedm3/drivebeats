import { createHash, randomUUID } from "node:crypto";
import {
  type AppDataControl,
  AppDataError,
  type AppDataIdentity,
  type AppDataOperation,
} from "@/db/appdata-control";
import { appDataControl } from "@/lib/appdata-control-service";
import { readDriveAppDataPage } from "@/lib/drive-appdata-pages";
import {
  APPDATA_MAX_FILE_BYTES,
  APPDATA_MAX_RESTORE_BYTES,
  APPDATA_MAX_TAG_BYTES,
  type AppDataEnvelope,
  appDataAppendSchema,
  parseAppDataEnvelope,
} from "@/lib/drive-appdata-schema";
import {
  type AppDataTransport,
  createDriveAppDataTransport,
} from "@/lib/drive-appdata-transport";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}
function ack(identity: AppDataIdentity, op: AppDataOperation) {
  return {
    generation: identity.generation,
    revision: op.revision,
    operationId: op.operationId,
    savedAt: op.savedAt,
    bytes: op.bytes,
  };
}

/** The only mutation seam for app-owned hidden Drive data. Callers supply a
 * signed-session incarnation and a server-held token, never a client account. */
export function createDriveAppDataService(dependencies: {
  control: AppDataControl;
  transport: AppDataTransport;
}) {
  const { control, transport } = dependencies;
  async function verifiedEnvelope(
    identity: AppDataIdentity,
    op: AppDataOperation,
  ) {
    const raw = await (transport.readKnown?.(op.fileId) ??
      transport.read(op.fileId));
    if (raw === null) {
      const current = await control.find(identity, op.operationId);
      if (current && ["superseded", "cancelled"].includes(current.status))
        throw new AppDataError("appdata_restore_changed");
      throw new AppDataError("appdata_saved_file_missing");
    }
    if (bytes(raw) > APPDATA_MAX_FILE_BYTES)
      throw new AppDataError("appdata_file_too_large");
    let envelope: AppDataEnvelope;
    try {
      envelope = parseAppDataEnvelope(JSON.parse(raw));
    } catch {
      throw new AppDataError("appdata_invalid_saved_file");
    }
    const {
      format: _format,
      accountId: _account,
      generation: _generation,
      revision: _revision,
      ...input
    } = envelope;
    if (
      envelope.accountId !== identity.accountId ||
      envelope.generation !== identity.generation ||
      envelope.operationId !== op.operationId ||
      envelope.revision !== op.revision ||
      hash(JSON.stringify(input)) !== op.bodyHash
    )
      throw new AppDataError("appdata_invalid_saved_file");
    return envelope;
  }
  async function pruneFiles(identity: AppDataIdentity) {
    for (const old of await control.listPrunable(identity)) {
      await transport.delete(old.fileId);
      await control.markPruned(identity, old.operationId);
    }
  }
  const service = {
    async readPage(identity: AppDataIdentity, cursor?: string) {
      return readDriveAppDataPage(
        { control, readEnvelope: (op) => verifiedEnvelope(identity, op) },
        identity,
        cursor,
      );
    },
    async getOperation(identity: AppDataIdentity, operationId: string) {
      await control.assertIdentity(identity);
      const op = await control.find(identity, operationId);
      if (!op) return null;
      return {
        operationId: op.operationId,
        revision: op.revision,
        kind: op.kind,
        status: op.status,
        commandHash: op.commandHash,
        result: op.commandResult,
      };
    },
    async read(
      identity: AppDataIdentity,
      options: { collectionsOnly?: boolean } = {},
    ) {
      await control.assertIdentity(identity);
      const checkpoint = (await control.listPending(identity)).find(
        (op) =>
          ["reserved", "uploading", "uncertain"].includes(op.status) &&
          op.operationId.startsWith(`compact-${op.kind}-`) &&
          (op.kind === "tags" || op.kind === "roots"),
      );
      if (
        !options.collectionsOnly &&
        checkpoint &&
        (checkpoint.kind === "tags" || checkpoint.kind === "roots")
      ) {
        try {
          await service.compact(identity, checkpoint.kind);
        } catch {
          /* Existing acknowledged sources remain restorable during maintenance failure. */
        }
      }
      const account = await control.assertIdentity(identity);
      const [operations, rollout] = await Promise.all([
        control.list(identity),
        control.getRollout(),
      ]);
      const committed = operations.filter(
        (op) => op.status === "committed" && op.revision <= account.revision,
      );
      const collectionHead = committed
        .filter((op) => op.kind === "collections" || op.kind === "migration")
        .at(-1);
      const selected = options.collectionsOnly
        ? collectionHead
          ? [collectionHead]
          : []
        : committed;
      const envelopes: AppDataEnvelope[] = new Array(selected.length);
      let restoredBytes = 0;
      for (const op of selected) {
        restoredBytes += op.bytes;
        if (restoredBytes > APPDATA_MAX_RESTORE_BYTES)
          throw new AppDataError("appdata_compaction_required");
      }
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, selected.length) }, async () => {
          while (cursor < selected.length) {
            const index = cursor++;
            envelopes[index] = await verifiedEnvelope(
              identity,
              selected[index],
            );
          }
        }),
      );
      // No partial generation is published after deletion/account replacement.
      const finalAccount = await control.assertIdentity(identity);
      const finalOperations = await control.list(identity);
      const authoritative = (ops: AppDataOperation[]) =>
        ops
          .filter(
            (op) =>
              op.status === "committed" &&
              op.kind !== "tags" &&
              (!options.collectionsOnly || op.kind !== "roots"),
          )
          .map((op) => `${op.operationId}:${op.revision}`)
          .join(",");
      if (
        finalAccount.source !== account.source ||
        authoritative(operations) !== authoritative(finalOperations)
      )
        throw new AppDataError("appdata_restore_changed");
      const pendingAuthority = operations.filter(
        (op) =>
          ["reserved", "uploading", "uncertain"].includes(op.status) &&
          op.kind !== "tags" &&
          op.revision <= account.revision,
      );
      const snapshotRevision = Math.min(
        account.revision,
        ...pendingAuthority.map((op) => op.revision - 1),
      );
      return {
        generation: identity.generation,
        revision: snapshotRevision,
        envelopes,
        source: account.source,
        migrationVersion: account.migrationVersion,
        cutoff: rollout?.cleanupDueAt ?? null,
        pendingOperations: operations
          .filter((op) =>
            ["reserved", "uploading", "uncertain"].includes(op.status),
          )
          .map((op) => ({
            operationId: op.operationId,
            revision: op.revision,
            kind: op.kind,
          })),
      };
    },
    async readCollections(identity: AppDataIdentity) {
      return service.read(identity, { collectionsOnly: true });
    },
    async append(
      identity: AppDataIdentity,
      value: unknown,
      options: { skipCompaction?: boolean; coveredSources?: string[] } = {},
    ) {
      await control.assertIdentity(identity);
      const parsed = appDataAppendSchema.safeParse(value);
      if (!parsed.success) throw new AppDataError("appdata_invalid_payload");
      const input = parsed.data;
      if (!options.skipCompaction) {
        const checkpoint = (await control.listPending(identity)).find(
          (op) =>
            ["reserved", "uploading", "uncertain"].includes(op.status) &&
            op.operationId.startsWith(`compact-${op.kind}-`) &&
            (op.kind === "tags" || op.kind === "roots"),
        );
        if (
          checkpoint &&
          (checkpoint.kind === "tags" || checkpoint.kind === "roots")
        )
          try {
            await service.compact(identity, checkpoint.kind);
          } catch {
            /* Maintenance cannot replace the user's mutation error. */
          }
      }
      if (
        input.kind === "roots" &&
        !options.skipCompaction &&
        input.payload.operations.some(
          (event) => event.sourceRevision !== undefined,
        )
      )
        throw new AppDataError("appdata_invalid_payload");
      if (
        input.kind === "tags" &&
        input.payload.records.some(
          (record) => record.accountId !== identity.accountId,
        )
      )
        throw new AppDataError("appdata_account_mismatch");
      if (
        input.kind === "roots" &&
        input.payload.operations.some(
          (op) =>
            op.type === "add" &&
            (op.id !== op.descriptor.id ||
              (op.rootKind === "folder") !==
                (op.descriptor.mimeType ===
                  "application/vnd.google-apps.folder")),
        )
      )
        throw new AppDataError("appdata_invalid_root");
      const body = JSON.stringify(input);
      if (
        bytes(body) >
        (input.kind === "tags"
          ? APPDATA_MAX_TAG_BYTES
          : APPDATA_MAX_FILE_BYTES - 1024)
      )
        throw new AppDataError("appdata_file_too_large");
      // Reserving an unused generated ID is harmless; creating a Drive file only
      // happens after the durable reservation and startUpload fence.
      const fileId = await transport.generateId();
      let op = await control.reserve(identity, {
        operationId: input.operationId,
        kind: input.kind,
        bodyHash: hash(body),
        fileId,
        bytes: bytes(body),
        coveredSources: options.coveredSources,
        baseRevision: input.baseRevision,
        migrationIsEmpty:
          input.kind === "migration" &&
          input.payload.playlists.length === 0 &&
          input.payload.favorites.length === 0,
        ...(input.kind === "collections"
          ? {
              commandHash: input.payload.commandHash,
              commandResult: input.payload.result,
            }
          : {}),
      });
      if (op.status === "committed" || op.status === "superseded")
        return ack(identity, op);
      if (op.status === "cancelled")
        throw new AppDataError("appdata_operation_cancelled");
      if (op.status === "uncertain" || op.status === "uploading") {
        try {
          await verifiedEnvelope(identity, op);
          op = await control.complete(identity, op.operationId);
          if (op.status !== "committed")
            throw new AppDataError("appdata_legacy_cutoff");
          return ack(identity, op);
        } catch (error) {
          if (
            !(error instanceof AppDataError) ||
            error.code !== "appdata_saved_file_missing"
          )
            throw error;
          // Retrying this immutable generated ID is provider-supported. Every
          // earlier request retains its own unresolved attempt fence.
        }
      }
      const attempt = await control.startUpload(
        identity,
        op.operationId,
        op.status !== "reserved",
      );
      if (!attempt) throw new AppDataError("appdata_pending_write");
      const envelope: AppDataEnvelope = {
        ...input,
        format: 1,
        accountId: identity.accountId,
        generation: identity.generation,
        revision: op.revision,
      };
      try {
        await transport.create(op.fileId, JSON.stringify(envelope));
      } catch (error) {
        // Explicit rejection or readback after a completed POST settles this
        // attempt. Network failures and provider5xx remain indeterminate;
        // immutable retry does not prove the original request cannot finish.
        const settled =
          error instanceof AppDataError &&
          [
            "appdata_access_required",
            "appdata_rate_limited",
            "appdata_storage_full",
            "appdata_upload_verification_pending",
            "appdata_provider_rejected",
            "appdata_upload_verification_failed",
          ].includes(error.code);
        await control.finishUpload(identity, op.operationId, attempt, !settled);
        if (settled) await control.release(identity, op.operationId);
        throw error;
      }
      // If the process dies here, uploading stays durable and deletion refuses
      // to claim success. No TTL is interpreted as proof of provider completion.
      await control.finishUpload(identity, op.operationId, attempt, false);
      op = await control.complete(identity, op.operationId);
      if (op.status !== "committed")
        throw new AppDataError("appdata_legacy_cutoff");
      // Collection bodies are replaceable snapshots; their durable receipts
      // remain available after exact older files have been removed.
      try {
        await pruneFiles(identity);
      } catch {
        /* Saved data remains authoritative; retry cleanup later. */
      }
      if (
        !options.skipCompaction &&
        (input.kind === "tags" || input.kind === "roots")
      ) {
        try {
          await service.compact(identity, input.kind);
        } catch {
          /* An acknowledged append remains saved if maintenance is interrupted. */
        }
      }
      return ack(identity, op);
    },
    async delete(identity: AppDataIdentity) {
      const prior = await control.listAccountPending(identity);
      if (
        prior.some(
          (op) =>
            op.status === "uploading" ||
            op.status === "uncertain" ||
            op.unresolvedUpload,
        )
      )
        throw new AppDataError("appdata_cleanup_pending");
      await control.fence(identity);
      const operations = await control.listAccountPending(identity);
      if (
        operations.some(
          (op) =>
            op.status === "uploading" ||
            op.status === "uncertain" ||
            op.unresolvedUpload,
        )
      )
        throw new AppDataError("appdata_cleanup_pending");
      // Snapshot every page before mutations; delete even old-incarnation and
      // unrecognized app-owned files. Membership is checked by the transport.
      const files = await transport.list({ forDeletion: true });
      for (const file of files) await transport.delete(file.id);
      if ((await transport.list({ forDeletion: true })).length > 0)
        throw new AppDataError("appdata_cleanup_pending");
      // Keep 'deleting' until the supervisor removes user/cloud/grant records.
      // finishDeletion is the final step after that protected cleanup succeeds.
      return { deletedFiles: files.length };
    },
    async reset(identity: AppDataIdentity) {
      await control.fence(identity);
      await control.prepareReset(identity);
      const files = await transport.list({ forDeletion: true });
      for (const file of files) await transport.delete(file.id);
      const pending = await control.listAccountPending(identity);
      const remains = await transport.list({ forDeletion: true });
      if (remains.length && !pending.length)
        throw new AppDataError("appdata_cleanup_pending");
      // A new incarnation isolates any late old upload. Its journal survives;
      // this is never proof that full account deletion has become safe.
      const account = await control.resetAccount(identity);
      return {
        ...account,
        cleanupPending: pending.length > 0 || remains.length > 0,
        deletedFiles: files.length,
      };
    },
    async compact(identity: AppDataIdentity, kind: "tags" | "roots") {
      const current = await control.assertIdentity(identity);
      await pruneFiles(identity);
      const pending = (await control.listPending(identity)).find(
        (op) =>
          ["reserved", "uploading", "uncertain"].includes(op.status) &&
          op.kind === kind &&
          op.operationId.startsWith(`compact-${kind}-`),
      );
      const candidates = (await control.list(identity)).filter(
        (op) =>
          op.kind === kind && op.status === "committed" && !op.unresolvedUpload,
      );
      if (candidates.length < 64) return;
      // Whole-source groups make interruption safe: until every record of a
      // source is included in a verified replacement, the source stays live.
      if (kind === "tags") {
        type RecordType = Extract<
          AppDataEnvelope,
          { kind: "tags" }
        >["payload"]["records"][number];
        let records = new Map<string, RecordType>();
        let sources: AppDataOperation[] = [];
        for (const source of candidates) {
          const envelope = await verifiedEnvelope(identity, source);
          if (envelope.kind !== "tags") continue;
          const combined = new Map(records);
          for (const record of envelope.payload.records) {
            const key = JSON.stringify([
              record.fileId,
              record.fingerprint,
              record.parserVersion,
              record.policyVersion,
              record.schemaVersion,
            ]);
            const prior = combined.get(key);
            if (
              !prior ||
              (record.status === "ready" && prior.status !== "ready") ||
              (record.status === prior.status &&
                JSON.stringify(record) < JSON.stringify(prior))
            )
              combined.set(key, record);
          }
          if (
            combined.size > 256 ||
            bytes(JSON.stringify({ records: [...combined.values()] })) >
              APPDATA_MAX_TAG_BYTES - 1024
          ) {
            if (sources.length >= 2) break;
            records.clear();
            sources = [];
            // A full batch cannot combine with this one; try a later group.
            if (envelope.payload.records.length === 256) continue;
            for (const record of envelope.payload.records)
              records.set(
                JSON.stringify([
                  record.fileId,
                  record.fingerprint,
                  record.parserVersion,
                  record.policyVersion,
                  record.schemaVersion,
                ]),
                record,
              );
            sources.push(source);
            continue;
          }
          records = combined;
          sources.push(source);
        }
        if (sources.length < 2) return;
        const operationId =
          pending?.operationId ?? `compact-tags-${randomUUID()}`;
        await service.append(
          identity,
          {
            kind: "tags",
            operationId,
            baseRevision: pending ? pending.revision - 1 : current.revision,
            payload: { records: [...records.values()] },
          },
          {
            skipCompaction: true,
            coveredSources: sources.map((source) => source.operationId),
          },
        );
      } else {
        type RootType = Extract<
          AppDataEnvelope,
          { kind: "roots" }
        >["payload"]["operations"][number];
        const latest = new Map<string, RootType>();
        const sourceEnvelopes: { source: AppDataOperation; keys: string[] }[] =
          [];
        for (const source of candidates) {
          const envelope = await verifiedEnvelope(identity, source);
          if (envelope.kind !== "roots") continue;
          const keys: string[] = [];
          for (const event of envelope.payload.operations) {
            const key = `${event.rootKind}:${event.id}`;
            keys.push(key);
            const next = {
              ...event,
              sourceRevision: event.sourceRevision ?? envelope.revision,
            };
            const previous = latest.get(key);
            if (
              !previous ||
              (previous.sourceRevision ?? 0) <= next.sourceRevision
            )
              latest.set(key, next);
          }
          sourceEnvelopes.push({ source, keys });
        }
        // One bounded checkpoint group per pass. Retire only whole batches
        // whose complete key set belongs to this group.
        const entries = [...latest.entries()].slice(0, 256);
        const keys = new Set(entries.map(([key]) => key));
        const sources = sourceEnvelopes.filter((source) =>
          source.keys.every((key) => keys.has(key)),
        );
        if (sources.length < 2) return;
        const operationId =
          pending?.operationId ?? `compact-roots-${randomUUID()}`;
        await service.append(
          identity,
          {
            kind: "roots",
            operationId,
            baseRevision: pending ? pending.revision - 1 : current.revision,
            payload: { operations: entries.map(([, event]) => event) },
          },
          {
            skipCompaction: true,
            coveredSources: sources.map((source) => source.source.operationId),
          },
        );
      }
      await pruneFiles(identity);
    },
  };
  return service;
}

export function getDriveAppDataService(accessToken: string) {
  return createDriveAppDataService({
    control: appDataControl,
    transport: createDriveAppDataTransport(accessToken),
  });
}
