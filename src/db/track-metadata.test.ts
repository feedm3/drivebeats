import { describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn().mockResolvedValue([]);
vi.mock("@/db/client", () => ({
  getSql: () => ({ query: mockQuery }),
}));

describe("batchUpsertTrackMetadata", () => {
  it("executes a single multi-row INSERT for multiple records", async () => {
    const { batchUpsertTrackMetadata } = await import("@/db/track-metadata");

    await batchUpsertTrackMetadata("user-123", [
      {
        fileId: "file-a",
        fileModifiedTime: "2024-01-01",
        title: "Song A",
        artist: "Artist A",
        album: "Album A",
      },
      {
        fileId: "file-b",
        fileModifiedTime: "2024-01-02",
        title: "Song B",
        artist: "Artist B",
        album: null,
      },
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];

    // Should have 2 rows of VALUES
    expect(sql).toContain("VALUES");
    expect(sql).toContain("$1,");
    expect(sql).toContain("$12,");

    // Should have 12 params (2 records × 6 fields each)
    expect(params).toHaveLength(12);
    expect(params[0]).toBe("user-123"); // first record user id
    expect(params[1]).toBe("file-a"); // first record file id
    expect(params[6]).toBe("user-123"); // second record user id
    expect(params[7]).toBe("file-b"); // second record file id
  });

  it("does nothing for empty records array", async () => {
    mockQuery.mockClear();
    const { batchUpsertTrackMetadata } = await import("@/db/track-metadata");

    await batchUpsertTrackMetadata("user-123", []);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("handles single record", async () => {
    mockQuery.mockClear();
    const { batchUpsertTrackMetadata } = await import("@/db/track-metadata");

    await batchUpsertTrackMetadata("user-123", [
      {
        fileId: "file-only",
        title: "Only Song",
      },
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toHaveLength(6);
    expect(params[1]).toBe("file-only");
    // Nullish values should be null
    expect(params[2]).toBeNull(); // fileModifiedTime
    expect(params[4]).toBeNull(); // artist
    expect(params[5]).toBeNull(); // album
  });
});
