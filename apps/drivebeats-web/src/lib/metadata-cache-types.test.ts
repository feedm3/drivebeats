import { describe, expect, it } from "vitest";
import {
  getMetadataFreshness,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_RANGE_STRATEGY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";

const descriptor = { id: "synthetic", modifiedTime: "v1", size: "1000" };
const record: MetadataRecord = {
  accountId: "synthetic-account",
  fileId: descriptor.id,
  fingerprint: JSON.stringify([descriptor.modifiedTime, descriptor.size]),
  parserVersion: METADATA_PARSER_VERSION,
  policyVersion: METADATA_POLICY_VERSION,
  schemaVersion: METADATA_SCHEMA_VERSION,
  checkedAt: 1,
  checkedFields: ["title", "artist", "album"],
  status: "unresolved",
  reason: "budget_exceeded",
  loadedVia: "drive_range",
};

describe("range strategy freshness", () => {
  it("reconsiders only legacy range budget negatives after the unused tail probe is removed", () => {
    expect(getMetadataFreshness(record, descriptor)).toBe("stale");
    expect(
      getMetadataFreshness({ ...record, rangeStrategyVersion: 1 }, descriptor),
    ).toBe("stale");
    expect(
      getMetadataFreshness(
        { ...record, rangeStrategyVersion: METADATA_RANGE_STRATEGY_VERSION },
        descriptor,
      ),
    ).toBe("current");
    for (const retained of [
      {
        ...record,
        status: "ready" as const,
        reason: undefined,
        tags: { title: "Saved" },
      },
      { ...record, status: "no_target_tags" as const, reason: undefined },
      { ...record, reason: "parse_error" },
      { ...record, loadedVia: "local_blob" as const },
    ])
      expect(getMetadataFreshness(retained, descriptor)).toBe("current");
  });
});
