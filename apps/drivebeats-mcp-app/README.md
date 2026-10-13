# DriveBeats MCP App

React player UI served by the existing Next web app's `/mcp` endpoint. It retains two original sample tracks and adds account linking plus a read-only
summary of existing cloud Playlists and favorites. Full Library browsing and
personal music playback are separate work. The UI uses the same logo asset and blue/neutral palette as DriveBeats web.

Run from the repository root:

```sh
pnpm --filter @drivebeats/mcp-app dev
pnpm --filter @drivebeats/mcp-app build
pnpm --filter @drivebeats/mcp-app test
```

The two checked-in MP3s live in `public/mcp-fixtures`. They are original six-second
instrumental samples, encoded once from the existing synthesized audio with
FFmpeg 9.0.2. No third-party recordings or samples are used. Their immutable paths
are declared in `src/fixture-tracks.ts`; audio is served as ordinary static assets.

Vite and vite-plugin-singlefile bundle JavaScript, CSS and the unchanged shared
logo into `dist/index.html`. The web build copies the MP3 assets and injects its
public origin as JSON before the module. The UI accepts a canonical HTTPS origin
(or exact loopback HTTP for local checks) and constructs the two fixed MP3 URLs.
Tool results cannot replace the audio sources. Standalone Vite uses the same
static MP3 paths. There is no browser audio generation or source fallback.

The standard MCP Apps bridge receives fixture metadata and calls
`drivebeats_list_fixture_tracks` from Refresh tracks. An accessible “Tracks
refreshed” status appears only after a successful validated host response. Refresh
is unavailable without a capable host; the standalone sample player still works.

One HTMLAudioElement survives metadata updates. Play requires a deliberate tap;
Pause stops playback and Next prepares the following track without autoplay.
BFCache suspension pauses playback while preserving the document; final teardown
unmounts the player. Playback and loading errors remain concise and visible.
Temporary playback/CSP probes and raw protocol-result displays have been removed.
Host/background playback guarantees still depend on actual host acceptance checks
recorded in `docs/mcp/tasks/02-basic-mcp-app.md`.

The account panel shares the existing MCP Apps connection. Connect deliberately
calls the app-only `drivebeats_connect_account` with the full baseline account,
cloud and media scope request so the host can perform account linking, then
`drivebeats_get_cloud_library`. The profile uses the standard top-level stable
Google identity contract. The panel shows account identity, Playlist names and
track counts, and a favorites count. Refresh reads the same backend data again;
Disconnect calls `drivebeats_disconnect` and clears displayed account data while
retaining cloud data. Signed-out, canceled/expired connection, scope denial and
host errors keep the sample Audio element mounted. No website cookies, Google
credentials or OAuth tokens enter this UI or its storage.

Task 4 can use `bridge.account.prepareMedia(fileId)`. It calls the app-only
`drivebeats_prepare_media` tool and returns a short-lived media capability from
`_meta.mediaUrl` only after checking the requested track, expiry and the exact
server-injected authorization origin/path. The capability is returned only to the calling UI;
it is absent from account state and model-readable results. The separate
`drivebeats-media-read` JSON script provides this authorization origin; it may
differ from the sample audio deployment origin. Missing or invalid configuration
disables the media adapter. This adapter does
not start playback. Real ChatGPT account linking and selected Drive audio
acceptance remain separate from local tests.
