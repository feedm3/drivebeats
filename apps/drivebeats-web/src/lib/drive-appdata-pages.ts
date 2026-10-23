import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  type AppDataControl,
  AppDataError,
  type AppDataIdentity,
  type AppDataOperation,
} from "@/db/appdata-types";
import {
  APPDATA_MAX_RESTORE_BYTES,
  type AppDataEnvelope,
} from "@/lib/drive-appdata-schema";

/** Includes JSON escaping, fragment headers, base64 and the next signed cursor. */
export const APPDATA_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_FILES = 16;
interface PageCursor {
  v: 1;
  accountId: string;
  generation: string;
  revision: number;
  authority: string;
  manifest: string;
  source: string;
  migrationVersion: number;
  index: number;
  offset: number;
}
export interface AppDataPageFragment {
  operationId: string;
  offset: number;
  data: string;
  end: boolean;
}
export interface AppDataPage {
  format: 1;
  generation: string;
  revision: number;
  source: string;
  migrationVersion: number;
  cutoff: string | null;
  fragments: AppDataPageFragment[];
  nextCursor: string | null;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function signingKey(explicit?: string) {
  const value = explicit ?? process.env.AUTH_SESSION_SECRET;
  if (!value) throw new AppDataError("appdata_configuration_error");
  return value;
}
function encodeCursor(value: PageCursor, key: string) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}
function decodeCursor(value: string, key: string): PageCursor {
  try {
    if (value.length > 2048) throw new Error();
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || extra) throw new Error();
    const expected = createHmac("sha256", key).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as PageCursor;
    if (
      parsed.v !== 1 ||
      typeof parsed.accountId !== "string" ||
      typeof parsed.generation !== "string" ||
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 0 ||
      !Number.isSafeInteger(parsed.index) ||
      parsed.index < 0 ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0 ||
      typeof parsed.authority !== "string" ||
      typeof parsed.manifest !== "string" ||
      typeof parsed.source !== "string" ||
      !Number.isSafeInteger(parsed.migrationVersion)
    )
      throw new Error();
    return parsed;
  } catch {
    throw new AppDataError("appdata_invalid_cursor");
  }
}
function committed(operations: AppDataOperation[]) {
  return operations
    .filter((op) => op.status === "committed")
    .sort(
      (a, b) =>
        a.revision - b.revision || a.operationId.localeCompare(b.operationId),
    );
}
function authority(operations: AppDataOperation[]) {
  return digest(
    committed(operations)
      .filter((op) => op.kind !== "tags")
      .map((op) => [op.operationId, op.revision, op.bodyHash]),
  );
}
function manifest(operations: AppDataOperation[], revision: number) {
  return digest(
    committed(operations)
      .filter((op) => op.revision <= revision)
      .map((op) => [
        op.operationId,
        op.revision,
        op.fileId,
        op.bodyHash,
        op.bytes,
      ]),
  );
}

/** Lazy Drive reads for one bounded response, with an O(1) authenticated cursor.
 * A page never needs earlier pages' media. Oversized individual envelopes are
 * fragmented; only that one envelope is reread when its next fragment is needed. */
export async function readDriveAppDataPage(
  dependencies: {
    control: AppDataControl;
    readEnvelope: (op: AppDataOperation) => Promise<AppDataEnvelope>;
    cursorSecret?: string;
  },
  identity: AppDataIdentity,
  cursor?: string,
): Promise<AppDataPage> {
  const { control, readEnvelope } = dependencies;
  const key = signingKey(dependencies.cursorSecret);
  const account = await control.assertIdentity(identity);
  const [operations, rollout] = await Promise.all([
    control.list(identity),
    control.getRollout(),
  ]);
  const pending = operations.filter(
    (op) =>
      op.kind !== "tags" &&
      ["reserved", "uploading", "uncertain"].includes(op.status),
  );
  const safeRevision = Math.min(
    account.revision,
    ...pending.map((op) => op.revision - 1),
  );
  const state: PageCursor = cursor
    ? decodeCursor(cursor, key)
    : {
        v: 1,
        accountId: identity.accountId,
        generation: identity.generation,
        revision: safeRevision,
        authority: authority(operations),
        manifest: manifest(operations, safeRevision),
        source: account.source,
        migrationVersion: account.migrationVersion,
        index: 0,
        offset: 0,
      };
  if (
    state.accountId !== identity.accountId ||
    state.generation !== identity.generation
  )
    throw new AppDataError("appdata_invalid_cursor");
  if (
    state.revision > account.revision ||
    state.source !== account.source ||
    state.migrationVersion !== account.migrationVersion ||
    state.authority !== authority(operations) ||
    state.manifest !== manifest(operations, state.revision)
  )
    throw new AppDataError("appdata_restore_changed");
  const selected = committed(operations).filter(
    (op) => op.revision <= state.revision,
  );
  if (
    selected.reduce((sum, op) => sum + op.bytes, 0) > APPDATA_MAX_RESTORE_BYTES
  )
    throw new AppDataError("appdata_compaction_required");
  if (
    state.index > selected.length ||
    (state.index === selected.length && state.offset !== 0)
  )
    throw new AppDataError("appdata_invalid_cursor");
  const page: AppDataPage = {
    format: 1,
    generation: identity.generation,
    revision: state.revision,
    source: account.source,
    migrationVersion: account.migrationVersion,
    cutoff: rollout?.cleanupDueAt ?? null,
    fragments: [],
    nextCursor: null,
  };
  const rawBudget = Math.floor((APPDATA_MAX_PAGE_BYTES * 3) / 4) - 8192;
  const envelopeBytes = (op: AppDataOperation) =>
    op.bytes +
    Buffer.byteLength(
      JSON.stringify({
        format: 1,
        accountId: identity.accountId,
        generation: identity.generation,
        revision: op.revision,
      }),
    ) -
    1;
  // Fetch only the candidate files for this page, with the same bounded
  // parallelism as full restore. Operation sizes avoid downloading the backup.
  let stop = state.index;
  let estimate = 0;
  while (
    stop < selected.length &&
    stop - state.index < MAX_PAGE_FILES &&
    (stop === state.index || estimate < rawBudget)
  ) {
    estimate += Math.max(
      0,
      envelopeBytes(selected[stop]) - (stop === state.index ? state.offset : 0),
    );
    stop++;
  }
  const media = new Map<number, Buffer>();
  let work = state.index;
  await Promise.all(
    Array.from({ length: Math.min(8, stop - state.index) }, async () => {
      while (work < stop) {
        const index = work++;
        media.set(
          index,
          Buffer.from(
            JSON.stringify(await readEnvelope(selected[index])),
            "utf8",
          ),
        );
      }
    }),
  );
  while (state.index < stop) {
    const raw = media.get(state.index);
    if (!raw || state.offset >= raw.length)
      throw new AppDataError("appdata_invalid_cursor");
    const available =
      APPDATA_MAX_PAGE_BYTES -
      Buffer.byteLength(JSON.stringify(page), "utf8") -
      4096;
    const take = Math.min(
      raw.length - state.offset,
      Math.floor(Math.max(0, available - 512) / 4) * 3,
    );
    if (take <= 0) break;
    const end = state.offset + take === raw.length;
    page.fragments.push({
      operationId: selected[state.index].operationId,
      offset: state.offset,
      data: raw.subarray(state.offset, state.offset + take).toString("base64"),
      end,
    });
    if (end) {
      state.index++;
      state.offset = 0;
    } else {
      state.offset += take;
      break;
    }
  }
  if (state.index < selected.length) page.nextCursor = encodeCursor(state, key);
  if (Buffer.byteLength(JSON.stringify(page), "utf8") > APPDATA_MAX_PAGE_BYTES)
    throw new AppDataError("appdata_page_too_large");
  const finalAccount = await control.assertIdentity(identity);
  const finalOperations = await control.list(identity);
  if (
    finalAccount.source !== state.source ||
    finalAccount.migrationVersion !== state.migrationVersion ||
    authority(finalOperations) !== state.authority ||
    manifest(finalOperations, state.revision) !== state.manifest
  )
    throw new AppDataError("appdata_restore_changed");
  return page;
}
