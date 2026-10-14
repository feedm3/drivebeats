import { z } from "zod";
import { createPlaylistTrack, playlistTrackToDriveFile } from "@/lib/audio";
import {
  hasPendingLocalMutations,
  runCloudLibrarySync,
} from "@/lib/cloud-library-sync-runner";
import { searchLibraryCatalog } from "@/lib/library-search-catalog";
import type { WebMcpTool } from "@/lib/webmcp-registration";
import { useAuthStore } from "@/stores/auth-store";
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
let verifiedCollectionAccount: string | null = null;
function playback() {
  const state = usePlayerStore.getState();
  const userId = useAuthStore.getState().user?.id;
  const search = useLibrarySearchStore.getState();
  const catalogOwned =
    search.catalog?.userId === userId &&
    !search.invalidated &&
    search.catalog?.importsSignature === getLibrarySearchImportsSignature();
  const trackDetailsAvailable =
    !state.currentTrack ||
    Boolean(
      (catalogOwned &&
        search.catalog?.tracks.some(
          (track) => track.id === state.currentTrack?.id,
        )) ||
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
  return {
    track:
      state.currentTrack && trackDetailsAvailable
        ? publicTrack(state.currentTrack)
        : null,
    trackDetailsAvailable,
    isPlaying: Boolean(state.audio && !state.audio.paused && state.isPlaying),
    isLoading: state.isLoading,
    positionSeconds: state.currentTime,
    durationSeconds: state.duration,
    volume: state.volume,
    muted: state.isMuted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    queueLength: state.playlist.length,
  };
}
async function library(userId: string, signal?: AbortSignal) {
  assertAccount(userId, signal);
  const ready = await useLibrarySearchStore.getState().ensureReady();
  assertAccount(userId, signal);
  const state = useLibrarySearchStore.getState();
  if (
    !ready ||
    !state.catalog ||
    state.catalog.userId !== userId ||
    state.invalidated ||
    state.catalog.importsSignature !== getLibrarySearchImportsSignature()
  )
    throw new ToolError(
      "library_unavailable",
      "The complete Library is not available. Check your connection and imported items in DriveBeats, then try again.",
    );
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
    if (!played || !playback().isPlaying)
      throw new ToolError(
        "playback_blocked",
        "Playback did not start. Tap Play in DriveBeats to allow browser audio, or check your connection and Drive access.",
      );
    return playback();
  });
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
    signal?: AbortSignal,
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
      try {
        const parsed = schema.safeParse(input ?? {});
        if (!parsed.success)
          throw new ToolError(
            "invalid_input",
            "Tool arguments do not match the input schema.",
          );
        const userId = requiresAuth ? account() : "";
        if (options?.signal?.aborted)
          throw new ToolError("cancelled", "The action was cancelled.");
        const result = await action(parsed.data, userId, options?.signal);
        if (requiresAuth) assertAccount(userId, options?.signal);
        return { ok: true, ...(result as object) };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof ToolError
              ? { code: error.code, message: error.message }
              : {
                  code: "action_failed",
                  message:
                    "DriveBeats could not complete the action. Check the page and your connection, then try again.",
                },
        };
      }
    },
  };
}

export function createDriveBeatsTools(): WebMcpTool[] {
  return [
    tool(
      "drivebeats_status",
      "Read sign-in and live playback status in this open DriveBeats page. Sign in and import music through the page before using music tools.",
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
            ? { playback: playback() }
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
      "Search filenames across the complete imported Library only. Returns track IDs for playback and saved collections; never searches all Google Drive files.",
      z.object({ query: z.string().max(500).default(""), ...page }),
      true,
      async ({ query, offset, limit }, userId, signal) => {
        const matches = searchLibraryCatalog(
          await library(userId, signal),
          query,
        );
        return {
          total: matches.length,
          tracks: matches.slice(offset, offset + limit).map(publicTrack),
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
      "Play a Playlist/Favorites collection, or an ordered Playback Queue of track IDs returned by Library Search or saved collections. Browser audio may require tapping Play.",
      z
        .object({
          collectionId: id.optional(),
          trackIds: z.array(id).min(1).max(1000).optional(),
        })
        .refine(
          (input) => Boolean(input.collectionId) !== Boolean(input.trackIds),
        ),
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
      "drivebeats_control_playback",
      "Control the current page's player. Use pause, resume, next, previous, seek (seconds), volume (0 to 1), shuffle (enabled), or repeat (off/one/all).",
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
          if (!before.currentTrack || !before.audio)
            throw new ToolError(
              "no_current_track",
              "Choose a track or collection with drivebeats_play first.",
            );
          const available = await playableTracks(userId, signal, true, [
            before.currentTrack.id,
            ...before.playlist.map((track) => track.id),
          ]);
          const current = usePlayerStore.getState();
          if (
            current.currentTrack !== before.currentTrack ||
            current.playlist !== before.playlist
          )
            throw new ToolError(
              "player_changed",
              "The player changed during the read. Try again.",
            );
          if (
            !available.has(before.currentTrack.id) ||
            before.playlist.some((track) => !available.has(track.id))
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
            (player.audio?.currentTime ?? 0) <= 3) ||
          (input.action === "next" && hasNextTrack(player));
        if (["resume", "next", "previous"].includes(input.action)) {
          return guardedPlayback(userId, signal, async () => {
            if (input.action === "resume") {
              if (!(await player.play()))
                throw new ToolError(
                  "playback_blocked",
                  "Tap Play in DriveBeats to allow audio playback.",
                );
            } else if (input.action === "next") await player.next();
            else await player.previous();
            assertAccount(userId, signal);
            if (expectsPlayback && !playback().isPlaying)
              throw new ToolError(
                "playback_blocked",
                "Playback did not start. Check DriveBeats or tap Play.",
              );
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
      "Create a named Playlist, or rename an existing Playlist by ID. Changes sync to your DriveBeats cloud library.",
      z.object({ name, playlistId: id.optional() }),
      false,
      async ({ name, playlistId }, userId, signal) => {
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
          await usePlaylistStore.getState().renamePlaylist(playlistId, name);
        } else {
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
      "Add track IDs from Library Search or saved collections to a Playlist, or remove a single track from a Playlist. This changes DriveBeats only; Google Drive stays read-only.",
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("add"),
          playlistId: id,
          trackIds: z.array(id).min(1).max(1000),
        }),
        z.object({ action: z.literal("remove"), playlistId: id, trackId: id }),
      ]),
      false,
      async (input, userId, signal) => {
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
        const available = await playableTracks(userId, signal);
        const tracks = [...new Set(input.trackIds)].map((trackId) => {
          const track = available.get(trackId);
          if (!track)
            throw new ToolError(
              "track_not_found",
              "A track is outside this Library and its saved collections.",
            );
          return createPlaylistTrack(track);
        });
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
      "Set or clear Favorite for a track ID returned by Library Search or saved collections. Changes sync to DriveBeats only.",
      z.object({ trackId: id, favorite: z.boolean() }),
      false,
      async ({ trackId, favorite }, userId, signal) => {
        const available = await playableTracks(userId, signal);
        const track = available.get(trackId);
        if (!track)
          throw new ToolError(
            "track_not_found",
            "Choose a track from the Library or saved collections.",
          );
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
