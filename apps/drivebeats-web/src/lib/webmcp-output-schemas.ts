import type { z } from "zod";

type Schema = z.core.JSONSchema.BaseSchema;
type Fields = Record<string, Schema>;

const string = { type: "string" } satisfies Schema;
const boolean = { type: "boolean" } satisfies Schema;
const number = { type: "number" } satisfies Schema;
const integer = { type: "integer" } satisfies Schema;
const milliseconds = { type: "number", minimum: 0 } satisfies Schema;
const count = { type: "integer", minimum: 0 } satisfies Schema;

const literal = (value: string | boolean): Schema => ({ const: value });
const choices = (...values: string[]): Schema => ({ enum: values });
const array = (items: Schema): Schema => ({ type: "array", items });
const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: "null" }],
});
const object = (required: Fields, optional: Fields = {}): Schema => ({
  type: "object",
  properties: { ...required, ...optional },
  required: Object.keys(required),
  additionalProperties: false,
});

const failure = { code: string, message: string };
const recovery = object(
  { action: string, message: string, automaticRetry: boolean },
  { verificationTool: string, retryAfterMs: count, maxAttempts: count },
);
const metadataStatus = choices(
  "missing",
  "queued",
  "loading",
  "ready",
  "no_target_tags",
  "unresolved",
  "deferred",
  "error",
  "unavailable",
);
const metadataFreshness = choices("current", "stale", "unknown");
const metadataError = { code: string, retryable: boolean };
const metadata = object(
  { status: metadataStatus, freshness: metadataFreshness },
  {
    tags: object({}, { title: string, artist: string, album: string }),
    checkedAt: number,
    loadedVia: choices("local_blob", "drive_range"),
    reason: string,
    attemptComplete: boolean,
    error: object(metadataError, {
      retryAfterMs: milliseconds,
      budgetScope: choices("consumer", "background"),
    }),
    provenance: literal("audio_tags"),
  },
);

const trackIdentity = { id: string, fileName: string };
const titleSource = choices("audio_tags", "filename");
const publicTrack = {
  ...trackIdentity,
  metadata,
  display: object(
    {
      title: string,
      titleSource,
      subtitleSource: choices("audio_tags", "filename", "folder_context"),
    },
    { subtitle: string },
  ),
};
const compactTrack = object({
  ...trackIdentity,
  title: string,
  artist: nullable(string),
  album: nullable(string),
  titleSource,
  artistSource: nullable(titleSource),
  metadataStatus,
  metadataFreshness,
});
const searchField = choices(
  "filename",
  "cached_title",
  "cached_artist",
  "cached_album",
);
const detailedSearchTrack = object({
  ...publicTrack,
  folderPath: string,
  contextLabel: string,
  matchedFields: array(searchField),
});

const repeat = choices("off", "one", "all");
const playback = {
  observedAt: integer,
  track: nullable(object(publicTrack)),
  trackDetailsAvailable: boolean,
  playerOpen: boolean,
  state: choices(
    "loading",
    "playing",
    "awaiting_user",
    "ended",
    "paused",
    "idle",
  ),
  isPlaying: boolean,
  isLoading: boolean,
  positionSeconds: number,
  durationSeconds: nullable(number),
  remainingSeconds: nullable(number),
  audioPermission: choices("unknown", "blocked", "allowed"),
  lastFailure: nullable(
    object(failure, { retryable: boolean, retryAfterMs: milliseconds }),
  ),
  volume: number,
  muted: boolean,
  shuffle: boolean,
  repeat,
  queueLength: count,
  queueCursor: nullable(count),
  queuedTrackCount: count,
};
const playbackResult = { playback: object(playback) };

const metadataCoverage = object(
  {
    ready: count,
    noTargetTags: count,
    unresolved: count,
    stale: count,
    errors: count,
    unknown: count,
    checked: count,
    total: nullable(count),
    remaining: nullable(count),
    unresolvedReasons: { type: "object", additionalProperties: count },
    fields: object({ title: count, artist: count, album: count }),
    catalogComplete: boolean,
    metadataSearchComplete: boolean,
    coveragePending: boolean,
    coverageScopeVersion: count,
    observedAt: nullable(integer),
    indexingState: choices("partial", "complete", "running", "paused", "idle"),
    pauseReason: nullable(string),
    retryAfterMs: milliseconds,
    nextRetryAt: nullable(number),
    sessionOnlyCatalog: boolean,
    catalogItemsDiscovered: count,
    coordinationAvailable: boolean,
  },
  { durableCoverage: boolean },
);
const library = object(
  {
    status: choices("idle", "loading", "ready", "error"),
    complete: boolean,
    searchable: boolean,
    refreshRequired: boolean,
    catalogUpdatedAt: nullable(number),
    trackCount: nullable(count),
    importedFolderCount: count,
    standaloneTrackCount: count,
  },
  { error: object(failure), recovery },
);
const backup: Schema = {
  type: "object",
  anyOf: [
    object({ status: literal("unknown"), complete: literal(false) }),
    object(
      {
        status: choices("idle", "restoring", "saved", "pending", "error"),
        complete: boolean,
        pendingCount: count,
        checkpointPending: boolean,
        collectionMutationPending: boolean,
        savedMetadataCount: count,
        lastSavedAt: nullable(number),
        scope: string,
      },
      { error: object(failure), recovery },
    ),
  ],
};
const signedInStatus = {
  signedIn: literal(true),
  ...playbackResult,
  library,
  metadataCoverage,
  collections: object({
    status: choices("sync_pending", "ready", "unverified"),
  }),
  backup,
};

const nextOffset = nullable(count);
const searchPage = {
  total: count,
  expiresAt: integer,
  observedAt: integer,
  catalogRevision: number,
  metadataRevision: integer,
  nextCursor: nullable(string),
  nextOffset,
};
function searchResult(format: "compact" | "detailed", track: Schema): Schema {
  return object(
    {
      ok: literal(true),
      ...searchPage,
      tracks: array(track),
      search: object({
        query: nullable(string),
        format: literal(format),
        filters: object(
          {},
          {
            artist: string,
            album: string,
            favorite: boolean,
            collectionId: string,
            excludeCollectionId: string,
          },
        ),
        searchFields: array(searchField),
        scope: literal("imported_library"),
        catalogComplete: literal(true),
        complete: boolean,
        metadataCoverage,
        catalogUpdatedAt: nullable(number),
        pagination: choices("snapshot", "unversioned_offset"),
      }),
    },
    { restriction: literal("snapshot_limit") },
  );
}

function incompleteTrack(
  status: "unavailable" | "deferred",
  code: "track_not_found" | "timeout",
  retryable: boolean,
) {
  return object({
    id: string,
    loadedNow: literal(false),
    metadata: object({
      status: literal(status),
      freshness: literal("unknown"),
    }),
    error: object({ code: literal(code), retryable: literal(retryable) }),
  });
}
const loadedTrack: Schema = {
  type: "object",
  anyOf: [
    object({ ...publicTrack, loadedNow: boolean }),
    incompleteTrack("unavailable", "track_not_found", false),
    incompleteTrack("deferred", "timeout", true),
  ],
};

const success = (fields: Fields) => object({ ok: literal(true), ...fields });
// Include the structured errors returned by both the tool and the registrar.
const result = (variants: Schema[], details?: Fields): Schema => ({
  type: "object",
  anyOf: [
    ...variants,
    object({ ok: literal(false), error: object(failure), recovery }, details),
  ],
});
const progress = { progress: metadataCoverage };
const playbackError = {
  ...progress,
  playback: object(playback, { queuePrepared: boolean }),
};
const uncertainMutation = { effectMayHaveOccurred: literal(true) };
const playlistResult = { playlistId: string };

export const webMcpOutputSchemas = {
  drivebeats_status: result([
    success(signedInStatus),
    success({ signedIn: literal(false), message: string }),
  ]),
  drivebeats_search_library: result(
    [
      searchResult("compact", compactTrack),
      searchResult("detailed", detailedSearchTrack),
    ],
    progress,
  ),
  drivebeats_load_track_metadata: result([
    success({
      observedAt: integer,
      timedOut: boolean,
      remainingTrackIds: array(string),
      tracks: array(loadedTrack),
      budget: object({ requestsUsed: count, bytesRead: count }),
    }),
  ]),
  drivebeats_list_collections: result([
    success({
      collections: array(
        object({ id: string, name: string, trackCount: count }),
      ),
    }),
    success({
      id: string,
      name: string,
      total: count,
      tracks: array(object(publicTrack)),
      nextOffset,
    }),
  ]),
  drivebeats_get_queue: result([
    success({
      observedAt: integer,
      revision: string,
      total: count,
      currentIndex: integer,
      shuffle: boolean,
      repeat,
      entries: array(
        object({
          entryId: string,
          position: count,
          status: choices("played", "current", "upcoming"),
          removable: boolean,
          track: compactTrack,
        }),
      ),
      nextOffset,
    }),
  ]),
  drivebeats_play: result([success(playbackResult)], playbackError),
  drivebeats_queue_tracks: result(
    [
      success({
        ...playbackResult,
        queuedTracks: array(object({ entryId: string, ...publicTrack })),
      }),
    ],
    progress,
  ),
  drivebeats_control_playback: result([success(playbackResult)], playbackError),
  drivebeats_save_playlist: result(
    [success({ ...playlistResult, name: string })],
    uncertainMutation,
  ),
  drivebeats_edit_playlist_tracks: result(
    [
      success({
        ...playlistResult,
        addedCount: count,
        duplicateCount: count,
        skippedCount: count,
        reachedTrackLimit: boolean,
      }),
      success({ ...playlistResult, removedTrackId: string }),
    ],
    { ...progress, ...uncertainMutation },
  ),
  drivebeats_set_favorite: result(
    [success({ trackId: string, favorite: boolean })],
    { ...progress, ...uncertainMutation },
  ),
};
