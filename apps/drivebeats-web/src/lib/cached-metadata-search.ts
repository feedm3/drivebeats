import { matchedSearchFields, matchesFileSearch } from "@/lib/file-search";
import type { Id3Metadata } from "@/lib/id3-metadata";
import { resolveKnownTrack } from "@/lib/known-track-resolver";
import {
  readMetadataRecords,
  scanMetadataRecords,
} from "@/lib/metadata-cache-db";
import {
  getMetadataFreshness,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import { getLocalMetadataAccountId } from "@/lib/metadata-local-account";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { getLibrarySearchImportsSignature } from "@/stores/library-search-store";
import type { DriveFile } from "@/types";

export interface CachedMetadataSearchMatch<T extends DriveFile> {
  track: T;
  tags?: Id3Metadata;
  matchedFields: string[];
  checkedAt?: number;
}
export class CachedMetadataSearchChangedError extends Error {
  readonly code = "search_changed";
  constructor() {
    super("The account or Library changed during search. Start a new search.");
  }
}

/** Searches the shared local cache only, including records evicted from memory. */
export async function searchCachedLibraryTracks<T extends DriveFile>(
  tracks: T[],
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<CachedMetadataSearchMatch<T>[]> {
  const accountId = getLocalMetadataAccountId();
  const store = useId3MetadataStore.getState();
  const generation = store.generation;
  const importsSignature = getLibrarySearchImportsSignature();
  const current = () => {
    return (
      accountId &&
      getLocalMetadataAccountId() === accountId &&
      useId3MetadataStore.getState().generation === generation &&
      getLibrarySearchImportsSignature() === importsSignature
    );
  };
  if (!current()) throw new CachedMetadataSearchChangedError();
  options.signal?.throwIfAborted();
  const memory = store.accountId === accountId ? store.records : {};
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const matches = new Map<
    string,
    Omit<CachedMetadataSearchMatch<T>, "track">
  >();
  function consider(track: T, record?: MetadataRecord) {
    const tags =
      record &&
      record.accountId === accountId &&
      record.status === "ready" &&
      getMetadataFreshness(
        record,
        resolveKnownTrack(accountId as string, track.id)?.track ?? track,
      ) === "current"
        ? record.tags
        : undefined;
    if (!matchesFileSearch(track, query, tags)) {
      matches.delete(track.id);
      return;
    }
    matches.set(track.id, {
      ...(tags ? { tags: { ...tags }, checkedAt: record?.checkedAt } : {}),
      matchedFields: matchedSearchFields(track, query, tags),
    });
  }
  // Capture filename results and pending memory writes before opening storage.
  for (const track of tracks) consider(track, memory[track.id]);
  const visit = (record: MetadataRecord) => {
    const track = byId.get(record.fileId);
    if (track && !memory[record.fileId]) consider(track, record);
  };
  if (tracks.length <= 200)
    await readMetadataRecords(
      accountId as string,
      [...byId.keys()].filter((id) => !memory[id]),
      visit,
      options.signal,
    );
  else await scanMetadataRecords(accountId as string, visit, options.signal);
  options.signal?.throwIfAborted();
  if (!current()) throw new CachedMetadataSearchChangedError();
  return tracks.flatMap((track) => {
    const match = matches.get(track.id);
    return match ? [{ track, ...match }] : [];
  });
}
