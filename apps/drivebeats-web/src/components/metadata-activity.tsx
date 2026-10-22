"use client";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { memo, useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getMetadataUnresolvedDiagnostics } from "@/lib/metadata-diagnostics";
import {
  getMetadataIndexStatus,
  useMetadataIndexStore,
} from "@/lib/metadata-index-coordinator";
import { useLibrarySearchStore } from "@/stores/library-search-store";

const REASON_COPY: Record<string, { title: string; explanation: string }> = {
  parse_error: {
    title: "Decoding failed",
    explanation: "Embedded metadata could not be decoded.",
  },
  budget_exceeded: {
    title: "Reading limit reached",
    explanation: "Reading limit reached for this track. Other tracks continue.",
  },
  unsupported_format: {
    title: "Unsupported format",
    explanation: "This audio format is not supported yet.",
  },
  range_unsupported: {
    title: "Partial download unavailable",
    explanation: "Partial file reads are unavailable.",
  },
  permission_denied: {
    title: "Access unavailable",
    explanation: "Google Drive denied access to this track.",
  },
  not_found: {
    title: "Track unavailable",
    explanation: "Track not found in Google Drive.",
  },
};
const UNKNOWN_REASON = {
  title: "Metadata unavailable",
  explanation: "The track's metadata could not be read during this check.",
};
type Diagnostics = Awaited<ReturnType<typeof getMetadataUnresolvedDiagnostics>>;

export const MetadataActivity = memo(function MetadataActivity() {
  useMetadataIndexStore(
    useShallow((state) => ({
      revision: state.revision,
      running: state.running,
      pauseReason: state.pauseReason,
    })),
  );
  useLibrarySearchStore((state) => state.status);
  const status = getMetadataIndexStatus();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const [expandedScope, setExpandedScope] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    scope: number;
    result: Diagnostics;
  } | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<number | null>(null);
  const expanded =
    status.unresolved > 0 &&
    expandedScope !== null &&
    expandedScope === status.coverageScopeVersion;
  const visibleDiagnostics =
    diagnostics && diagnostics.scope === status.coverageScopeVersion
      ? diagnostics.result
      : null;
  useEffect(() => {
    if (!open || !expanded || status.unresolved === 0) return;
    const controller = new AbortController();
    const scope = status.coverageScopeVersion;
    setDiagnosticsError(null);
    void getMetadataUnresolvedDiagnostics({
      signal: controller.signal,
      limit: 20,
    })
      .then((result) => {
        if (!controller.signal.aborted) setDiagnostics({ scope, result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDiagnosticsError(scope);
      });
    return () => controller.abort();
  }, [open, expanded, status.coverageScopeVersion, status.unresolved]);
  if (
    !open &&
    ((status.indexingState === "idle" && !status.coveragePending) ||
      status.indexingState === "complete")
  )
    return null;
  const animate =
    status.indexingState === "running" ||
    status.indexingState === "paused" ||
    status.coveragePending;
  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Music metadata progress"
          />
        }
      >
        <span
          className={
            animate ? "animate-spin motion-reduce:animate-none" : undefined
          }
        >
          <Loader2 aria-hidden="true" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] p-3">
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Music metadata</p>
          <p>
            {status.total === null ||
            (status.coveragePending && status.observedAt === null)
              ? "Checking your Library…"
              : `${status.checked} of ${status.total} checked`}
          </p>
          {status.unresolved > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p>
                {status.unresolved}{" "}
                {status.unresolved === 1 ? "track" : "tracks"} could not be
                read.
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label="Why metadata could not be read"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() =>
                  setExpandedScope(
                    expanded ? null : status.coverageScopeVersion,
                  )
                }
              >
                {expanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <Info aria-hidden="true" />
                )}
              </Button>
            </div>
          ) : null}
          <section
            id={detailsId}
            hidden={!expanded}
            aria-label="Metadata reading issues"
          >
            {expanded &&
            visibleDiagnostics &&
            visibleDiagnostics.available !== false ? (
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto break-words">
                {visibleDiagnostics.reasons.map(({ code, count }) => {
                  const copy = REASON_COPY[code] ?? UNKNOWN_REASON;
                  const tracks = visibleDiagnostics.tracks.filter(
                    (track) => track.reason === code,
                  );
                  return (
                    <div key={code} className="flex flex-col gap-1">
                      {visibleDiagnostics.reasons.length > 1 ? (
                        <p key="heading" className="font-medium">
                          {count} {count === 1 ? "track" : "tracks"}:{" "}
                          {copy.title}
                        </p>
                      ) : null}
                      <p key="explanation" className="text-muted-foreground">
                        {copy.explanation}
                      </p>
                      {tracks.length ? (
                        <ul className="list-inside list-disc">
                          {tracks.map((track) => (
                            <li key={track.id}>{track.fileName}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
                <p className="text-muted-foreground">
                  Playback may still work.
                </p>
                {visibleDiagnostics.truncated ? (
                  <p className="text-muted-foreground">
                    Showing {visibleDiagnostics.tracks.length} of{" "}
                    {visibleDiagnostics.total} affected tracks.
                  </p>
                ) : null}
              </div>
            ) : expanded ? (
              <p className="text-muted-foreground">
                {diagnosticsError === status.coverageScopeVersion ||
                visibleDiagnostics?.available === false
                  ? "Reasons are unavailable. Close and reopen these details to try again."
                  : "Checking saved metadata…"}
              </p>
            ) : null}
          </section>
          {status.pauseReason ? (
            <p className="text-muted-foreground">
              {status.pauseReason === "metadata_auth_required" ||
              status.pauseReason === "drive_auth_required"
                ? "Metadata checks are waiting for sign-in. Sign in again to continue."
                : status.pauseReason === "metadata_setup_error"
                  ? "Metadata checks are unavailable because of a connection setup problem. Playback may still work."
                  : "Waiting. Metadata checks will continue when available."}
            </p>
          ) : null}
          {status.sessionOnlyCatalog ? (
            <p className="text-muted-foreground">
              Library progress is available for this session only.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});
