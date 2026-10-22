import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMetadataFingerprint,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import type { DriveFile } from "@/types";

const fixtures = vi.hoisted(() => ({
  records: {} as Record<string, MetadataRecord>,
  scan: vi.fn(),
}));
vi.mock("@/lib/known-track-resolver", () => ({
  resolveKnownTrack: () => null,
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  scanMetadataRecords: fixtures.scan,
}));
vi.mock("@/lib/drive-metadata-reader", () => ({
  metadataEnvironmentKey: () => "host",
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: {
    getState: () => ({ accountId: "account", records: fixtures.records }),
  },
}));
const track = (id: string): DriveFile => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
  size: "100",
  modifiedTime: "2026-10-22",
});
function record(
  track: DriveFile,
  status: MetadataRecord["status"],
): MetadataRecord {
  return {
    accountId: "account",
    fileId: track.id,
    fingerprint: getMetadataFingerprint(track),
    status,
    tags: status === "ready" ? { artist: "Artist" } : undefined,
    reason: status === "unresolved" ? "unsupported_format" : undefined,
    loadedVia: "drive_range",
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    checkedAt: 1,
    checkedFields: ["title", "artist", "album"],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.records = {};
});
describe("persisted metadata coverage beyond the memory cache", () => {
  it("keeps memory and durable budget deferrals pending while counting real parse failures", async () => {
    const tracks = [
      track("parse"),
      track("memory-budget"),
      track("durable-budget"),
    ];
    fixtures.records.parse = {
      ...record(tracks[0], "unresolved"),
      reason: "parse_error",
    };
    fixtures.records["memory-budget"] = {
      ...record(tracks[1], "unresolved"),
      reason: "budget_exceeded",
    };
    fixtures.scan.mockImplementation(async (_account, visit) => {
      visit({ ...record(tracks[2], "unresolved"), reason: "budget_exceeded" });
      return true;
    });
    const { buildPersistedMetadataCoverage } = await import(
      "./persisted-metadata-coverage"
    );
    const result = await buildPersistedMetadataCoverage(
      "account",
      tracks,
      (file) => {
        const value = fixtures.records[file.id];
        return value
          ? { status: value.status, freshness: "current", reason: value.reason }
          : { status: "missing", freshness: "unknown" };
      },
    );
    expect(result).toMatchObject({
      total: 3,
      checked: 0,
      unresolved: 1,
      unknown: 2,
      remaining: 2,
      unresolvedReasons: { parse_error: 1 },
      metadataSearchComplete: false,
    });
    expect(fixtures.records["durable-budget"]).toBeUndefined();
  });
  it("counts evicted positive, confirmed empty and unresolved outcomes without hydrating tags", async () => {
    const tracks = [track("ready"), track("empty"), track("unresolved")];
    fixtures.scan.mockImplementation(async (_account, visit) => {
      for (const [index, status] of (
        ["ready", "no_target_tags", "unresolved"] as const
      ).entries())
        visit(record(tracks[index], status));
      return true;
    });
    const { buildPersistedMetadataCoverage } = await import(
      "./persisted-metadata-coverage"
    );
    const result = await buildPersistedMetadataCoverage(
      "account",
      tracks,
      () => ({ status: "missing", freshness: "unknown" }),
    );
    expect(result).toMatchObject({
      ready: 1,
      noTargetTags: 1,
      unresolved: 1,
      unknown: 0,
      checked: 2,
      total: 3,
      remaining: 0,
      metadataSearchComplete: false,
      fields: { artist: 1 },
      unresolvedReasons: { unsupported_format: 1 },
    });
    expect(fixtures.records).toEqual({});
  });
  it("counts stale fingerprints and ignores foreign/outside-scope records", async () => {
    const included = track("included");
    fixtures.scan.mockImplementation(async (_account, visit) => {
      visit({ ...record(included, "ready"), fingerprint: "old" });
      visit(record(track("outside"), "ready"));
      visit({ ...record(included, "ready"), accountId: "other-account" });
      return true;
    });
    const { buildPersistedMetadataCoverage } = await import(
      "./persisted-metadata-coverage"
    );
    const result = await buildPersistedMetadataCoverage(
      "account",
      [included],
      () => ({ status: "missing", freshness: "unknown" }),
    );
    expect(result).toMatchObject({
      total: 1,
      stale: 1,
      unknown: 0,
      ready: 0,
      checked: 0,
      remaining: 1,
    });
  });
  it("yields task turns while checking a3k-track Library so interaction work can run", async () => {
    vi.useFakeTimers();
    try {
      fixtures.scan.mockResolvedValue(true);
      const { buildPersistedMetadataCoverage } = await import(
        "./persisted-metadata-coverage"
      );
      const read = vi.fn(() => ({
        status: "missing" as const,
        freshness: "unknown" as const,
      }));
      const pending = buildPersistedMetadataCoverage(
        "account",
        Array.from({ length: 3000 }, (_, index) => track(`yield-${index}`)),
        read,
      );
      expect(read).toHaveBeenCalledTimes(100);
      let interactionRan = false;
      setTimeout(() => {
        interactionRan = true;
      }, 0);
      await vi.advanceTimersByTimeAsync(1);
      expect(interactionRan).toBe(true);
      expect(read.mock.calls.length).toBeLessThan(3000);
      await vi.runAllTimersAsync();
      expect((await pending).total).toBe(3000);
    } finally {
      vi.useRealTimers();
    }
  });
});
