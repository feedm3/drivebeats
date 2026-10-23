import { describe, expect, it } from "vitest";
import { createSearchSnapshots } from "./search-snapshots";

const input = {
  account: "a",
  scope: "imports:v1",
  query: "music",
  limit: 1,
  catalogRevision: 1,
  metadataRevision: 1,
  rows: [
    { id: "1", title: "old" },
    { id: "2", title: "old" },
  ],
};
describe("search snapshots", () => {
  it("freezes values through warming, including repeat cursor reads", () => {
    const snapshots = createSearchSnapshots<{ id: string; title: string }>();
    const source = structuredClone(input);
    const first = snapshots.start(source);
    source.rows[1].title = "new";
    const next = snapshots.continue(first.nextCursor ?? "", "a", "imports:v1");
    expect(next.tracks).toEqual([{ id: "2", title: "old" }]);
    next.tracks[0].title = "mutated";
    expect(
      snapshots.continue(first.nextCursor ?? "", "a", "imports:v1").tracks[0]
        .title,
    ).toBe("old");
  });
  it("binds cursors to account, imports and query", () => {
    const snapshots = createSearchSnapshots<{ id: string; title: string }>();
    const cursor = snapshots.start(input).nextCursor ?? "";
    expect(() => snapshots.continue(cursor, "b", "imports:v1")).toThrow(
      "search_changed",
    );
    expect(() => snapshots.continue(cursor, "a", "imports:v2")).toThrow(
      "search_changed",
    );
    expect(() =>
      snapshots.continue(cursor, "a", "imports:v1", "other"),
    ).toThrow("search_changed");
  });
  it("renews active scans but expires idle scans and caps their total lifetime", () => {
    let time = 0;
    const snapshots = createSearchSnapshots<{ id: string; title: string }>(
      () => time,
    );
    const cursor = snapshots.start(input).nextCursor ?? "";
    for (time = 4 * 60_000; time < 30 * 60_000; time += 4 * 60_000) {
      const page = snapshots.continue(cursor, "a", "imports:v1");
      expect(page.observedAt).toBe(0);
      expect(page.expiresAt).toBe(Math.min(time + 5 * 60_000, 30 * 60_000));
    }
    expect(() => snapshots.continue(cursor, "a", "imports:v1")).toThrow(
      "search_snapshot_expired",
    );
    const idle = snapshots.start(input).nextCursor ?? "";
    time += 5 * 60_000;
    expect(() => snapshots.continue(idle, "a", "imports:v1")).toThrow(
      "search_snapshot_expired",
    );
  });
  it("evicts the oldest of four account snapshots", () => {
    const snapshots = createSearchSnapshots<{ id: string; title: string }>();
    const cursor = snapshots.start(input).nextCursor ?? "";
    for (let i = 0; i < 4; i++) snapshots.start(input);
    expect(() => snapshots.continue(cursor, "a", "imports:v1")).toThrow(
      "search_snapshot_expired",
    );
  });
  it("returns only a bounded first page for an oversized search", () => {
    const snapshots = createSearchSnapshots<{ id: string; title: string }>();
    const page = snapshots.start({
      ...input,
      rows: Array.from({ length: 50_001 }, (_, id) => ({
        id: String(id),
        title: "x",
      })),
    });
    expect(page.tracks).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(page).toHaveProperty("restriction", "snapshot_limit");
  });
});
