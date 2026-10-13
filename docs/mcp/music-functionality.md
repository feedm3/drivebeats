# MCP music functionality

Both frontends share browser-facing views and portable player rules through
`packages/drivebeats-client`. The website keeps its existing auth/storage/routing
adapters; the MCP App has an independent browser runtime. Google Drive access is
read-only with the existing `drive.file` scope and explicit Google Picker selection.

## Library and import

The plugin calls app-only `drivebeats_prepare_import` for its session. A random,
hashed, single-use capability opens `/mcp/import/<capability>` on the first-party
website. The signed-in website account must match the linked plugin account.
The existing Picker requests folders or supported audio. The server verifies
provider metadata with the linked grant, then atomically installs the selected
root IDs in the short-lived session. Neither tool input nor a model-supplied
track ID can authorize a new import.

Selection links last at most ten minutes. While a selection is pending, the
session's normal 60-second idle lease is extended to that deadline, capped by
the eight-hour session lifetime. Successful selection restores the normal idle
lease. Explicit close, disconnect or grant expiry still blocks the selection.

Approved import receipts are encrypted, account/grant-bound and retained only
on the device. A new session can restore those roots with a valid receipt;
reconnecting under another grant requires selecting music again. Server-side
root IDs exist only in temporary sessions. The entire folder tree/catalog,
audio, Playback Queue, player state and recently played history remain local.
No audio or complete Library catalog is uploaded to Neon.

The browser walks every page of the imported subtrees, builds a generation
privately, then atomically publishes it in account-scoped IndexedDB. Failed or
canceled rebuilding cannot publish partial results. Search remains filename-only,
including Playable Tracks absent from saved collections. Imported roots have a
revision so an older build cannot be advertised as the current complete Library.
Search cursors bind the catalog generation and query. Bounded results include
IDs, filenames and paths; another account's browser data is cleared on switch.

## Chat action channel

`mcp_music_sessions`, `mcp_music_commands` and `mcp_music_imports` are persistent
coordination tables, not a server catalog. This works across serverless requests
and instances. The UI polls through app-only tools and executes one claimed
command at a time. Heartbeats maintain a 60-second lease; sessions last at most
eight hours. Commands expire after 30 seconds. Closed/expired sessions are
unavailable, and expired/closed session rows are removed opportunistically on
new-session creation with cascading command/import cleanup.

The UI publishes its active session ID to model context. `drivebeats_list_sessions`
can discover active targets without exposing imports; every chat action still
requires an explicit session ID. Opening a new player on the same grant replaces
the previous session. Other grants remain independently targeted.

Use a stable UUID `operationId` for searches, reads of player state, skips,
queue changes and Playlist creates. Retries with identical arguments read the
same operation; reusing the ID with different arguments is rejected. JSON-RPC
request IDs do not identify business actions. Database row locks serialize
claims; a claimed command is never automatically redelivered. The player rejects
expired commands and imports revisions that have changed.

The server waits up to two seconds for acknowledgement. `queued` means accepted
for delivery, `applied` means acknowledged execution, `failed` describes an actual
failure, and `unavailable` means the target/command expired or closed. Retry a
queued request with the same arguments and operation ID to get its eventual
result. A data result never remounts the Audio element.

Model-visible operations:

- `drivebeats_search_library`, `drivebeats_browse_folder`
- `drivebeats_get_playback_state`, `drivebeats_play_track`,
  `drivebeats_pause_playback`, `drivebeats_skip_track`, `drivebeats_queue_tracks`
- `drivebeats_create_playlist`, `drivebeats_set_favorite`
- Existing profile/cloud-library reads, plus `drivebeats_list_sessions`

Saved mutations require `library:write`; Library reads require `library:read`;
playback requests require `media:read`. Account consent lists all four baseline
scopes including `profile:read`. Existing grants are never silently elevated.

## Player and saved collections

One browser Audio element survives ordinary tool results, collection changes
and refreshes. Play/pause/next/previous/seek/volume/shuffle/repeat use the shared
browser player and no-repeat shuffle rules. Media capabilities stay in tool
`_meta`, expire after five minutes, and never expose Google provider credentials.
Imported media is checked against the active session's roots and provider
ancestry at preparation and streaming. Saved Playlists/favorites retain the
existing account-bound media path without requiring another import.

The same cloud services enforce Playlist limits, track ordering and favorites.
New Playlists and their tracks are inserted in one transaction. Operation IDs
prevent duplicate creates and ambiguous failures require a cloud refresh before
another deliberate create. Removing an owned saved favorite does not require a
new import; adding a favorite requires verified imported membership. Existing
ID3 title/artist/album metadata is read from the same cloud payload and displayed
without changing filename search. No genre/BPM/audio-understanding claim is made.

Browser gesture rejection and missing/expired media show actionable errors.
Authoritative session closure/revocation pauses audio and stops DJ Mode;
transient transport errors retain recoverable state. Disconnect clears the
plugin's local account data and revokes its grant, preserving synced collections.
Ordinary website logout retains the plugin grant and synced cloud data.
Existing cloud deletion cascades grants/temporary sessions and performs no Drive
writes. These boundaries are implemented/tested; real multi-session acceptance
is recorded separately in the execution brief.

## DJ Mode

DJ Mode starts/stops explicitly. It feature-detects the installed MCP Apps
bridge's `sampling` capability and calls `App.createSamplingMessage`; a host
without that capability displays an unavailable state. No separate paid provider
or API credential is introduced. Actual support must be tested in the target host.

Refill sends a bounded window of up to 30 verified candidates, a bounded listening
intent and recent history. Existing filename/ID3 metadata is data, never an
instruction source. Only IDs from that supplied window are accepted. Upcoming
selections are prepared ahead, with a 20-second timeout/rate floor. Ordinary
queue playback continues on inference failure. Manual choices cancel pending
AI selections, and late results cannot override manual changes, a stopped mode,
a closed session or a changed account. Continued automatic refill is live
acceptance work; a fixed AI Playlist does not establish it.

## Verification boundary

Read [Task 4 execution notes](tasks/04-music-functionality.md#execution-notes)
for exact test/build/browser results and remaining real-host checks.
[Production activation](production-release.md) lists the migration, remote
configuration and plugin-release actions still required.
