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
  auth: {
    user: { id: "account" },
    authStatus: "authenticated",
    isLoggingOut: false,
  },
  store: {
    accountId: "account",
    generation: 1,
    records: {} as Record<string, MetadataRecord>,
  },
  signature: "imports",
  scan: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/known-track-resolver", () => ({
  resolveKnownTrack: () => null,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => fixtures.auth },
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: { getState: () => fixtures.store },
}));
vi.mock("@/stores/library-search-store", () => ({
  getLibrarySearchImportsSignature: () => fixtures.signature,
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  scanMetadataRecords: fixtures.scan,
  readMetadataRecords: fixtures.read,
}));

const track = (id: string): DriveFile => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
  modifiedTime: "2026-10-22",
  size: "100",
});
function record(file: DriveFile, artist: string): MetadataRecord {
  return {
    accountId: "account",
    fileId: file.id,
    fingerprint: getMetadataFingerprint(file),
    parserVersion: METADATA_PARSER_VERSION,
    policyVersion: METADATA_POLICY_VERSION,
    schemaVersion: METADATA_SCHEMA_VERSION,
    status: "ready",
    tags: { artist },
    loadedVia: "drive_range",
    checkedAt: 1,
    checkedFields: ["title", "artist", "album"],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.store.generation = 1;
  fixtures.store.records = {};
  fixtures.signature = "imports";
  fixtures.scan.mockResolvedValue(true);
  fixtures.read.mockResolvedValue(true);
});

describe("searching shared persistent local tags", () => {
  it("finds an evicted persisted Artist plus filename token without hydrating or reading media", async () => {
    const files = [track("first"), track("second")];
    fixtures.read.mockImplementation(async (_account, _ids, visit) => {
      visit(record(files[1], "The Artist"));
      return true;
    });
    const { searchCachedLibraryTracks } = await import(
      "./cached-metadata-search"
    );
    const results = await searchCachedLibraryTracks(files, "second artist");
    expect(results).toEqual([
      {
        track: files[1],
        tags: { artist: "The Artist" },
        checkedAt: 1,
        matchedFields: ["filename", "cached_artist"],
      },
    ]);
    expect(fixtures.store.records).toEqual({});
    expect(fixtures.read).toHaveBeenCalledWith(
      "account",
      ["first", "second"],
      expect.any(Function),
      undefined,
    );
    expect(fixtures.scan).not.toHaveBeenCalled();
  });

  it("freezes pending memory tags and excludes stale or foreign persisted records", async () => {
    const files = [track("memory"), track("stale"), track("foreign")];
    fixtures.store.records.memory = record(files[0], "Current artist");
    const stale = { ...record(files[1], "Artist"), fingerprint: "old" };
    const foreign = { ...record(files[2], "Artist"), accountId: "different" };
    fixtures.read.mockImplementation(async (_account, _ids, visit) => {
      visit(record(files[0], "Previous artist"));
      visit(stale);
      visit(foreign);
      return true;
    });
    const { searchCachedLibraryTracks } = await import(
      "./cached-metadata-search"
    );
    const results = await searchCachedLibraryTracks(files, "artist");
    fixtures.store.records.memory.tags = { artist: "Changed later" };
    expect(results.map((result) => result.track.id)).toEqual(["memory"]);
    expect(results[0].tags).toEqual({ artist: "Current artist" });
  });

  it("rejects results if the account generation or imports change while storage is being read", async () => {
    fixtures.read.mockImplementation(async () => {
      fixtures.store.generation += 1;
      return true;
    });
    const { searchCachedLibraryTracks } = await import(
      "./cached-metadata-search"
    );
    await expect(
      searchCachedLibraryTracks([track("track")], "track"),
    ).rejects.toMatchObject({ code: "search_changed" });
  });

  it("uses one account cursor for a large Library rather than thousands of individual reads", async () => {
    const files = Array.from({ length: 201 }, (_, index) =>
      track(String(index)),
    );
    fixtures.scan.mockImplementation(async (_account, visit) => {
      visit(record(files[200], "Persisted artist"));
      return true;
    });
    const { searchCachedLibraryTracks } = await import(
      "./cached-metadata-search"
    );
    expect(
      (await searchCachedLibraryTracks(files, "artist")).map(
        (match) => match.track.id,
      ),
    ).toEqual(["200"]);
    expect(fixtures.read).not.toHaveBeenCalled();
  });

  it("keeps filename search available when durable storage is unavailable", async () => {
    fixtures.read.mockResolvedValue(false);
    const { searchCachedLibraryTracks } = await import(
      "./cached-metadata-search"
    );
    const files = [track("match"), track("other")];
    expect(
      (await searchCachedLibraryTracks(files, "match")).map(
        (match) => match.track.id,
      ),
    ).toEqual(["match"]);
  });
});
