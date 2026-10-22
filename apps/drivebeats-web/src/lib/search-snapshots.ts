/** Immutable, bounded cursor pages. No live metadata objects are retained. */
export class SearchSnapshotError extends Error {
  constructor(
    public code:
      | "search_snapshot_expired"
      | "search_changed"
      | "snapshot_limit",
  ) {
    super(code);
  }
}

interface Snapshot<T> {
  account: string;
  scope: string;
  query: string;
  limit: number;
  observedAt: number;
  rows: T[];
  bytes: number;
  catalogRevision: number;
  metadataRevision: number;
}

export function createSearchSnapshots<T>(now = Date.now) {
  const snapshots = new Map<string, Snapshot<T>>();
  const cursors = new Map<string, { key: string; position: number }>();
  const pageCursors = new Map<string, string>();
  function remove(key: string) {
    snapshots.delete(key);
    for (const position of pageCursors.keys())
      if (position.startsWith(`${key}:`)) pageCursors.delete(position);
    for (const [cursor, value] of cursors)
      if (value.key === key) cursors.delete(cursor);
  }
  function prune() {
    for (const [key, value] of snapshots)
      if (now() - value.observedAt >= 120_000) remove(key);
  }
  function page(key: string, snapshot: Snapshot<T>, position: number) {
    const next = position + snapshot.limit;
    let nextCursor: string | null = null;
    if (next < snapshot.rows.length) {
      const location = `${key}:${next}`;
      nextCursor = pageCursors.get(location) ?? crypto.randomUUID();
      pageCursors.set(location, nextCursor);
      cursors.set(nextCursor, { key, position: next });
    }
    return {
      tracks: structuredClone(snapshot.rows.slice(position, next)),
      total: snapshot.rows.length,
      observedAt: snapshot.observedAt,
      catalogRevision: snapshot.catalogRevision,
      metadataRevision: snapshot.metadataRevision,
      nextCursor,
      nextOffset: next < snapshot.rows.length ? next : null,
    };
  }
  return {
    start(input: Omit<Snapshot<T>, "observedAt" | "bytes">, offset = 0) {
      prune();
      let bytes = 2;
      if (input.rows.length <= 50_000)
        for (const row of input.rows) {
          bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
          if (bytes > 16 * 1024 * 1024) break;
        }
      if (input.rows.length > 50_000 || bytes > 16 * 1024 * 1024) {
        return {
          ...page(
            "",
            {
              ...input,
              rows: input.rows.slice(offset, offset + input.limit),
              bytes: 0,
              observedAt: now(),
            },
            0,
          ),
          total: input.rows.length,
          nextCursor: null,
          nextOffset: null,
          restriction: "snapshot_limit" as const,
        };
      }
      const rows = structuredClone(input.rows);
      const owned = [...snapshots].filter(
        ([, value]) => value.account === input.account,
      );
      let count = owned.reduce((sum, [, value]) => sum + value.rows.length, 0);
      let retained = owned.reduce((sum, [, value]) => sum + value.bytes, 0);
      while (
        owned.length &&
        (owned.length >= 4 ||
          count + rows.length > 50_000 ||
          retained + bytes > 16 * 1024 * 1024)
      ) {
        const oldest = owned.shift();
        if (!oldest) break;
        remove(oldest[0]);
        count -= oldest[1].rows.length;
        retained -= oldest[1].bytes;
      }
      const key = crypto.randomUUID();
      const snapshot = { ...input, rows, bytes, observedAt: now() };
      snapshots.set(key, snapshot);
      return page(key, snapshot, offset);
    },
    continue(
      cursor: string,
      account: string,
      scope: string,
      query?: string,
      limit?: number,
    ) {
      prune();
      const continuation = cursors.get(cursor);
      const snapshot = continuation && snapshots.get(continuation.key);
      if (!continuation || !snapshot)
        throw new SearchSnapshotError("search_snapshot_expired");
      if (
        snapshot.account !== account ||
        snapshot.scope !== scope ||
        (query !== undefined && snapshot.query !== query) ||
        (limit !== undefined && snapshot.limit !== limit)
      )
        throw new SearchSnapshotError("search_changed");
      return page(continuation.key, snapshot, continuation.position);
    },
    clear() {
      snapshots.clear();
      cursors.clear();
      pageCursors.clear();
    },
  };
}
