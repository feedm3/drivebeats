import { z } from "zod";
import { createPlaylistTrack, playlistTrackToDriveFile } from "@/lib/audio";
import {
  hasPendingLocalMutations,
  runCloudLibrarySync,
} from "@/lib/cloud-library-sync-runner";
import { searchLibraryCatalog } from "@/lib/library-search-catalog";
import { webMcpRecovery } from "@/lib/webmcp-recovery";
import type { WebMcpTool } from "@/lib/webmcp-registration";
import { useAuthStore } from "@/stores/auth-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import {
  getLibrarySearchImportsSignature,
  useLibrarySearchStore,
} from "@/stores/library-search-store";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import { hasNextTrack, usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import {
  type DriveFile,
  FAVORITES_COLLECTION_ID,
  INITIAL_STACK,
} from "@/types";

class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const id = z.string().trim().min(1).max(512);
const name = z.string().trim().min(1).max(500);
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};

function account() {
  const auth = useAuthStore.getState();
  if (auth.authStatus !== "authenticated" || !auth.user || auth.isLoggingOut)
    throw new ToolError(
      "sign_in_required",
      "Sign in to Google in the open DriveBeats page first.",
    );
  return auth.user.id;
}
function assertAccount(userId: string, signal?: AbortSignal) {
  if (signal?.aborted)
    throw new ToolError("cancelled", "The action was cancelled.");
  if (account() !== userId)
    throw new ToolError(
      "account_changed",
      "The signed-in account changed. Try again.",
    );
}
function publicTrack(track: DriveFile) {
  return { id: track.id, fileName: track.name };
}
function ownedCatalog() {
  const search = useLibrarySearchStore.getState();
  const catalog = search.catalog;
  return catalog &&
    catalog.userId === useAuthStore.getState().user?.id &&
    !search.invalidated &&
    catalog.importsSignature === getLibrarySearchImportsSignature()
    ? catalog
    : null;
}
function readiness() {
  const search = useLibrarySearchStore.getState();
  const catalog = ownedCatalog();
  const imports = useImportedDriveStore.getState();
  const userId = useAuthStore.getState().user?.id;
  const collectionsVerified =
    verifiedCollectionAccount === userId &&
    usePlaylistStore.getState().isCloudHydrated &&
    useLibraryStore.getState().isCloudHydrated;
  return {
    library: {
      status:
        search.catalog && !catalog && search.catalog.userId !== userId
          ? "idle"
          : search.status,
      complete: Boolean(catalog),
      searchable: Boolean(catalog) && navigator.onLine,
      refreshRequired: !catalog || search.isStale(),
      catalogUpdatedAt: catalog?.fetchedAt ?? null,
      trackCount: catalog?.tracks.length ?? null,
      importedFolderCount: imports.rootFolders.length,
      standaloneTrackCount: imports.rootFiles.length,
      ...(search.failure &&
      (!search.catalog || search.catalog.userId === userId)
        ? {
            error: search.failure,
            recovery: webMcpRecovery(search.failure.code, true),
          }
        : {}),
    },
    collections: {
      status: hasPendingLocalMutations()
        ? "sync_pending"
        : collectionsVerified
          ? "ready"
          : "unverified",
    },
  };
}
let verifiedCollectionAccount: string | null = null;
function playback() {
  const state = usePlayerStore.getState();
  const userId = useAuthStore.getState().user?.id;
  const catalog = ownedCatalog();
  const trackDetailsAvailable =
    !state.currentTrack ||
    Boolean(
      state.playbackAccountId === userId ||
        catalog?.tracks.some((track) => track.id === state.currentTrack?.id) ||
        (verifiedCollectionAccount === userId &&
          (usePlaylistStore
            .getState()
            .playlists.some((playlist) =>
              playlist.tracks.some(
                (track) => track.fileId === state.currentTrack?.id,
              ),
            ) ||
            useLibraryStore.getState().tracks[state.currentTrack.id]
              ?.isFavorite)),
    );
  const position = state.audio?.currentTime;
  const duration = state.audio?.duration;
  const positionSeconds = Number.isFinite(position)
    ? Math.max(0, position ?? 0)
    : Number.isFinite(state.currentTime)
      ? Math.max(0, state.currentTime)
      : 0;
  const durationSeconds =
    Number.isFinite(duration) && (duration ?? 0) > 0
      ? (duration ?? 0)
      : Number.isFinite(state.duration) && state.duration > 0
        ? state.duration
        : null;
  const isPlaying = Boolean(
    state.audio && !state.audio.paused && !state.audio.ended && state.isPlaying,
  );
  return {
    observedAt: Date.now(),
    track:
      state.currentTrack && trackDetailsAvailable
        ? publicTrack(state.currentTrack)
        : null,
    trackDetailsAvailable,
    playerOpen: Boolean(state.currentTrack || state.queuedTracks.length),
    state: state.isLoading
      ? "loading"
      : isPlaying
        ? "playing"
        : state.lastPlaybackFailure?.code ===
              "audio_user_interaction_required" && state.currentTrack
          ? "awaiting_user"
          : state.audio?.ended
            ? "ended"
            : state.currentTrack
              ? "paused"
              : "idle",
    isPlaying,
    isLoading: state.isLoading,
    positionSeconds,
    durationSeconds,
    remainingSeconds:
      durationSeconds === null
        ? null
        : Math.max(0, durationSeconds - positionSeconds),
    audioPermission: state.audioPermission,
    lastFailure: state.lastPlaybackFailure,
    volume: state.volume,
    muted: state.isMuted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    queueLength: state.playbackSequence.length || state.playlist.length,
    queueCursor: state.playbackCursor >= 0 ? state.playbackCursor : null,
    queuedTrackCount: state.playbackSequence.length
      ? state.playbackSequence
          .slice(state.playbackCursor + 1)
          .filter((entry) => entry.sourceIndex === null).length
      : state.queuedTracks.filter(
          (entry) => entry.entryId !== state.queuedPlaybackContext?.entryId,
        ).length,
  };
}
async function library(userId: string, signal?: AbortSignal) {
  assertAccount(userId, signal);
  if (navigator.onLine === false)
    throw new ToolError("offline", "Search requires an internet connection.");
  const ready = await useLibrarySearchStore.getState().ensureReady(signal);
  assertAccount(userId, signal);
  const state = useLibrarySearchStore.getState();
  if (
    !ready ||
    !state.catalog ||
    state.catalog.userId !== userId ||
    state.invalidated ||
    state.catalog.importsSignature !== getLibrarySearchImportsSignature()
  ) {
    if (state.failure)
      throw new ToolError(state.failure.code, state.failure.message);
    throw new ToolError(
      "library_unavailable",
      "The complete Library is not available. Check your connection and imported items in DriveBeats, then try again.",
    );
  }
  return state.catalog.tracks;
}
async function collections(userId: string, signal?: AbortSignal) {
  assertAccount(userId, signal);
  if (hasPendingLocalMutations())
    throw new ToolError(
      "sync_pending",
      "Wait for the current playlist or favorite change to finish.",
    );
  // Use the normal bootstrap, single-flight and throttle rules. A fresh session
  // must establish ownership before any persisted collections are returned.
  const synced = await runCloudLibrarySync({
    force:
      verifiedCollectionAccount !== userId ||
      !usePlaylistStore.getState().isCloudHydrated ||
      !useLibraryStore.getState().isCloudHydrated,
    isCancelled: () => signal?.aborted ?? false,
  });
  assertAccount(userId, signal);
  if (!synced)
    throw new ToolError(
      "sync_unavailable",
      "The cloud library could not be loaded. Check your connection and try again.",
    );
  if (hasPendingLocalMutations())
    throw new ToolError(
      "sync_pending",
      "A collection changed during the read. Try again.",
    );
  verifiedCollectionAccount = userId;
  return [
    {
      id: FAVORITES_COLLECTION_ID,
      name: "Favorites",
      tracks: getFavoriteTracks(useLibraryStore.getState().tracks),
    },
    ...usePlaylistStore.getState().playlists,
  ];
}
async function playableTracks(
  userId: string,
  signal?: AbortSignal,
  useCachedCatalog = false,
  requestedTrackIds?: string[],
) {
  if (requestedTrackIds) {
    const saved = await collections(userId, signal);
    const savedTracks = new Map(
      saved.flatMap((collection) =>
        collection.tracks.map(
          (track) => [track.fileId, playlistTrackToDriveFile(track)] as const,
        ),
      ),
    );
    if (requestedTrackIds.every((trackId) => savedTracks.has(trackId)))
      return savedTracks;
  }
  const search = useLibrarySearchStore.getState();
  const cached =
    useCachedCatalog &&
    search.catalog?.userId === userId &&
    !search.invalidated &&
    search.catalog.importsSignature === getLibrarySearchImportsSignature();
  const tracks = cached
    ? (search.catalog?.tracks ?? [])
    : await library(userId, signal);
  const saved = await collections(userId, signal);
  // Imports can change while the cloud request runs; revalidate before using
  // the catalog captured above to select playable files.
  const current = useLibrarySearchStore.getState();
  if (
    current.catalog?.tracks !== tracks ||
    current.invalidated ||
    current.catalog.userId !== userId ||
    current.catalog.importsSignature !== getLibrarySearchImportsSignature()
  )
    throw new ToolError(
      "library_unavailable",
      "The Library changed during the read. Search again.",
    );
  return new Map([
    ...saved.flatMap((collection) =>
      collection.tracks.map(
        (track) => [track.fileId, playlistTrackToDriveFile(track)] as const,
      ),
    ),
    ...tracks.map((track) => [track.id, track] as const),
  ]);
}
async function startPlayback(
  queue: DriveFile[],
  userId: string,
  signal?: AbortSignal,
  collectionId?: string,
) {
  if (!queue.length)
    throw new ToolError(
      "empty_queue",
      "The selected collection has no Playable Tracks.",
    );
  assertAccount(userId, signal);
  return guardedPlayback(userId, signal, async () => {
    const played = await usePlayerStore
      .getState()
      .playTrack(
        queue[0],
        queue,
        INITIAL_STACK,
        collectionId,
        collectionId
          ? undefined
          : queue.map((track) =>
              "folderStack" in track
                ? (track as { folderStack: typeof INITIAL_STACK }).folderStack
                : INITIAL_STACK,
            ),
      );
    assertAccount(userId, signal);
    if (!played || !playback().isPlaying) {
      const current = usePlayerStore.getState();
      const queuePrepared =
        current.currentTrack?.id === queue[0].id &&
        current.playlist.length === queue.length &&
        current.playlist.every(
          (track, index) => track.id === queue[index].id,
        ) &&
        Boolean(current.audio?.src);
      throw playbackError(queuePrepared);
    }
    return playback();
  });
}
function playbackError(queuePrepared?: boolean) {
  const failure = usePlayerStore.getState().lastPlaybackFailure;
  return new ToolError(
    failure?.code ?? "playback_failed",
    failure?.message ??
      "Playback did not start. Check the current player state.",
    {
      playback: {
        ...playback(),
        ...(queuePrepared === undefined ? {} : { queuePrepared }),
      },
    },
  );
}

let playbackOperation: object | null = null;
async function guardedPlayback<T>(
  userId: string,
  signal: AbortSignal | undefined,
  action: () => Promise<T>,
) {
  assertAccount(userId, signal);
  if (playbackOperation)
    throw new ToolError(
      "playback_busy",
      "Wait for the current playback action to finish.",
    );
  const operation = {};
  playbackOperation = operation;
  let ownedCurrentTrack = usePlayerStore.getState().currentTrack;
  let ownedPendingTrackId = usePlayerStore.getState().pendingTrackId;
  let invalidated = false;
  const cancelPlayback = (clearAccountData = false) => {
    invalidated = true;
    const current = usePlayerStore.getState();
    const stillOwned = ownedPendingTrackId
      ? current.pendingTrackId === ownedPendingTrackId
      : current.currentTrack === ownedCurrentTrack &&
        current.pendingTrackId === null;
    if (playbackOperation === operation && stillOwned) {
      if (clearAccountData) current.resetPlayback();
      else current.cancelPlaybackRequest();
    }
  };
  const unsubscribe = useAuthStore.subscribe(() => {
    const auth = useAuthStore.getState();
    if (
      auth.user?.id !== userId ||
      auth.authStatus !== "authenticated" ||
      auth.isLoggingOut
    )
      cancelPlayback(true);
  });
  const onAbort = () => cancelPlayback();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const pending = action();
    ownedCurrentTrack = usePlayerStore.getState().currentTrack;
    ownedPendingTrackId = usePlayerStore.getState().pendingTrackId;
    const result = await pending;
    assertAccount(userId, signal);
    if (invalidated)
      throw new ToolError(
        "account_changed",
        "The session changed during playback. Choose a track again.",
      );
    return result;
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
    if (playbackOperation === operation) playbackOperation = null;
  }
}

function tool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  readOnly: boolean,
  action: (
    input: z.output<T>,
    userId: string,
    signal: AbortSignal | undefined,
    markEffectStarted: () => void,
  ) => Promise<unknown>,
  requiresAuth = true,
): WebMcpTool {
  return {
    name,
    description,
    inputSchema: {
      ...z.toJSONSchema(schema, { io: "input" }),
      type: "object",
    } as Record<string, unknown>,
    annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
    execute: async (input, options) => {
      let userId: string | undefined;
      let effectStarted = false;
      try {
        const parsed = schema.safeParse(input ?? {});
        if (!parsed.success)
          throw new ToolError(
            "invalid_input",
            "Tool arguments do not match the input schema.",
          );
        userId = requiresAuth ? account() : "";
        if (options?.signal?.aborted)
          throw new ToolError("cancelled", "The action was cancelled.");
        const result = await action(
          parsed.data,
          userId,
          options?.signal,
          () => {
            effectStarted = true;
          },
        );
        if (requiresAuth) assertAccount(userId, options?.signal);
        return { ok: true, ...(result as object) };
      } catch (error) {
        const auth = useAuthStore.getState();
        const cancelled =
          options?.signal?.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        const failure = cancelled
          ? { code: "cancelled", message: "The action was cancelled." }
          : error instanceof ToolError
            ? { code: error.code, message: error.message }
            : {
                code: "action_failed",
                message:
                  "DriveBeats could not complete the action. Check the current page state.",
              };
        const ownsResult =
          userId === auth.user?.id &&
          auth.authStatus === "authenticated" &&
          !auth.isLoggingOut &&
          !cancelled;
        const isCollectionMutation = [
          "drivebeats_save_playlist",
          "drivebeats_edit_playlist_tracks",
          "drivebeats_set_favorite",
        ].includes(name);
        const effectMayHaveOccurred =
          isCollectionMutation &&
          effectStarted &&
          [
            "cancelled",
            "account_changed",
            "sync_failed",
            "action_failed",
            "network_error",
            "drive_unavailable",
          ].includes(failure.code);
        return {
          ok: false,
          error: failure,
          recovery: effectMayHaveOccurred
            ? webMcpRecovery("sync_failed", false, name)
            : webMcpRecovery(failure.code, readOnly, name),
          ...(effectMayHaveOccurred ? { effectMayHaveOccurred: true } : {}),
          ...(ownsResult && error instanceof ToolError ? error.details : {}),
        };
      }
    },
  };
}

export function createDriveBeatsTools(): WebMcpTool[] {
  return [
    tool(
      "drivebeats_status",
      "Read a snapshot of the current page's sign-in, Library and collection readiness, and live player status: open/playing/paused/loading/awaiting user, current track, position, duration, remaining seconds and observed audio permission. This checks state without starting a Library refresh. Sign in and import music through the page.",
      z.object({}),
      true,
      async () => {
        const auth = useAuthStore.getState();
        const signedIn =
          auth.authStatus === "authenticated" &&
          Boolean(auth.user) &&
          !auth.isLoggingOut;
        return {
          signedIn,
          ...(signedIn
            ? { playback: playback(), ...readiness() }
            : {
                message:
                  "Sign in to Google in the open DriveBeats page, then open your Library.",
              }),
        };
      },
      false,
    ),
    tool(
      "drivebeats_search_library",
      "Search filenames across the complete imported Library. Returns track IDs and folder context, pagination, and catalog freshness. A cold refresh can take several seconds; concurrent searches share it. Results exclude unimported Drive content; failed refreshes return an error rather than zero matches.",
      z.object({ query: z.string().max(500).default(""), ...page }),
      true,
      async ({ query, offset, limit }, userId, signal) => {
        const matches = searchLibraryCatalog(
          await library(userId, signal),
          query,
        );
        return {
          total: matches.length,
          tracks: matches.slice(offset, offset + limit).map((track) => ({
            ...publicTrack(track),
            folderPath: track.folderStack
              .slice(1)
              .map((folder) => folder.name)
              .join("/"),
            contextLabel: track.contextLabel,
          })),
          search: {
            query,
            matches: "filename_only",
            scope: "imported_library",
            complete: true,
            catalogUpdatedAt:
              useLibrarySearchStore.getState().catalog?.fetchedAt ?? null,
          },
          nextOffset: offset + limit < matches.length ? offset + limit : null,
        };
      },
    ),
    tool(
      "drivebeats_list_collections",
      "List synced Playlists and Favorites. Provide collectionId to read that collection's track IDs in saved order.",
      z.object({ collectionId: id.optional(), ...page }),
      true,
      async ({ collectionId, offset, limit }, userId, signal) => {
        const saved = await collections(userId, signal);
        if (!collectionId)
          return {
            collections: saved.map(({ id, name, tracks }) => ({
              id,
              name,
              trackCount: tracks.length,
            })),
          };
        const selected = saved.find((item) => item.id === collectionId);
        if (!selected)
          throw new ToolError(
            "collection_not_found",
            "Choose a collection ID from drivebeats_list_collections.",
          );
        return {
          id: selected.id,
          name: selected.name,
          total: selected.tracks.length,
          tracks: selected.tracks
            .slice(offset, offset + limit)
            .map((track) => publicTrack(playlistTrackToDriveFile(track))),
          nextOffset:
            offset + limit < selected.tracks.length ? offset + limit : null,
        };
      },
    ),
    tool(
      "drivebeats_play",
      "Play exactly one saved collection or an ordered queue of track IDs from Library Search or saved collections. The browser may require an initial Play click. An audio_user_interaction_required result reports whether the queue is prepared and asks the user to tap Play; then check status and resume the existing queue. Success confirms actual playback.",
      z.union([
        z.object({ collectionId: id, trackIds: z.never().optional() }),
        z.object({
          trackIds: z.array(id).min(1).max(1000),
          collectionId: z.never().optional(),
        }),
      ]),
      false,
      async ({ collectionId, trackIds }, userId, signal) => {
        if (collectionId) {
          const selected = (await collections(userId, signal)).find(
            (item) => item.id === collectionId,
          );
          if (!selected)
            throw new ToolError(
              "collection_not_found",
              "Choose a collection ID from drivebeats_list_collections.",
            );
          return {
            playback: await startPlayback(
              selected.tracks.map(playlistTrackToDriveFile),
              userId,
              signal,
              collectionId,
            ),
          };
        }
        const available = await playableTracks(userId, signal, false, trackIds);
        const queue = (trackIds ?? []).map((trackId) => {
          const track = available.get(trackId);
          if (!track)
            throw new ToolError(
              "track_not_found",
              "A track ID is outside this Library and its saved collections. Search again.",
            );
          return track;
        });
        return { playback: await startPlayback(queue, userId, signal) };
      },
    ),
    tool(
      "drivebeats_queue_tracks",
      "Queue track IDs from Library Search or saved collections without starting or interrupting playback. Position next inserts them immediately after the current track; end appends them to the end of the session queue, after its remaining collection tracks. Tracks retain the supplied order, even during shuffle. Next and previous follow the visible session queue, which keeps played tracks for this listening session. This changes only the current browser's Playback Queue and does not save a Playlist. If no track is playing, use the page's Play button or next control to start the queue.",
      z.object({
        trackIds: z.array(id).min(1).max(1000),
        position: z.enum(["next", "end"]),
      }),
      false,
      async ({ trackIds, position }, userId, signal) => {
        const available = await playableTracks(userId, signal, false, trackIds);
        const tracks = trackIds.map((trackId) => {
          const track = available.get(trackId);
          if (!track)
            throw new ToolError(
              "track_not_found",
              "A track ID is outside this Library and its saved collections. Search again.",
            );
          return track;
        });
        assertAccount(userId, signal);
        const additions = position === "next" ? [...tracks].reverse() : tracks;
        for (const track of additions) {
          usePlayerStore
            .getState()
            .queueTrack(
              track,
              position,
              "folderStack" in track
                ? (track as { folderStack: typeof INITIAL_STACK }).folderStack
                : undefined,
            );
        }
        return {
          playback: playback(),
          queuedTracks: usePlayerStore.getState().queuedTracks.map((entry) => ({
            entryId: entry.entryId,
            ...publicTrack(entry.track),
          })),
        };
      },
    ),
    tool(
      "drivebeats_control_playback",
      "Control the current page's player: pause, resume, next, previous, seek in seconds, volume from 0 to 1, shuffle enabled, or repeat off/one/all. Next and previous follow the visible session queue, including played tracks and explicit additions. Previous rewinds the current track when more than three seconds have played. Resume preserves the existing queue. If audio permission blocks playback, ask the user to tap Play in DriveBeats and check status. Busy results require waiting for the current action.",
      z.discriminatedUnion("action", [
        z.object({ action: z.enum(["pause", "resume", "next", "previous"]) }),
        z.object({
          action: z.literal("seek"),
          seconds: z.number().finite().min(0),
        }),
        z.object({
          action: z.literal("volume"),
          volume: z.number().min(0).max(1),
        }),
        z.object({ action: z.literal("shuffle"), enabled: z.boolean() }),
        z.object({
          action: z.literal("repeat"),
          mode: z.enum(["off", "one", "all"]),
        }),
      ]),
      false,
      async (input, userId, signal) => {
        assertAccount(userId, signal);
        const requiresTrack = ["resume", "next", "previous", "seek"].includes(
          input.action,
        );
        if (requiresTrack) {
          const before = usePlayerStore.getState();
          const hasPreparedQueue =
            (before.playbackSequence.length > 0 ||
              before.queuedTracks.length > 0) &&
            ["resume", "next"].includes(input.action);
          if (
            (!before.currentTrack && !hasPreparedQueue) ||
            (before.currentTrack && !before.audio)
          )
            throw new ToolError(
              "no_current_track",
              "Choose a track or collection with drivebeats_play, or queue tracks first.",
            );
          const available = await playableTracks(userId, signal, true, [
            ...(before.currentTrack ? [before.currentTrack.id] : []),
            ...before.playlist.map((track) => track.id),
            ...before.queuedTracks.map((entry) => entry.track.id),
            ...before.playbackSequence.map((entry) => entry.track.id),
          ]);
          const current = usePlayerStore.getState();
          if (
            current.currentTrack !== before.currentTrack ||
            current.playlist !== before.playlist ||
            current.queuedTracks !== before.queuedTracks ||
            current.playbackSequence !== before.playbackSequence ||
            current.playbackCursor !== before.playbackCursor
          )
            throw new ToolError(
              "player_changed",
              "The player changed during the read. Try again.",
            );
          if (
            (before.currentTrack && !available.has(before.currentTrack.id)) ||
            before.playlist.some((track) => !available.has(track.id)) ||
            before.queuedTracks.some(
              (entry) => !available.has(entry.track.id),
            ) ||
            before.playbackSequence.some(
              (entry) => !available.has(entry.track.id),
            )
          )
            throw new ToolError(
              "track_not_found",
              "The current Playback Queue is outside this account's Library and saved collections. Choose a new track.",
            );
        }
        const player = usePlayerStore.getState();
        const expectsPlayback =
          input.action === "resume" ||
          (input.action === "previous" &&
            (player.audio?.currentTime ?? 0) <= 3 &&
            (player.playbackSequence.length
              ? player.playbackCursor > 0
              : player.currentIndex > 0)) ||
          (input.action === "next" && hasNextTrack(player));
        if (["resume", "next", "previous"].includes(input.action)) {
          return guardedPlayback(userId, signal, async () => {
            if (input.action === "resume") {
              if (!(await player.play())) throw playbackError();
            } else if (input.action === "next") await player.next();
            else await player.previous();
            assertAccount(userId, signal);
            if (expectsPlayback && !playback().isPlaying) throw playbackError();
            return { playback: playback() };
          });
        }
        switch (input.action) {
          case "pause":
            player.pause();
            break;
          case "seek":
            if (input.seconds > player.duration)
              throw new ToolError(
                "invalid_position",
                "Seek within the current track's duration.",
              );
            player.seek(input.seconds);
            break;
          case "volume":
            player.setVolume(input.volume);
            break;
          case "shuffle":
            if (player.shuffle !== input.enabled) player.toggleShuffle();
            break;
          case "repeat":
            for (
              let i = 0;
              usePlayerStore.getState().repeat !== input.mode && i < 3;
              i++
            )
              player.cycleRepeat();
            break;
        }
        assertAccount(userId, signal);
        return { playback: playback() };
      },
    ),
    tool(
      "drivebeats_save_playlist",
      "Create a named Playlist, or rename an existing Playlist by ID. Changes sync to your DriveBeats cloud library. If completion is uncertain, read collections before repeating creation to avoid duplicates.",
      z.object({ name, playlistId: id.optional() }),
      false,
      async ({ name, playlistId }, userId, signal, markEffectStarted) => {
        const saved = await collections(userId, signal);
        if (playlistId) {
          if (
            playlistId === FAVORITES_COLLECTION_ID ||
            !saved.some((item) => item.id === playlistId)
          )
            throw new ToolError(
              "playlist_not_found",
              "Choose an existing Playlist ID.",
            );
          markEffectStarted();
          await usePlaylistStore.getState().renamePlaylist(playlistId, name);
        } else {
          markEffectStarted();
          playlistId =
            (await usePlaylistStore.getState().createPlaylist(name)) ??
            undefined;
        }
        assertAccount(userId, signal);
        if (
          !playlistId ||
          !usePlaylistStore
            .getState()
            .playlists.some(
              (item) => item.id === playlistId && item.name === name,
            )
        )
          throw new ToolError(
            "sync_failed",
            "The Playlist could not be saved. Check DriveBeats and try again.",
          );
        return { playlistId, name };
      },
    ),
    tool(
      "drivebeats_edit_playlist_tracks",
      "Add track IDs from Library Search or saved collections to a Playlist, or remove a track. Verified saved tracks do not need a Library refresh. Changes sync in DriveBeats; Google Drive stays read-only. Verify collections before retrying an uncertain change.",
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("add"),
          playlistId: id,
          trackIds: z.array(id).min(1).max(1000),
        }),
        z.object({ action: z.literal("remove"), playlistId: id, trackId: id }),
      ]),
      false,
      async (input, userId, signal, markEffectStarted) => {
        const saved = await collections(userId, signal);
        const selected = saved.find((item) => item.id === input.playlistId);
        if (!selected || selected.id === FAVORITES_COLLECTION_ID)
          throw new ToolError(
            "playlist_not_found",
            "Choose an existing Playlist ID.",
          );
        if (input.action === "remove") {
          if (!selected.tracks.some((track) => track.fileId === input.trackId))
            throw new ToolError(
              "track_not_found",
              "The track is not in this Playlist.",
            );
          markEffectStarted();
          await usePlaylistStore
            .getState()
            .removeTrack(input.playlistId, input.trackId);
          assertAccount(userId, signal);
          if (
            usePlaylistStore
              .getState()
              .playlists.find((item) => item.id === input.playlistId)
              ?.tracks.some((track) => track.fileId === input.trackId)
          )
            throw new ToolError(
              "sync_failed",
              "The track could not be removed.",
            );
          return {
            playlistId: input.playlistId,
            removedTrackId: input.trackId,
          };
        }
        const available = await playableTracks(
          userId,
          signal,
          false,
          input.trackIds,
        );
        const tracks = [...new Set(input.trackIds)].map((trackId) => {
          const track = available.get(trackId);
          if (!track)
            throw new ToolError(
              "track_not_found",
              "A track is outside this Library and its saved collections.",
            );
          return createPlaylistTrack(track);
        });
        markEffectStarted();
        const result = await usePlaylistStore
          .getState()
          .addTracks(input.playlistId, tracks);
        if (result.skippedCount > 0 && result.addedCount === 0)
          throw new ToolError(
            "sync_failed",
            "Tracks could not be added. Check sync or the Playlist track limit.",
          );
        return { playlistId: input.playlistId, ...result };
      },
    ),
    tool(
      "drivebeats_set_favorite",
      "Set or clear Favorite for a track ID returned by Library Search or saved collections. Verified saved tracks do not need a Library refresh. Changes sync to DriveBeats only. Verify collections before retrying an uncertain change.",
      z.object({ trackId: id, favorite: z.boolean() }),
      false,
      async ({ trackId, favorite }, userId, signal, markEffectStarted) => {
        const available = await playableTracks(userId, signal, false, [
          trackId,
        ]);
        const track = available.get(trackId);
        if (!track)
          throw new ToolError(
            "track_not_found",
            "Choose a track from the Library or saved collections.",
          );
        markEffectStarted();
        await useLibraryStore
          .getState()
          .setFavorite(createPlaylistTrack(track), favorite);
        assertAccount(userId, signal);
        if (
          Boolean(useLibraryStore.getState().tracks[trackId]?.isFavorite) !==
          favorite
        )
          throw new ToolError(
            "sync_failed",
            "The Favorite change could not be saved.",
          );
        return { trackId, favorite };
      },
    ),
  ];
}
