# DriveBeats MCP App

The production music frontend for the private DriveBeats plugin. The existing web backend serves the single-file Vite bundle through its `/mcp` UI resource. No demo catalog, generated audio or sample assets are shipped.

Run from the repository root:

```sh
pnpm --filter @drivebeats/mcp-app dev
pnpm --filter @drivebeats/mcp-app build
pnpm --filter @drivebeats/mcp-app test
```

Connect uses the host's existing DriveBeats OAuth grant and verified Google identity. Credentials stay in the host/server. The app reads the same cloud Playlists, favorites and ID3 metadata as the website. Saved collections are usable independently of this device's imported Library.

Import opens the server-issued, one-time `/mcp/import/[capability]` page through the MCP Apps host. The user signs into the same website account and deliberately selects folders/tracks with Google Picker. Only the trusted external selection flow changes approved imports; model-supplied IDs cannot expand the Library. The server injects the first-party import origin separately from the media authorization origin. UI tool results cannot substitute either trusted origin.

`@drivebeats/client` supplies shared folder rows, breadcrumbs, list filename highlighting, search controls, player rules and styles. Web adapters retain their existing state/cache/routing; the sandbox uses its own account-scoped IndexedDB catalog. Rebuilds traverse every approved subtree/page and publish only complete generations. Filename-only search includes tracks absent from cloud collections. A failed refresh retains the prior complete generation; changed imported roots invalidate the prior catalog. An encrypted, account/grant-bound import receipt restores selection on later launches without uploading the Library catalog. Expired receipts require selecting music again. Logout clears account-local imports/catalog/player/history while preserving cloud data.

The app opens one durable session, heartbeats its catalog revision and polls claimed commands. Search/folder results are bounded by count and UTF-8 byte size, with generation-specific cursors. Playback commands validate current local Library membership and import revision, execute once under the server claim and acknowledge actual applied/failed results. Closed/replaced/expired sessions stop audio and DJ Mode. The server's durable operation IDs handle concurrent requests and retries; Playlist saves retain the same operation ID while the outcome is uncertain.

One stable HTMLAudioElement survives all tool responses and music view changes. It plays short-lived, read-only media capabilities only from the trusted issuer. Normal controls include previous/next, play/pause, seek, volume, shuffle without repeats within a cycle, and repeat off/all/one. Gesture rejection asks the user to tap Play. Page suspension pauses audio and stops DJ Mode; final teardown closes the session/transport and disposes listeners.

DJ Mode is explicitly started during playback. It requests bounded upcoming selections using the installed MCP Apps SDK's `createSamplingMessage` only when the host advertises sampling. Context contains candidate IDs, filenames, paths, existing verified ID3 metadata, listening intent and bounded recent history. No BPM/genre/audio-understanding claims or paid backend integration are added. Manual playback/queue choices stop DJ Mode; stale, invalid or late completions cannot overwrite them. Host rejection/latency falls back to the ordinary Playback Queue. Hosts without sampling show the unsupported state. Actual host inference and audible playback require separate live acceptance; local mocks are contract evidence only.
