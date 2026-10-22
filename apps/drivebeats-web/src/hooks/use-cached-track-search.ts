"use client";
import { useEffect, useMemo, useState } from "react";
import {
  type CachedMetadataSearchMatch,
  searchCachedLibraryTracks,
} from "@/lib/cached-metadata-search";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { getLibrarySearchImportsSignature } from "@/stores/library-search-store";
import type { DriveFile } from "@/types";

/** Freeze query results until the query or membership changes, so warming never resets paging. */
export function useCachedTrackSearch<T extends DriveFile>(
  files: T[],
  query: string,
  enabled: boolean,
) {
  const generation = useId3MetadataStore((state) => state.generation);
  const signature = useImportedDriveStore(() =>
    getLibrarySearchImportsSignature(),
  );
  const [snapshot, setSnapshot] = useState<{
    files: T[];
    query: string;
    generation: number;
    signature: string;
    matches: CachedMetadataSearchMatch<T>[];
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void searchCachedLibraryTracks(files, query, { signal: controller.signal })
      .then((matches) => {
        if (!controller.signal.aborted)
          setSnapshot({ files, query, generation, signature, matches });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSnapshot({ files, query, generation, signature, matches: [] });
      });
    return () => controller.abort();
  }, [files, query, enabled, generation, signature]);
  return useMemo(() => {
    if (!enabled)
      return { tracks: files, metadataById: undefined, pending: false };
    const current =
      snapshot?.files === files &&
      snapshot.query === query &&
      snapshot.generation === generation &&
      snapshot.signature === signature
        ? snapshot
        : null;
    return {
      tracks: current?.matches.map((match) => match.track) ?? [],
      metadataById: new Map(
        current?.matches.map((match) => [match.track.id, match.tags]) ?? [],
      ),
      pending: !current,
    };
  }, [files, query, enabled, snapshot, generation, signature]);
}
