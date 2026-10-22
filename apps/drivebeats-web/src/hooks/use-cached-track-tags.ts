"use client";
import { useEffect, useRef } from "react";
import {
  getCachedTrackTags,
  hydrateCachedTrackTags,
} from "@/lib/cached-track-tags";
import { useKnownTrackProofStore } from "@/lib/known-track-resolver";
import {
  retainCachedMetadataRecord,
  useId3MetadataStore,
} from "@/stores/id3-metadata-store";
import type { DriveFile } from "@/types";

export function useCachedTrackTags(track?: DriveFile | null) {
  const proofRevision = useKnownTrackProofStore((state) => state.revision);
  const generation = useId3MetadataStore((state) => state.generation);
  useId3MetadataStore((state) => (track ? state.records[track.id] : undefined));
  const attempted = useRef<string | null>(null);
  const id = track?.id;
  useEffect(() => {
    if (!id) return;
    // Generation changes clear retention as part of account/cache reset.
    if (useId3MetadataStore.getState().generation !== generation) return;
    return retainCachedMetadataRecord(id);
  }, [id, generation]);
  // One hydration per mounted scope avoids eviction/reload cycles if a caller
  // mounts more rows than the bounded shared memory cache can retain.
  const scope = `${generation}:${proofRevision}:${id ?? ""}`;
  useEffect(() => {
    if (!track || attempted.current === scope) return;
    attempted.current = scope;
    const controller = new AbortController();
    void hydrateCachedTrackTags(track, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [track, scope]);
  return track ? getCachedTrackTags(track) : undefined;
}
