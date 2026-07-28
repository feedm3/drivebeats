import type { Playlist, PlaylistTrack } from "@/types";

/**
 * Control characters cannot appear in Google Drive file names, so using them as
 * delimiters keeps signatures unambiguous: no combination of file names, folder
 * names or ids can produce a delimiter collision and forge an equal signature.
 */
const FIELD_SEPARATOR = "\u0001";
const RECORD_SEPARATOR = "\u0002";
const GROUP_SEPARATOR = "\u0003";
const LIST_SEPARATOR = "\u0004";

function field(value: string | undefined) {
  return value ?? "";
}

/**
 * Serializes `parents` in its original order, because the order is meaningful:
 * every consumer reads `parents[0]` as *the* folder the track lives in, see
 * `deriveFolderStack` in the player store and the `resolveParentFolderName`
 * fallback in the playlist store. A different first parent is a different
 * "navigate to this track's folder" target, so it must count as a change.
 *
 * `undefined` and `[]` deliberately collapse to the same empty encoding: both
 * mean "no known parent" to every consumer (`parents?.[0]`, `parents ?? []`),
 * and the cloud column is `TEXT[] NOT NULL DEFAULT '{}'`, so a locally
 * undefined `parents` always comes back as `[]`. Distinguishing them would make
 * that round-trip normalization look like a change and force a pointless full
 * store replacement for every such track.
 */
function listField(values: string[] | undefined) {
  return values?.join(LIST_SEPARATOR) ?? "";
}

/**
 * For user-authored free text, where the "control characters cannot occur"
 * assumption above does not hold. Playlist names are typed by the user and
 * `src/lib/cloud-library-validation.ts` accepts control characters, so a raw
 * join could be forged: two playlists whose names contain a separator can
 * produce the signature of a differently-named pair, and the rename would be
 * silently skipped as a no-op. Length-prefixing makes the encoding unambiguous
 * for any content.
 */
function userTextField(value: string) {
  return `${value.length}${LIST_SEPARATOR}${value}`;
}

/**
 * Identity + version of a track: fileId plus the fields that tell us the
 * underlying Drive file changed. Used to decide whether offline downloads went
 * stale, so it deliberately ignores purely cosmetic fields.
 */
export function getTrackSignature(tracks: PlaylistTrack[]): string {
  return tracks
    .map((track) =>
      [track.fileId, field(track.modifiedTime), field(track.size)].join(
        FIELD_SEPARATOR,
      ),
    )
    .join(RECORD_SEPARATOR);
}

/**
 * Everything about a track that the UI renders or plays back. Used to detect
 * whether a cloud payload would actually change what is on screen.
 */
function getTrackContentSignature(track: PlaylistTrack): string {
  return [
    track.fileId,
    field(track.fileName),
    field(track.mimeType),
    field(track.size),
    field(track.modifiedTime),
    listField(track.parents),
    field(track.parentFolderName),
  ].join(FIELD_SEPARATOR);
}

/**
 * Order-sensitive: both the playlist order and the track order inside a
 * playlist are user-visible state, so a reorder must count as a change.
 */
export function getPlaylistsSignature(playlists: Playlist[]): string {
  return playlists
    .map((playlist) =>
      [
        playlist.id,
        userTextField(playlist.name),
        playlist.tracks.map(getTrackContentSignature).join(RECORD_SEPARATOR),
      ].join(GROUP_SEPARATOR),
    )
    .join(GROUP_SEPARATOR);
}

/**
 * Order-insensitive: favorites live in a record keyed by fileId and the UI
 * sorts them itself, so the order the cloud happens to return them in is not
 * state. Sorting the per-track signatures (which start with the unique fileId)
 * gives a stable signature for the same set.
 */
export function getFavoritesSignature(favorites: PlaylistTrack[]): string {
  return favorites.map(getTrackContentSignature).sort().join(RECORD_SEPARATOR);
}
