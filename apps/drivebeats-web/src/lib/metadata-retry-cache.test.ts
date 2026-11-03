import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import {
  clearMetadataCache,
  invalidateMetadataFailure,
  loadMetadataCache,
  loadMetadataRecord,
  saveMetadataRecord,
} from "./metadata-cache-db";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "./metadata-cache-types";

const accountId = "metadata-retry-synthetic";
const failed: MetadataRecord = {
  accountId,
  fileId: "failed",
  fingerprint: '["v1","100"]',
  parserVersion: METADATA_PARSER_VERSION,
  policyVersion: METADATA_POLICY_VERSION,
  schemaVersion: METADATA_SCHEMA_VERSION,
  status: "unresolved",
  reason: "parse_error",
  loadedVia: "drive_range",
  checkedAt: 10,
  checkedFields: ["title", "artist", "album"],
};
let epoch: number;
beforeEach(async () => {
  await clearMetadataCache(accountId);
  epoch = (await loadMetadataCache(accountId)).epoch;
  await saveMetadataRecord(failed, epoch);
});

it("invalidates only the selected unavailable outcome while preserving successful tags", async () => {
  const ready = {
    ...failed,
    fileId: "ready",
    status: "ready" as const,
    reason: undefined,
    tags: { title: "Retained" },
  };
  await saveMetadataRecord(ready, epoch);
  await expect(invalidateMetadataFailure(failed, epoch)).resolves.toMatchObject(
    { status: "unresolved", policyVersion: -1 },
  );
  expect((await loadMetadataRecord(accountId, "ready"))?.record).toEqual(ready);
});

it("does not overwrite a success another tab saved after the retry selected its failure", async () => {
  const ready = {
    ...failed,
    status: "ready" as const,
    reason: undefined,
    tags: { title: "Newer success" },
    checkedAt: 20,
  };
  await saveMetadataRecord(ready, epoch);
  await expect(invalidateMetadataFailure(failed, epoch)).resolves.toBeNull();
  expect((await loadMetadataRecord(accountId, "failed"))?.record).toEqual(
    ready,
  );
});

it("cannot restore a selected failure after logout advances the storage fence", async () => {
  await clearMetadataCache(accountId);
  await expect(invalidateMetadataFailure(failed, epoch)).resolves.toBeNull();
  expect(
    (await loadMetadataRecord(accountId, "failed"))?.record,
  ).toBeUndefined();
});
