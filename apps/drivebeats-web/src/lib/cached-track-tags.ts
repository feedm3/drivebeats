import { metadataEnvironmentKey } from "@/lib/drive-metadata-reader";
import {
  assertKnownTrack,
  resolveKnownTrack,
} from "@/lib/known-track-resolver";
import { getLocalMetadataAccountId } from "@/lib/metadata-local-account";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import type { DriveFile } from "@/types";

const localReads = new Map<string, Promise<void>>();
const MAX_LOCAL_READS = 32;

/** Hydrate only a requested consumer's record. Never read Drive or the cloud. */
export async function hydrateCachedTrackTags(
  track: DriveFile,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const store = useId3MetadataStore.getState();
  const accountId = getLocalMetadataAccountId();
  if (!accountId || store.accountId !== accountId) return;
  const known = resolveKnownTrack(accountId, track.id);
  if (!known) return;
  const generation = store.generation;
  const current = () =>
    useId3MetadataStore.getState().accountId === accountId &&
    useId3MetadataStore.getState().generation === generation &&
    getLocalMetadataAccountId() === accountId &&
    assertKnownTrack(known);
  const key = JSON.stringify([accountId, generation, track.id, known.scopeKey]);
  // A bounded set of reads is shared by mounted rows, player controls and tools.
  // Overflow callers wait for a slot; no unbounded retained queue or ID list.
  while (current()) {
    signal?.throwIfAborted();
    const existing = localReads.get(key);
    if (existing) {
      await existing;
      return;
    }
    if (localReads.size < MAX_LOCAL_READS) break;
    await Promise.race(localReads.values());
  }
  if (!current() || signal?.aborted) return;
  const flight = store
    .setAccount(accountId)
    .then(async () => {
      if (current())
        await useId3MetadataStore
          .getState()
          .loadRecord(known.track, metadataEnvironmentKey(), current);
    })
    .finally(() => {
      if (localReads.get(key) === flight) localReads.delete(key);
    });
  localReads.set(key, flight);
  await flight;
}

/** Display/search must never use another account's or an old version's tags. */
export function getCachedTrackTags(track: DriveFile) {
  const store = useId3MetadataStore.getState();
  if (!store.accountId || store.accountId !== getLocalMetadataAccountId())
    return undefined;
  const known = resolveKnownTrack(store.accountId, track.id);
  if (!known) return undefined;
  const { record, freshness } = store.getRecord(known.track);
  return freshness === "current" && record?.status === "ready"
    ? record.tags
    : undefined;
}
