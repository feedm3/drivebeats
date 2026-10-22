import type { Id3Metadata } from "@/lib/id3-metadata";

export const METADATA_PARSER_VERSION = "jsmediatags-3.9.7-text-1";
export const METADATA_POLICY_VERSION = 2;
export const METADATA_SCHEMA_VERSION = 1;
export const METADATA_RANGE_STRATEGY_VERSION = 2;

export interface MetadataDescriptor {
  id: string;
  modifiedTime?: string;
  size?: string;
  mimeType?: string;
  name?: string;
}

export interface MetadataOutcome {
  status: "ready" | "no_target_tags" | "unresolved";
  tags?: Id3Metadata;
  loadedVia: "local_blob" | "drive_range";
  reason?: string;
  environmentKey?: string;
  rangeStrategyVersion?: number;
  /** Consecutive bounded reader limits for this content and reading strategy. */
  retryCount?: number;
}

export interface MetadataRecord extends MetadataOutcome {
  accountId: string;
  fileId: string;
  fingerprint: string | null;
  parserVersion: string;
  policyVersion: number;
  schemaVersion: number;
  checkedAt: number;
  checkedFields: readonly ["title", "artist", "album"];
  mimeType?: string;
}

export type MetadataFreshness = "current" | "stale" | "unknown";

export function isMetadataBudgetDeferred(
  record: { status: string; reason?: string } | undefined,
) {
  return record?.status === "unresolved" && record.reason === "budget_exceeded";
}

export function getMetadataBudgetRetryCount(record: MetadataOutcome) {
  return Number.isSafeInteger(record.retryCount) && (record.retryCount ?? 0) > 0
    ? Math.min(7, record.retryCount as number)
    : 1;
}

/** Legacy saved limits also wait before retrying; reloads never reset backoff. */
export function getMetadataBudgetRetryAt(record: MetadataRecord) {
  if (!isMetadataBudgetDeferred(record)) return 0;
  const delay = Math.min(
    24 * 60 * 60_000,
    30 * 60_000 * 2 ** (getMetadataBudgetRetryCount(record) - 1),
  );
  return record.checkedAt + delay;
}

/** An absent validator is never an enduring cache hit. */
export function getMetadataFingerprint(
  track: MetadataDescriptor,
): string | null {
  if (!track.modifiedTime || !track.size || !/^\d+$/.test(track.size))
    return null;
  return JSON.stringify([track.modifiedTime, track.size]);
}

export function getMetadataFreshness(
  record: MetadataRecord | undefined,
  track: MetadataDescriptor,
  environmentKey?: string,
): MetadataFreshness {
  if (!record) return "unknown";
  const fingerprint = getMetadataFingerprint(track);
  if (!fingerprint || !record.fingerprint) return "unknown";
  if (
    record.fingerprint !== fingerprint ||
    record.parserVersion !== METADATA_PARSER_VERSION ||
    record.policyVersion !== METADATA_POLICY_VERSION ||
    record.schemaVersion !== METADATA_SCHEMA_VERSION ||
    (record.status === "unresolved" &&
      record.reason === "budget_exceeded" &&
      record.loadedVia === "drive_range" &&
      record.rangeStrategyVersion !== METADATA_RANGE_STRATEGY_VERSION) ||
    (record.environmentKey !== undefined &&
      record.environmentKey !== environmentKey)
  )
    return "stale";
  return "current";
}
