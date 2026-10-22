import { describe, expect, it } from "vitest";
import { buildMetadataCoverage } from "@/lib/metadata-coverage";
import type { MetadataView } from "@/lib/track-metadata-loader";

describe("truthful complete-library coverage", () => {
  it("counts stored budget limits as pending alongside genuine parse failures", () => {
    const states: MetadataView[] = [
      { status: "unresolved", freshness: "current", reason: "parse_error" },
      { status: "unresolved", freshness: "current", reason: "budget_exceeded" },
      { status: "unresolved", freshness: "stale", reason: "budget_exceeded" },
      {
        status: "deferred",
        freshness: "unknown",
        error: {
          code: "budget_exceeded",
          retryable: true,
          budgetScope: "consumer",
        },
      },
      {
        status: "error",
        freshness: "unknown",
        error: { code: "budget_exceeded", retryable: true },
      },
    ];
    const tracks = states.map((_state, index) => ({
      id: String(index),
      name: "track.mp3",
      mimeType: "audio/mpeg",
    }));
    expect(
      buildMetadataCoverage(tracks, (track) => states[Number(track.id)]),
    ).toMatchObject({
      total: 5,
      checked: 0,
      unresolved: 1,
      unknown: 4,
      stale: 0,
      remaining: 4,
      unresolvedReasons: { parse_error: 1 },
      metadataSearchComplete: false,
    });
  });
  it("keeps disjoint terminal, stale, pending and transient buckets", () => {
    const states: MetadataView[] = [
      { status: "ready", freshness: "current", tags: { artist: "Artist" } },
      { status: "no_target_tags", freshness: "current" },
      {
        status: "unresolved",
        freshness: "current",
        reason: "unsupported_format",
      },
      { status: "ready", freshness: "stale", tags: { title: "Old" } },
      { status: "error", freshness: "unknown" },
      ...(["missing", "deferred", "queued", "loading"] as const).map(
        (status) => ({ status, freshness: "unknown" as const }),
      ),
    ];
    const tracks = states.map((_state, index) => ({
      id: String(index),
      name: "track",
      mimeType: "audio/mpeg",
    }));
    expect(
      buildMetadataCoverage(tracks, (track) => states[Number(track.id)]),
    ).toMatchObject({
      total: 9,
      checked: 2,
      ready: 1,
      noTargetTags: 1,
      unresolved: 1,
      stale: 1,
      errors: 1,
      unknown: 4,
      remaining: 6,
      fields: { title: 0, artist: 1, album: 0 },
      unresolvedReasons: { unsupported_format: 1 },
      metadataSearchComplete: false,
    });
  });
  it("does not invent a denominator before catalog completion", () => {
    expect(
      buildMetadataCoverage(null, () => ({
        status: "ready",
        freshness: "current",
      })),
    ).toMatchObject({
      total: null,
      remaining: null,
      metadataSearchComplete: false,
    });
  });
  it("finishes remaining work despite terminal unresolved tracks without calling search complete", () => {
    expect(
      buildMetadataCoverage(
        [{ id: "unsupported", name: "audio.flac", mimeType: "audio/flac" }],
        () => ({
          status: "unresolved",
          freshness: "current",
          reason: "unsupported_format",
        }),
      ),
    ).toMatchObject({
      total: 1,
      checked: 0,
      unresolved: 1,
      remaining: 0,
      metadataSearchComplete: false,
    });
  });
});
