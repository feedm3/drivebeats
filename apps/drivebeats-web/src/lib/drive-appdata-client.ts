import { clearVerifiedAppDataReadiness } from "@/lib/appdata-readiness";
import {
  acknowledgePortableOutbox,
  clearPortableCache,
  clearPortableMetadataDirty,
  markPortableMetadataDirty,
  type PortableCacheEntry,
  readPortableCache,
  readPortableOutbox,
  renewPortableOutboxIdentity,
  replacePortableOutbox,
  savePortableOutbox,
  scanMetadataRecords,
  sealPortableOutbox,
} from "@/lib/metadata-cache-db";
import {
  getMetadataFingerprint,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataDescriptor,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import { getRememberedMetadataAccountId } from "@/lib/metadata-local-account";
import { useAuthStore } from "@/stores/auth-store";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import type { DriveFile } from "@/types";

export interface RootOperation {
  type: "add" | "remove";
  rootKind: "folder" | "track";
  id: string;
  descriptor?: DriveFile;
  /** Only server checkpoints may carry an original operation revision. */
  sourceRevision?: number;
}
interface Envelope {
  format: 1;
  accountId: string;
  generation: string;
  operationId: string;
  revision: number;
  kind: string;
  payload: unknown;
}
interface RemoteData {
  generation: string;
  revision: number;
  envelopes: Envelope[];
  cutoff?: string | null;
  migrationVersion?: number;
}
interface Command {
  operationId: string;
  generation: string;
  baseRevision?: number;
  kind: "tags" | "roots";
  payload: { records: MetadataRecord[] } | { operations: RootOperation[] };
}
const MAX_BATCH_RECORDS = 64;
const MAX_BATCH_BYTES = 192 * 1024;
let retryDelay = 2000;
let restoreRetryTimer: ReturnType<typeof setTimeout> | undefined;
let restoreRetryAttempts = 0;
let session = 0;
let revision = 0;
let restoreFlight: Promise<void> | null = null;
let flushFlight: Promise<void> | null = null;
let checkpointFlight: Promise<void> | null = null;
let checkpointSession = -1;
let queueTail: Promise<unknown> = Promise.resolve();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let draft: PortableCacheEntry | null = null;
const savedKeys = new Set<string>();
const pendingKeys = new Set<string>();
const preRestoreOperations: RootOperation[] = [];
const removedRoots = new Map<string, number>();
const freshRestoreRoots = new Set<string>();
const remoteVariants = new Map<string, MetadataRecord>();
const acknowledgedRoots = new Map<
  string,
  { revision: number; operation: RootOperation }
>();

function onMetadataSaved(event: Event) {
  void queuePortableMetadata((event as CustomEvent<MetadataRecord>).detail);
}
function onRootsChanged(event: Event) {
  void queueImportedRootOperations(
    (event as CustomEvent<RootOperation[]>).detail,
  );
}
function listenForLocalChanges() {
  if (typeof window === "undefined") return;
  window.addEventListener("drivebeats-portable-metadata", onMetadataSaved);
  window.addEventListener("drivebeats-portable-roots", onRootsChanged);
}
function stopListeningForLocalChanges() {
  if (typeof window === "undefined") return;
  window.removeEventListener("drivebeats-portable-metadata", onMetadataSaved);
  window.removeEventListener("drivebeats-portable-roots", onRootsChanged);
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function savedTrackCount() {
  return new Set([...savedKeys].map((key) => (JSON.parse(key) as string[])[0]))
    .size;
}
function metadataKey(record: MetadataRecord) {
  return JSON.stringify([
    record.fileId,
    record.fingerprint,
    record.parserVersion,
    record.policyVersion,
    record.schemaVersion,
  ]);
}

/** Only completed, content-bound results are portable; device failures stay local. */
export function isPortableMetadata(
  value: unknown,
  accountId: string,
): value is MetadataRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as MetadataRecord;
  if (
    record.accountId !== accountId ||
    typeof record.fileId !== "string" ||
    !record.fileId ||
    record.fileId.length > 256 ||
    record.schemaVersion !== METADATA_SCHEMA_VERSION ||
    record.parserVersion !== METADATA_PARSER_VERSION ||
    record.policyVersion !== METADATA_POLICY_VERSION ||
    !["ready", "no_target_tags"].includes(record.status) ||
    !["local_blob", "drive_range"].includes(record.loadedVia) ||
    !Number.isFinite(record.checkedAt) ||
    record.checkedAt < 0 ||
    record.environmentKey !== undefined ||
    typeof record.fingerprint !== "string" ||
    record.fingerprint.length > 256
  )
    return false;
  try {
    const fingerprint = JSON.parse(record.fingerprint);
    if (
      !Array.isArray(fingerprint) ||
      fingerprint.length !== 2 ||
      typeof fingerprint[0] !== "string" ||
      !fingerprint[0] ||
      typeof fingerprint[1] !== "string" ||
      !/^\d+$/.test(fingerprint[1])
    )
      return false;
  } catch {
    return false;
  }
  if (record.status === "ready") {
    if (!record.tags || typeof record.tags !== "object") return false;
    if (
      !Object.values(record.tags).some(
        (value) => typeof value === "string" && value.length > 0,
      )
    )
      return false;
    if (
      Object.entries(record.tags).some(
        ([key, value]) =>
          !["title", "artist", "album"].includes(key) ||
          (value !== undefined &&
            (typeof value !== "string" || value.length > 500)),
      )
    )
      return false;
  }
  return bytes(record) <= 8192;
}

function portableRecord(record: MetadataRecord): MetadataRecord {
  return {
    accountId: record.accountId,
    fileId: record.fileId,
    fingerprint: record.fingerprint,
    parserVersion: record.parserVersion,
    policyVersion: record.policyVersion,
    schemaVersion: record.schemaVersion,
    checkedAt: record.checkedAt,
    checkedFields: ["title", "artist", "album"],
    status: record.status,
    loadedVia: record.loadedVia,
    ...(record.mimeType ? { mimeType: record.mimeType } : {}),
    ...(record.status === "ready"
      ? {
          tags: Object.fromEntries(
            Object.entries(record.tags ?? {}).filter(
              ([, value]) => typeof value === "string",
            ),
          ),
        }
      : {}),
  };
}
function rootDescriptor(file: DriveFile): DriveFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    ...(file.size !== undefined ? { size: file.size } : {}),
    ...(file.modifiedTime !== undefined
      ? { modifiedTime: file.modifiedTime }
      : {}),
    ...(file.parents !== undefined ? { parents: file.parents } : {}),
    ...(file.parentFolderName !== undefined
      ? { parentFolderName: file.parentFolderName }
      : {}),
  };
}
function current(accountId: string, captured: number) {
  return (
    captured === session &&
    useDriveAppDataStore.getState().accountId === accountId
  );
}
function failure(error: unknown) {
  return error instanceof Error ? error.message : "backup_unavailable";
}
async function request(path: string, init?: RequestInit) {
  const accountId = useDriveAppDataStore.getState().accountId;
  const captured = session;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok) {
      if (
        (response.status === 401 || response.status === 403) &&
        accountId &&
        current(accountId, captured) &&
        useAuthStore.getState().user?.id === accountId
      ) {
        clearVerifiedAppDataReadiness(accountId);
        useDriveAppDataStore.setState({
          status: "error",
          error: "appdata_access_required",
        });
        useAuthStore.setState({
          appDataConsentRequired: true,
          appDataReady: false,
          appDataOfflineReady: false,
          accessToken: null,
          expiresAt: null,
        });
        // The global Audio object outlives gate unmounting. Explicitly stop its
        // playback, while a late response can never pause another account.
        await import("@/stores/player-store")
          .then(({ usePlayerStore }) => {
            if (
              current(accountId, captured) &&
              useAuthStore.getState().user?.id === accountId
            )
              usePlayerStore.getState().pause();
          })
          .catch(() => {});
      }
      if (response.status === 401 || response.status === 403)
        throw new Error("appdata_access_required");
      const detail = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new Error(
        detail.code === "appdata_revision_conflict"
          ? "revision_conflict"
          : detail.code && /^appdata_[a-z_]+$/.test(detail.code)
            ? detail.code
            : response.status === 507
              ? "google_storage_full"
              : "backup_unavailable",
      );
    }
    const length = Number(response.headers.get("content-length"));
    if (length > 64 * 1024 * 1024) throw new Error("backup_too_large");
    // The authenticated server validates and bounds Drive files before returning them.
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
/** Collect a complete immutable snapshot before publishing any remote records. */
async function readRemoteData(
  accountId: string,
  captured: number,
): Promise<RemoteData> {
  const envelopes: Envelope[] = [];
  const completed = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let first: {
    generation: string;
    revision: number;
    source?: string;
    migrationVersion?: number;
    cutoff?: string | null;
  } | null = null;
  let partialId: string | null = null;
  let partial: Uint8Array[] = [];
  let partialBytes = 0;
  let totalBytes = 0;
  for (let pageNumber = 0; pageNumber < 512; pageNumber++) {
    if (!current(accountId, captured)) throw new Error("scope_changed");
    const value = (await request(
      `/api/appdata${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    )) as RemoteData & {
      format?: number;
      fragments?: {
        operationId: string;
        offset: number;
        data: string;
        end: boolean;
      }[];
      nextCursor?: string | null;
      source?: string;
    };
    if (!current(accountId, captured)) throw new Error("scope_changed");
    // Compatibility with pre-pagination servers; new servers always return pages.
    if (
      pageNumber === 0 &&
      value.format === undefined &&
      Array.isArray(value.envelopes)
    )
      return value;
    if (
      value.format !== 1 ||
      typeof value.generation !== "string" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !["legacy", "migrating", "drive"].includes(value.source ?? "") ||
      !Number.isSafeInteger(value.migrationVersion) ||
      (value.migrationVersion ?? -1) < 0 ||
      (value.cutoff !== null &&
        (typeof value.cutoff !== "string" ||
          !Number.isFinite(Date.parse(value.cutoff)))) ||
      !Array.isArray(value.fragments) ||
      value.fragments.length > 10_000 ||
      bytes(value) > 2 * 1024 * 1024 ||
      (value.nextCursor !== null &&
        (typeof value.nextCursor !== "string" ||
          !value.nextCursor ||
          value.nextCursor.length > 2048))
    )
      throw new Error("invalid_backup_page");
    const header = {
      generation: value.generation,
      revision: value.revision,
      source: value.source,
      migrationVersion: value.migrationVersion,
      cutoff: value.cutoff,
    };
    if (!first) first = header;
    else if (JSON.stringify(header) !== JSON.stringify(first))
      throw new Error("appdata_restore_changed");
    for (const fragment of value.fragments) {
      if (
        typeof fragment.operationId !== "string" ||
        !fragment.operationId ||
        fragment.operationId.length > 256 ||
        !Number.isSafeInteger(fragment.offset) ||
        fragment.offset < 0 ||
        typeof fragment.end !== "boolean" ||
        typeof fragment.data !== "string" ||
        !fragment.data ||
        fragment.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(fragment.data)
      )
        throw new Error("invalid_backup_page");
      if (partialId === null) {
        if (completed.has(fragment.operationId) || fragment.offset !== 0)
          throw new Error("invalid_backup_page");
        partialId = fragment.operationId;
      }
      if (
        partialId !== fragment.operationId ||
        fragment.offset !== partialBytes
      )
        throw new Error("invalid_backup_page");
      const binary = atob(fragment.data);
      const decoded = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++)
        decoded[index] = binary.charCodeAt(index);
      partialBytes += decoded.length;
      totalBytes += decoded.length;
      if (totalBytes > 64 * 1024 * 1024 || partialBytes > 17 * 1024 * 1024)
        throw new Error("backup_too_large");
      partial.push(decoded);
      if (fragment.end) {
        const encoded = new Uint8Array(partialBytes);
        let offset = 0;
        for (const chunk of partial) {
          encoded.set(chunk, offset);
          offset += chunk.length;
        }
        const envelope = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(encoded),
        ) as Envelope;
        if (
          envelope.operationId !== partialId ||
          envelope.accountId !== accountId ||
          envelope.generation !== first.generation ||
          envelope.format !== 1 ||
          !Number.isSafeInteger(envelope.revision) ||
          envelope.revision < 1 ||
          envelope.revision > first.revision
        )
          throw new Error("invalid_backup_page");
        envelopes.push(envelope);
        completed.add(partialId);
        partial = [];
        partialBytes = 0;
        partialId = null;
      }
    }
    cursor = value.nextCursor ?? null;
    if (cursor === null) {
      if (partialId !== null) throw new Error("invalid_backup_page");
      return { ...first, envelopes };
    }
    if (!value.fragments.length || cursors.has(cursor))
      throw new Error("invalid_backup_page");
    cursors.add(cursor);
  }
  throw new Error("backup_too_large");
}

function scheduleFlush(delay = 1000) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushDriveAppData().catch(() => {});
  }, delay);
}
function enqueue(task: () => Promise<void>) {
  const next = queueTail.then(task);
  queueTail = next.catch(() => {});
  return next;
}
function commandFor(entry: PortableCacheEntry) {
  return entry.payload as Command;
}
async function updatePending(accountId: string, captured: number) {
  const entries = await readPortableCache(accountId);
  if (!current(accountId, captured)) return;
  useDriveAppDataStore.setState({
    pendingCount: entries
      .filter(
        (entry) =>
          entry.kind === "outbox" &&
          entry.generation === useDriveAppDataStore.getState().generation,
      )
      .reduce(
        (sum, entry) =>
          sum +
          (commandFor(entry).kind === "tags"
            ? (commandFor(entry).payload as { records: MetadataRecord[] })
                .records.length
            : 1),
        0,
      ),
  });
}

export function queuePortableMetadata(record: MetadataRecord): Promise<void> {
  return enqueue(async () => {
    const state = useDriveAppDataStore.getState();
    const captured = session;
    if (
      state.accountId !== record.accountId ||
      !state.generation ||
      state.status === "idle" ||
      !isPortableMetadata(record, record.accountId)
    )
      return;
    record = portableRecord(record);
    const key = metadataKey(record);
    if (savedKeys.has(key) || pendingKeys.has(key)) return;
    let records = draft
      ? (commandFor(draft).payload as { records: MetadataRecord[] }).records
      : [];
    if (
      records.length >= MAX_BATCH_RECORDS ||
      bytes([...records, record]) > MAX_BATCH_BYTES
    ) {
      draft = null;
      records = [];
    }
    const operationId = draft?.id ?? crypto.randomUUID();
    const payload: Command = {
      operationId,
      generation: state.generation,
      kind: "tags",
      payload: { records: [...records, record] },
    };
    let entry: PortableCacheEntry = {
      id: operationId,
      accountId: record.accountId,
      generation: state.generation,
      kind: "outbox",
      bytes: bytes(payload),
      payload,
    };
    const appended = await savePortableOutbox(
      entry,
      draft ? "append" : "create",
    );
    if (!appended) {
      // A peer may have sealed and even acknowledged our draft while this tab
      // kept its old in-memory pointer. Never mutate or recreate that retry ID.
      const operationId = crypto.randomUUID();
      const payload: Command = {
        operationId,
        generation: state.generation,
        kind: "tags",
        payload: { records: [record] },
      };
      entry = { ...entry, id: operationId, payload, bytes: bytes(payload) };
      if (!(await savePortableOutbox(entry, "create")))
        throw new Error("backup_queue_changed");
    }
    if (!current(record.accountId, captured)) return;
    draft = entry;
    pendingKeys.add(key);
    await updatePending(record.accountId, captured);
    scheduleFlush();
  }).catch(async (error) => {
    const state = useDriveAppDataStore.getState();
    if (state.accountId === record.accountId) {
      if (failure(error) === "backup_queue_full" && state.generation) {
        await markPortableMetadataDirty(
          record.accountId,
          state.generation,
        ).catch(() => {});
        scheduleFlush();
      }
      useDriveAppDataStore.setState({ error: failure(error) });
    }
  });
}

/** Queue complete local batches without a per-record outbox rescan. */
function checkpointLocalMetadata(
  accountId: string,
  generation: string,
  captured: number,
) {
  if (checkpointFlight && checkpointSession === captured) return;
  checkpointSession = captured;
  const task = (async () => {
    const dirtyToken = await markPortableMetadataDirty(accountId, generation);
    // A local scan/save never holds the required access/remote-restore gate.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!current(accountId, captured)) return;
    const records: MetadataRecord[] = [];
    const scanned = await scanMetadataRecords(accountId, (record) => {
      if (isPortableMetadata(record, accountId))
        records.push(portableRecord(record));
    });
    if (!scanned) throw new Error("durable_storage_unavailable");
    let offset = 0;
    while (offset < records.length && current(accountId, captured)) {
      await enqueue(async () => {
        if (!current(accountId, captured)) return;
        const batch: MetadataRecord[] = [];
        while (offset < records.length) {
          const record = records[offset];
          const key = metadataKey(record);
          if (savedKeys.has(key) || pendingKeys.has(key)) {
            offset++;
            continue;
          }
          if (
            batch.length &&
            (batch.length >= MAX_BATCH_RECORDS ||
              bytes([...batch, record]) > MAX_BATCH_BYTES)
          )
            break;
          batch.push(record);
          offset++;
        }
        if (!batch.length) return;
        const operationId = crypto.randomUUID();
        const payload: Command = {
          operationId,
          generation,
          kind: "tags",
          payload: { records: batch },
        };
        await savePortableOutbox({
          id: operationId,
          accountId,
          generation,
          kind: "outbox",
          sealed: true,
          bytes: bytes(payload),
          payload,
        });
        if (!current(accountId, captured)) return;
        for (const record of batch) pendingKeys.add(metadataKey(record));
        await updatePending(accountId, captured);
        scheduleFlush();
      });
      // Give rendering, player controls and incoming operations a turn.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!current(accountId, captured)) return;
    await clearPortableMetadataDirty(accountId, generation, dirtyToken);
  })()
    .catch((error) => {
      if (current(accountId, captured)) {
        useDriveAppDataStore.setState({ error: failure(error) });
        scheduleFlush();
      }
    })
    .finally(() => {
      if (checkpointFlight === task) checkpointFlight = null;
    });
  checkpointFlight = task;
}

export function queueImportedRootOperations(
  operations: RootOperation[],
): Promise<void> {
  return enqueue(async () => {
    const state = useDriveAppDataStore.getState();
    if (!operations.length) return;
    operations = operations.map((operation) =>
      operation.type === "add" && operation.descriptor
        ? {
            type: operation.type,
            rootKind: operation.rootKind,
            id: operation.id,
            descriptor: rootDescriptor(operation.descriptor),
          }
        : {
            type: operation.type,
            rootKind: operation.rootKind,
            id: operation.id,
          },
    );
    if (state.accountId && !state.generation && state.status === "restoring") {
      preRestoreOperations.push(...operations);
      return;
    }
    if (!state.accountId || !state.generation) return;
    const batches: RootOperation[][] = [];
    for (const operation of operations) {
      let batch = batches.at(-1);
      if (
        !batch ||
        batch.length >= 128 ||
        bytes([...batch, operation]) > MAX_BATCH_BYTES
      ) {
        batch = [];
        batches.push(batch);
      }
      batch.push(operation);
    }
    for (const batch of batches) {
      const operationId = crypto.randomUUID();
      const payload: Command = {
        operationId,
        generation: state.generation,
        baseRevision: revision,
        kind: "roots",
        payload: { operations: batch },
      };
      if (state.status === "restoring") freshRestoreRoots.add(operationId);
      await savePortableOutbox({
        id: operationId,
        accountId: state.accountId,
        generation: state.generation,
        kind: "outbox",
        readyToSeal: state.status !== "restoring",
        bytes: bytes(payload),
        payload,
      });
    }
    await updatePending(state.accountId, session);
    scheduleFlush();
  }).catch((error) => {
    useDriveAppDataStore.setState({ error: failure(error) });
  });
}

async function applyRemote(
  data: RemoteData,
  accountId: string,
  captured: number,
) {
  if (!current(accountId, captured)) return;
  if (
    data.generation !== useDriveAppDataStore.getState().generation &&
    useDriveAppDataStore.getState().generation !== null
  )
    throw new Error("account_generation_changed");
  if (
    typeof data.generation !== "string" ||
    !data.generation ||
    !Array.isArray(data.envelopes) ||
    data.envelopes.length > 10_000 ||
    !Number.isSafeInteger(data.revision)
  )
    throw new Error("invalid_backup");
  useDriveAppDataStore.setState({ generation: data.generation });
  savedKeys.clear();
  remoteVariants.clear();
  const records = new Map<string, MetadataRecord>();
  const roots = new Map<string, DriveFile>();
  let approximateBytes = 0;
  for (const envelope of [...data.envelopes].sort(
    (a, b) =>
      a.revision - b.revision || a.operationId.localeCompare(b.operationId),
  )) {
    if (
      envelope.format !== 1 ||
      envelope.accountId !== accountId ||
      envelope.generation !== data.generation
    )
      continue;
    approximateBytes += bytes(envelope);
    if (approximateBytes > 64 * 1024 * 1024)
      throw new Error("backup_too_large");
    if (envelope.kind === "tags") {
      const values = (envelope.payload as { records?: unknown[] })?.records;
      if (!Array.isArray(values) || values.length > 512) continue;
      for (const value of values) {
        if (!isPortableMetadata(value, accountId)) continue;
        savedKeys.add(metadataKey(value));
        const variantKey = metadataKey(value);
        const previousVariant = remoteVariants.get(variantKey);
        if (
          !previousVariant ||
          JSON.stringify(value.tags ?? {}) >
            JSON.stringify(previousVariant.tags ?? {})
        )
          remoteVariants.set(variantKey, value);
        const previous = records.get(value.fileId);
        // Drive content validators, then stable text, resolve duplicates without browser clocks.
        const order = (record: MetadataRecord) =>
          `${record.fingerprint}:${JSON.stringify(record.tags ?? {})}`;
        if (!previous || order(value) > order(previous))
          records.set(value.fileId, value);
      }
    } else if (envelope.kind === "roots") {
      const operations = (envelope.payload as { operations?: RootOperation[] })
        ?.operations;
      if (!Array.isArray(operations) || operations.length > 512) continue;
      for (const operation of operations) {
        const sourceRevision = operation.sourceRevision ?? envelope.revision;
        if (
          !Number.isSafeInteger(sourceRevision) ||
          sourceRevision < 1 ||
          sourceRevision > envelope.revision
        )
          throw new Error("invalid_backup");
        const key = `${operation.rootKind}:${operation.id}`;
        if (operation.type === "remove") {
          roots.delete(key);
          removedRoots.set(
            key,
            Math.max(removedRoots.get(key) ?? 0, sourceRevision),
          );
        } else if (
          operation.type === "add" &&
          operation.descriptor?.id === operation.id &&
          typeof operation.descriptor.name === "string" &&
          typeof operation.descriptor.mimeType === "string"
        )
          roots.set(key, operation.descriptor);
      }
    }
  }
  // A save may finish while this GET snapshot is in flight. Keep its newer
  // acknowledged intent until a later snapshot includes that revision.
  for (const [key, acknowledged] of acknowledgedRoots) {
    if (acknowledged.revision <= data.revision) continue;
    const operation = acknowledged.operation;
    if (operation.type === "remove") {
      roots.delete(key);
      removedRoots.set(key, acknowledged.revision);
    } else if (operation.descriptor) roots.set(key, operation.descriptor);
  }
  const pending = await readPortableCache(accountId);
  if (!current(accountId, captured)) return;
  // Commands deliberately created in this live restore window could not have
  // been submitted yet. Keep them across hydration. Persisted stale commands
  // retain their original revision and remain subordinate to newer removals.
  for (let index = 0; index < pending.length; index++) {
    const entry = pending[index];
    if (
      entry.kind !== "outbox" ||
      entry.readyToSeal !== false ||
      entry.generation !== data.generation ||
      commandFor(entry).kind !== "roots"
    )
      continue;
    const command = commandFor(entry);
    const operations = (
      command.payload as { operations: RootOperation[] }
    ).operations.filter(
      (operation) =>
        freshRestoreRoots.has(entry.id) ||
        operation.type !== "add" ||
        (removedRoots.get(`${operation.rootKind}:${operation.id}`) ?? -1) <=
          (command.baseRevision ?? -1),
    );
    if (!operations.length) {
      await acknowledgePortableOutbox(entry.id, command);
      pending.splice(index--, 1);
      continue;
    }
    const payload = {
      ...command,
      baseRevision: data.revision,
      payload: { operations },
    };
    const winner = await replacePortableOutbox(
      { ...entry, payload, bytes: bytes(payload), readyToSeal: true },
      command,
    );
    if (winner) pending[index] = winner;
    else pending.splice(index--, 1);
    freshRestoreRoots.delete(entry.id);
    if (!current(accountId, captured)) return;
  }
  const operations = pending
    .filter(
      (entry) =>
        entry.kind === "outbox" &&
        entry.generation === data.generation &&
        commandFor(entry).kind === "roots",
    )
    .flatMap((entry) =>
      (
        commandFor(entry).payload as { operations: RootOperation[] }
      ).operations.filter(
        (operation) =>
          operation.type !== "add" ||
          (removedRoots.get(`${operation.rootKind}:${operation.id}`) ?? -1) <=
            (commandFor(entry).baseRevision ?? -1),
      ),
    );
  for (const operation of operations) {
    const key = `${operation.rootKind}:${operation.id}`;
    if (operation.type === "remove") roots.delete(key);
    else if (operation.descriptor) roots.set(key, operation.descriptor);
  }
  for (const record of records.values()) {
    if (!current(accountId, captured)) return;
    await useId3MetadataStore.getState().restoreRecord(record);
  }
  if (!current(accountId, captured)) return;
  useImportedDriveStore.getState().hydrateRemoteRoots([...roots.values()]);
  revision = Math.max(
    data.revision,
    ...[...acknowledgedRoots.values()].map((ack) => ack.revision),
  );
  useDriveAppDataStore.setState({
    savedCount: savedTrackCount(),
    approximateBytes,
    cutoff: data.cutoff ?? null,
    migrationVersion: data.migrationVersion ?? 0,
  });
}

function retryRestoreInBackground(
  error: unknown,
  accountId: string,
  generation: string | undefined,
  captured: number,
) {
  const code = failure(error);
  const transient =
    error instanceof TypeError ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)) ||
    [
      "backup_unavailable",
      "appdata_unavailable",
      "appdata_rate_limited",
      "appdata_provider_uncertain",
      "appdata_control_unavailable",
      "appdata_restore_changed",
      "network_error",
      "offline",
      "Failed to fetch",
    ].includes(code);
  if (
    !transient ||
    restoreRetryTimer ||
    restoreRetryAttempts >= 2 ||
    !current(accountId, captured) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  )
    return;
  const delay = restoreRetryAttempts++ === 0 ? 2000 : 5000;
  restoreRetryTimer = setTimeout(() => {
    restoreRetryTimer = undefined;
    if (current(accountId, captured))
      void restoreDriveAppData(accountId, generation).catch(() => {});
  }, delay);
}

/** Explicit network restore. Local cache hydration/cache_only never calls this. */
export function restoreDriveAppData(
  accountId: string,
  generation?: string,
): Promise<void> {
  if (restoreFlight && useDriveAppDataStore.getState().accountId === accountId)
    return restoreFlight;
  if (restoreRetryTimer) clearTimeout(restoreRetryTimer);
  restoreRetryTimer = undefined;
  const importedState = useImportedDriveStore.getState();
  const rememberedAccount =
    importedState.accountId ?? getRememberedMetadataAccountId();
  const legacyRoots =
    !rememberedAccount || rememberedAccount === accountId
      ? [...importedState.rootFolders, ...importedState.rootFiles]
      : [];
  if (useDriveAppDataStore.getState().accountId !== accountId) {
    session++;
    draft = null;
    savedKeys.clear();
    pendingKeys.clear();
    preRestoreOperations.length = 0;
    removedRoots.clear();
    freshRestoreRoots.clear();
    remoteVariants.clear();
    acknowledgedRoots.clear();
    revision = 0;
    useDriveAppDataStore.setState({
      accountId,
      generation: generation ?? null,
      savedCount: 0,
      pendingCount: 0,
      approximateBytes: 0,
      lastSavedAt: null,
    });
  }
  const captured = session;
  listenForLocalChanges();
  useDriveAppDataStore.setState({ status: "restoring", error: null });
  const flight = (async () => {
    if (!current(accountId, captured)) return;
    await useId3MetadataStore.getState().setAccount(accountId);
    const data = await readRemoteData(accountId, captured);
    if (!current(accountId, captured)) return;
    // Only a truly uninitialized remote root history may adopt this browser's
    // previous local choices. A peer removal history always takes precedence.
    if (
      importedState.accountGeneration &&
      importedState.accountGeneration !== data.generation
    ) {
      await clearPortableCache(accountId);
      await useId3MetadataStore.getState().resetCachedMetadata();
      if (!current(accountId, captured)) return;
    }
    useImportedDriveStore.getState().bindAccount(accountId, data.generation);
    if (
      (!importedState.accountGeneration ||
        importedState.accountGeneration === data.generation) &&
      !data.envelopes.some((envelope) => envelope.kind === "roots")
    ) {
      preRestoreOperations.unshift(
        ...legacyRoots.map(
          (descriptor): RootOperation => ({
            type: "add",
            rootKind:
              descriptor.mimeType === "application/vnd.google-apps.folder"
                ? "folder"
                : "track",
            id: descriptor.id,
            descriptor,
          }),
        ),
      );
    }
    await applyRemote(data, accountId, captured);
    if (!current(accountId, captured)) return;
    if (preRestoreOperations.length) {
      await queueImportedRootOperations(preRestoreOperations.splice(0));
      await applyRemote(data, accountId, captured);
    }
    if (!current(accountId, captured)) return;
    const entries = await readPortableCache(accountId);
    if (!current(accountId, captured)) return;
    for (const entry of entries) {
      if (entry.generation !== data.generation) continue;
      if (entry.kind === "outbox" && commandFor(entry).kind === "tags") {
        for (const record of (
          commandFor(entry).payload as { records: MetadataRecord[] }
        ).records)
          pendingKeys.add(metadataKey(record));
      }
    }
    useDriveAppDataStore.setState({
      status: "ready",
      savedCount: savedTrackCount(),
    });
    await updatePending(accountId, captured);
    // Persist the checkpoint intent before returning, but never await a full
    // local-cache walk or its uploads in the normal-use gate.
    await markPortableMetadataDirty(accountId, data.generation);
    if (!current(accountId, captured)) return;
    checkpointLocalMetadata(accountId, data.generation, captured);
    restoreRetryAttempts = 0;
    scheduleFlush();
  })()
    .catch((error) => {
      if (current(accountId, captured))
        useDriveAppDataStore.setState({
          status: "error",
          error: failure(error),
        });
      retryRestoreInBackground(error, accountId, generation, captured);
      throw error;
    })
    .finally(() => {
      if (restoreFlight === flight) restoreFlight = null;
    });
  restoreFlight = flight;
  return flight;
}

/** Offline startup after a separately verified consent/readiness marker. No HTTP. */
export async function deferDriveAppDataRestore(
  accountId: string,
  generation: string,
) {
  if (
    useDriveAppDataStore.getState().accountId !== accountId ||
    useDriveAppDataStore.getState().generation !== generation
  ) {
    await stopDriveAppData();
    useDriveAppDataStore.setState({ accountId, generation });
  }
  listenForLocalChanges();
  useDriveAppDataStore.setState({
    status: "error",
    error: "offline_restore_pending",
  });
  await useId3MetadataStore.getState().setAccount(accountId);
  const imported = useImportedDriveStore.getState();
  if (imported.accountGeneration && imported.accountGeneration !== generation) {
    await clearPortableCache(accountId);
    await useId3MetadataStore.getState().resetCachedMetadata();
  }
  useImportedDriveStore.getState().bindAccount(accountId, generation);
  await updatePending(accountId, session);
}

/** Does not start restore; on failed restore it must never fall through to extraction. */
export async function waitForDriveAppDataRestore(
  accountId: string,
  descriptor?: MetadataDescriptor,
): Promise<boolean> {
  const state = useDriveAppDataStore.getState();
  if (state.accountId !== accountId) return state.accountId === null;
  if (restoreFlight) await restoreFlight.catch(() => {});
  if (
    useDriveAppDataStore.getState().accountId !== accountId ||
    useDriveAppDataStore.getState().status !== "ready"
  )
    return false;
  const fingerprint = descriptor && getMetadataFingerprint(descriptor);
  if (descriptor && fingerprint) {
    const record = remoteVariants.get(
      metadataKey({
        fileId: descriptor.id,
        fingerprint,
        parserVersion: METADATA_PARSER_VERSION,
        policyVersion: METADATA_POLICY_VERSION,
        schemaVersion: METADATA_SCHEMA_VERSION,
      } as MetadataRecord),
    );
    if (record)
      await useId3MetadataStore.getState().restoreRecord(record, fingerprint);
  }
  return (
    useDriveAppDataStore.getState().accountId === accountId &&
    useDriveAppDataStore.getState().status === "ready"
  );
}

export function flushDriveAppData(): Promise<void> {
  if (flushFlight) return flushFlight;
  const captured = session;
  const flight = (async () => {
    await queueTail;
    const state = useDriveAppDataStore.getState();
    if (!state.accountId || !state.generation || state.status !== "ready")
      return;
    const accountId = state.accountId;
    const outstanding = await readPortableCache(accountId);
    if (
      outstanding.some(
        (entry) =>
          entry.kind === "outbox" &&
          entry.generation === state.generation &&
          entry.readyToSeal === false,
      )
    ) {
      // A root edit may have arrived after the restore snapshot was read. It
      // remains unsendable until a complete snapshot resolves its base revision.
      await applyRemote(
        await readRemoteData(accountId, captured),
        accountId,
        captured,
      );
      if (!current(accountId, captured)) return;
    }
    let entries: PortableCacheEntry[] = [];
    await enqueue(async () => {
      if (!current(accountId, captured)) return;
      draft = null; // Seal in the same serial queue used by draft writes.
      entries = await sealPortableOutbox(accountId);
    });
    for (let entry of entries) {
      if (!current(accountId, captured)) return;
      if (useDriveAppDataStore.getState().status !== "ready") {
        scheduleFlush();
        return;
      }
      if (entry.kind !== "outbox" || entry.generation !== state.generation)
        continue;
      const durableEntry = await readPortableOutbox(entry.id);
      if (!durableEntry) continue;
      entry = durableEntry;
      let command = commandFor(entry);
      let ack: {
        generation: string;
        operationId: string;
        revision: number;
        savedAt: string | number;
        bytes: number;
      };
      try {
        ack = await request("/api/appdata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
      } catch (error) {
        const cancelled = failure(error) === "appdata_operation_cancelled";
        if (
          !cancelled &&
          (failure(error) !== "revision_conflict" || command.kind !== "roots")
        )
          throw error;
        // A predecessor or peer may have changed the durable causal base after
        // this flush took its snapshot. Never filter against an obsolete body.
        const latest = await readPortableOutbox(entry.id);
        if (!latest) {
          scheduleFlush();
          continue;
        }
        entry = latest;
        command = commandFor(entry);
        await applyRemote(
          await readRemoteData(accountId, captured),
          accountId,
          captured,
        );
        if (!current(accountId, captured)) return;
        let retry = command;
        if (command.kind === "roots") {
          const operations = (
            command.payload as { operations: RootOperation[] }
          ).operations.filter(
            (operation) =>
              operation.type !== "add" ||
              (removedRoots.get(`${operation.rootKind}:${operation.id}`) ??
                -1) <= (command.baseRevision ?? -1),
          );
          if (!operations.length) {
            if (!(await acknowledgePortableOutbox(entry.id, command)))
              throw new Error("backup_queue_changed");
            await updatePending(accountId, captured);
            continue;
          }
          retry = {
            ...command,
            baseRevision: revision,
            payload: { operations },
          };
        }
        if (cancelled) retry = { ...retry, operationId: crypto.randomUUID() };
        const replacement = {
          ...entry,
          id: retry.operationId,
          payload: retry,
          bytes: bytes(retry),
        };
        const winner = cancelled
          ? await renewPortableOutboxIdentity(replacement, command)
          : await replacePortableOutbox(replacement, command);
        if (!winner) {
          await updatePending(accountId, captured);
          scheduleFlush();
          continue;
        }
        entry = winner;
        command = commandFor(entry);
        ack = await request("/api/appdata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
      }
      if (!current(accountId, captured)) return;
      if (
        ack.generation !== state.generation ||
        ack.operationId !== command.operationId
      )
        throw new Error("invalid_save_acknowledgment");
      const keys =
        command.kind === "tags"
          ? (command.payload as { records: MetadataRecord[] }).records.map(
              metadataKey,
            )
          : [];
      const removed = await acknowledgePortableOutbox(
        entry.id,
        command,
        ack.revision,
      );
      if (!current(accountId, captured)) return;
      for (const key of keys) {
        savedKeys.add(key);
        pendingKeys.delete(key);
      }
      revision = Math.max(revision, ack.revision);
      if (command.kind === "roots")
        for (const operation of (
          command.payload as { operations: RootOperation[] }
        ).operations) {
          const key = `${operation.rootKind}:${operation.id}`;
          if ((acknowledgedRoots.get(key)?.revision ?? 0) < ack.revision)
            acknowledgedRoots.set(key, { revision: ack.revision, operation });
        }
      retryDelay = 2000;
      useDriveAppDataStore.setState({
        savedCount: savedTrackCount(),
        approximateBytes:
          useDriveAppDataStore.getState().approximateBytes + ack.bytes,
        lastSavedAt:
          typeof ack.savedAt === "number"
            ? ack.savedAt
            : Date.parse(ack.savedAt),
        error: null,
      });
      await updatePending(accountId, captured);
      if (!removed) throw new Error("backup_queue_changed");
    }
    if (!current(accountId, captured)) return;
    const remaining = await readPortableCache(accountId);
    if (
      remaining.some(
        (entry) =>
          entry.kind === "outbox" &&
          entry.generation === state.generation &&
          entry.readyToSeal === false,
      )
    )
      scheduleFlush();
    const dirty = remaining.some(
      (entry) =>
        entry.kind === "dirty" && entry.generation === state.generation,
    );
    if (dirty) checkpointLocalMetadata(accountId, state.generation, captured);
  })()
    .catch((error) => {
      if (captured === session) {
        useDriveAppDataStore.setState({ error: failure(error) });
        if (
          ![
            "appdata_access_required",
            "appdata_operation_conflict",
            "appdata_invalid_payload",
          ].includes(failure(error))
        ) {
          scheduleFlush(retryDelay);
          retryDelay = Math.min(60_000, retryDelay * 2);
        }
      }
      throw error;
    })
    .finally(() => {
      if (flushFlight === flight) flushFlight = null;
    });
  flushFlight = flight;
  return flight;
}

/** Read-only warning state. Ordinary logout still fences then clears, without HTTP. */
export async function getDriveAppDataLogoutState() {
  await queueTail;
  const state = useDriveAppDataStore.getState();
  const captured = session;
  if (!state.accountId || !state.generation)
    return { pendingCount: 0, checkpointPending: false, incomplete: false };
  try {
    const entries = await readPortableCache(state.accountId);
    if (!current(state.accountId, captured))
      return { pendingCount: 0, checkpointPending: false, incomplete: false };
    const pendingCount = entries
      .filter(
        (entry) =>
          entry.kind === "outbox" && entry.generation === state.generation,
      )
      .reduce(
        (sum, entry) =>
          sum +
          (commandFor(entry).kind === "tags"
            ? (commandFor(entry).payload as { records: MetadataRecord[] })
                .records.length
            : 1),
        0,
      );
    const checkpointPending =
      Boolean(checkpointFlight && checkpointSession === captured) ||
      entries.some(
        (entry) =>
          entry.kind === "dirty" && entry.generation === state.generation,
      );
    return {
      pendingCount,
      checkpointPending,
      incomplete: pendingCount > 0 || checkpointPending,
    };
  } catch {
    return {
      pendingCount: state.pendingCount,
      checkpointPending: true,
      incomplete: true,
    };
  }
}

/** Local lifecycle fence; logout never calls a remote delete. */
export async function stopDriveAppData(
  accountId?: string,
  options: { clearLocal?: boolean } = {},
) {
  if (accountId && useDriveAppDataStore.getState().accountId !== accountId)
    return;
  const previous = useDriveAppDataStore.getState().accountId;
  stopListeningForLocalChanges();
  session++;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (restoreRetryTimer) clearTimeout(restoreRetryTimer);
  restoreRetryTimer = undefined;
  restoreRetryAttempts = 0;
  draft = null;
  restoreFlight = null;
  flushFlight = null;
  checkpointFlight = null;
  savedKeys.clear();
  pendingKeys.clear();
  preRestoreOperations.length = 0;
  removedRoots.clear();
  freshRestoreRoots.clear();
  remoteVariants.clear();
  acknowledgedRoots.clear();
  useDriveAppDataStore.setState({
    accountId: null,
    generation: null,
    status: "idle",
    savedCount: 0,
    pendingCount: 0,
    approximateBytes: 0,
    lastSavedAt: null,
    error: null,
    cutoff: null,
    migrationVersion: 0,
  });
  retryDelay = 2000;
  await queueTail;
  if (options.clearLocal && previous) await clearPortableCache(previous);
}
