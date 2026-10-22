import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_RANGE_STRATEGY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import { getMetadataUnresolvedDiagnostics } from "@/lib/metadata-diagnostics";
import type { MetadataView } from "@/lib/track-metadata-loader";
import type { DriveFile } from "@/types";

const mocks = vi.hoisted(() => ({
  account: "a" as string | null,
  store: {
    accountId: "a",
    generation: 1,
    records: {} as Record<string, MetadataRecord>,
  },
  search: {
    catalog: null as {
      userId: string;
      importsSignature: string;
      tracks: DriveFile[];
    } | null,
    invalidated: false,
  },
  durable: [] as MetadataRecord[],
  states: new Map<string, MetadataView>(),
  proven: new Set<string>(),
  onScan: vi.fn(),
}));
vi.mock("@/lib/drive-metadata-reader", () => ({
  metadataEnvironmentKey: () => "environment",
}));
vi.mock("@/lib/metadata-local-account", () => ({
  getLocalMetadataAccountId: () => mocks.account,
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: { getState: () => mocks.store },
}));
vi.mock("@/stores/library-search-store", () => ({
  getLibrarySearchImportsSignature: () => "imports",
  useLibrarySearchStore: { getState: () => mocks.search },
}));
vi.mock("@/lib/known-track-resolver", () => ({
  getKnownTrackDescriptorRevision: () => 1,
  resolveKnownTrack: (accountId: string, id: string) => {
    const track = mocks.search.catalog?.tracks.find((entry) => entry.id === id);
    return accountId === mocks.account && mocks.proven.has(id) && track
      ? { accountId, track }
      : null;
  },
}));
vi.mock("@/lib/track-metadata-loader", () => ({
  getTrackMetadataState: (known: { track: DriveFile }) =>
    mocks.states.get(known.track.id) ?? {
      status: "missing",
      freshness: "unknown",
    },
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  scanMetadataRecords: async (
    _accountId: string,
    visit: (record: MetadataRecord) => void,
  ) => {
    for (const record of mocks.durable) visit(record);
    await mocks.onScan();
    return true;
  },
}));

function track(id: string): DriveFile {
  return {
    id,
    name: `${id}.mp3`,
    mimeType: "audio/mpeg",
    size: "1000",
    modifiedTime: "v1",
  };
}
function record(id: string, reason: string): MetadataRecord {
  return {
    accountId: "a",
    fileId: id,
    fingerprint: JSON.stringify(["v1", "1000"]),
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    checkedAt: 10,
    checkedFields: ["title", "artist", "album"],
    status: "unresolved",
    reason,
    loadedVia: "drive_range",
    rangeStrategyVersion: METADATA_RANGE_STRATEGY_VERSION,
  };
}
function catalog(ids: string[]) {
  mocks.search.catalog = {
    userId: "a",
    importsSignature: "imports",
    tracks: ids.map(track),
  };
  mocks.proven = new Set(ids);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "a";
  mocks.store = { accountId: "a", generation: 1, records: {} };
  mocks.search.invalidated = false;
  mocks.search.catalog = null;
  mocks.durable = [];
  mocks.states.clear();
  mocks.proven.clear();
  mocks.onScan.mockResolvedValue(undefined);
});

describe("cache-only metadata issue details", () => {
  it("lists only current proven saved unresolved records without media reads or guessing a budget subreason", async () => {
    catalog(["parse", "large", "temporary", "batch"]);
    mocks.store.records.parse = record("parse", "parse_error");
    mocks.durable = [record("large", "budget_exceeded")];
    mocks.states.set("temporary", {
      status: "error",
      freshness: "unknown",
      error: { code: "network_error", retryable: true, retryAfterMs: 12000 },
    });
    mocks.states.set("batch", {
      status: "deferred",
      freshness: "unknown",
      error: { code: "budget_exceeded", retryable: true },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await getMetadataUnresolvedDiagnostics();
    expect(result).toMatchObject({
      available: true,
      total: 2,
      truncated: false,
      tracks: [
        {
          id: "parse",
          fileName: "parse.mp3",
          reason: "parse_error",
          retryable: false,
        },
        {
          id: "large",
          reason: "budget_exceeded",
          budget: { scope: "track", maxBytes: 1048576, maxRangeAttempts: 4 },
        },
      ],
    });
    expect(result.tracks.map((row) => row.id)).not.toContain("temporary");
    expect(result.tracks[1].budget).not.toHaveProperty("detail");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("excludes foreign, stale and unproven records and lets current memory success win over old durable failures", async () => {
    catalog(["old", "ready", "unproven"]);
    mocks.proven.delete("unproven");
    mocks.store.records.ready = {
      ...record("ready", "parse_error"),
      status: "ready",
      reason: undefined,
    };
    mocks.durable = [
      record("foreign", "parse_error"),
      {
        ...record("old", "parse_error"),
        fingerprint: JSON.stringify(["v0", "1000"]),
      },
      record("ready", "parse_error"),
      record("unproven", "parse_error"),
    ];
    expect(await getMetadataUnresolvedDiagnostics()).toMatchObject({
      total: 0,
      tracks: [],
    });
  });
  it("limits names to20 while reporting the full issue count and truncation", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `track-${index}`);
    catalog(ids);
    mocks.durable = ids.map((id) => record(id, "parse_error"));
    const result = await getMetadataUnresolvedDiagnostics({ limit: 500 });
    expect(result).toMatchObject({
      limit: 20,
      total: 25,
      truncated: true,
      reasons: [{ code: "parse_error", count: 25 }],
    });
    expect(result.tracks).toHaveLength(20);
  });
  it("returns no details if there is no current owned complete catalog", async () => {
    catalog(["private"]);
    const ownCatalog = mocks.search.catalog;
    if (!ownCatalog) throw new Error("Missing fixture catalog");
    mocks.search.catalog = { ...ownCatalog, userId: "other" };
    expect(await getMetadataUnresolvedDiagnostics()).toMatchObject({
      available: false,
      tracks: [],
    });
    expect(mocks.onScan).not.toHaveBeenCalled();
  });
  it("discards private rows when account/generation changes during the local scan", async () => {
    catalog(["private"]);
    mocks.durable = [record("private", "parse_error")];
    mocks.onScan.mockImplementation(async () => {
      mocks.account = "other";
      mocks.store.generation += 1;
    });
    await expect(getMetadataUnresolvedDiagnostics()).rejects.toMatchObject({
      code: "metadata_changed",
    });
  });
});
