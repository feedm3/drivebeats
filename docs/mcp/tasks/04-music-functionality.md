# Task 4 Shared music functionality

Read [execution context](../context.md) and [task 3 notes](03-account-linking.md#execution-notes). Real linked-account/cloud reads are recorded in task 3; real selected-media acceptance remains open. Implement 4a → 4b → 4c → 4d as reviewable slices. An assignment to one slice requires earlier dependencies but does not silently authorize later slices.

## Existing modules

After task 1, these paths are relative to apps/drivebeats-web/src:

- UI: components/{file-browser,file-list,folder-tree,folder-tree-node,folder-search,breadcrumb-nav,app-page-client,app-desktop-view,app-mobile-view}.tsx, components/player/* and components/ui/*.
- Browser integration: hooks/{use-drive-import,use-folder-contents}.ts; lib/{google-picker,google-api,library-search-drive,library-search-catalog,library-search-catalog-db,folder-cache-db,offline-media,track-metadata,shuffle}.ts.
- State: stores/{auth,imported-drive,library-search,folder-cache,folder-tree,player,playlist,library,id3-metadata}-store.ts and nearby tests.
- Cloud: lib/{cloud-library-service,cloud-library-api,cloud-library-shared,cloud-library-validation,playlist-limits}.ts, API routes and db/*.

UI reaches global auth/state hooks directly; AppPageClient uses Next dynamic loading/navigation. Extract shared music behavior while app adapters retain Next routing, website-cookie handling and ChatGPT setup. Client packages cannot import server credential/database code.

## 4a Full Library and shared browsing

Prerequisite: task 3. Create @drivebeats/client with interfaces for Library reads/search, cloud collections, auth/media and player behavior. Consume task 3's actual interfaces; avoid a generic adapter framework.

- [ ] Share folder tree, breadcrumbs, lists/search and styling. Both apps consume it; preserve ordinary web behavior/tests.
- [ ] Import folders/files in plugin with existing minimum permissions. Working default: select once in plugin, without automatic website import inheritance. Prove Google Picker or a supported external selection flow in the sandbox.
- [ ] Build the full account-scoped catalog locally; publish only complete generations. Preserve filename-only search and Imported Folder membership. Tracks absent from Playlists/favorites must be found.
- [ ] Add an account/session-scoped bridge for MCP search_library/browse_folder operations. Return bounded/paginated IDs/names/paths. Local IndexedDB or updating model context alone does not make remote MCP search callable.
- [ ] Document request/result flow, timeouts, session selection and persistence. Process-local memory is not a reliable serverless cross-request bus. Only short-lived coordination data may use backend storage; never upload the full catalog/tree to Neon.
- [ ] Tools return unavailable after session closure/expiry. Index rebuild keeps the previous complete generation or reports not-ready; partial results are not a complete catalog.

Acceptance: both UIs work, real ChatGPT search/manual browsing reach all imported tracks, and account/import boundaries exclude unrelated Drive files. Update pointers to moved code.

## 4b Player and synced collections

Prerequisite: 4a plus task 3's media/auth interface.

- [ ] Share the browser player for real user-selected Drive audio; media/cache stay device-local. Preserve play/pause/next/previous/seek/volume/shuffle/repeat and no-repeat shuffle semantics.
- [ ] Reuse cloud Playlist/favorite services, limits and ID3 metadata sync. Independent browser runtime state uses the same cloud account/data.
- [ ] Handle missing media, expired access, gesture rejection, suspension and teardown using task 2 findings. Ordinary tool/UI updates do not remount Audio.

Acceptance: audible real Drive playback; usable controls on mobile/desktop; cloud changes visible after another session refresh. Logout clears device data and preserves cloud data. Existing cloud deletion clears synced data without any Drive writes. Verify website regressions.

## 4c Requested ChatGPT actions

Prerequisite: 4a and 4b. Focused tools may include get_playback_state, play_track, pause_playback, skip_track, queue_tracks and create_playlist. Choose/document exact names/schemas for discoverability.

- [ ] Validate IDs against Library results and account ownership; reject invented tracks/user identity.
- [ ] Distinguish saved Playlist mutations from temporary Playback Queue changes. Preview/save through current services and limits; data tools do not remount the player.
- [ ] Explicitly target one active player/session and acknowledge execution. Results distinguish queued/applied/unavailable/failed.
- [ ] Define stable operation IDs and duplicate handling for creates/skips/queue changes. New JSON-RPC IDs on retries cannot repeat the business action. Test stale/concurrent commands/session expiry.

Acceptance: actual chat searches tracks, saves a Playlist visible in web, and controls audible playback. Test direct/follow-up/unsupported requests, duplicates and closed players. Publish correct annotations/schemas.

## 4d Optional DJ Mode

Prerequisite: 4c. User requires requested actions and automatic upcoming-track selection. DJ Mode starts/stops explicitly, preserves controls and prioritizes manual choices.

- [ ] Define listening intent, bounded candidates, recent history and prepared upcoming tracks. Use names/available metadata; no unsupported BPM/genre/audio-understanding claims.
- [ ] Prove and implement a supported refill invocation. MCP alone cannot wake ChatGPT when a track ends. Test documented host inference APIs in an explicitly user-started mode; otherwise investigate separate backend model calls.
- [ ] If backend inference is required, use supported credential setup and agree concrete provider/cost limits before billable runs. No silently added paid integration. Context stays bounded, account-scoped and credential-free.
- [ ] Prepare tracks ahead; ordinary-queue fallback handles latency/errors. Stop after disabling/closing/expiring a session. Duplicate/late results cannot override manual choices.

Acceptance: a real listening session automatically receives another verified selection without another user request each time. Demonstrate manual override, stop, refill failure and closure. A fixed AI-generated Playlist demonstrates planning, not ongoing DJ refill; leave this slice unchecked if refill remains unresolved.

## Checks and handoff

Run root checks plus web/ChatGPT flows per slice. Preserve existing behavioral tests; cover changed adapter/catalog/command/retry/sync/DJ contracts. Record audible outcomes, host/navigation limits, another-session sync, logout/deletion and mobile layout results.

Task 4 completes only when all slices pass. Missing host capabilities/credentials leave explicit gaps; mocked evidence does not replace live proof.

## Execution notes

Implemented on 2026-10-13 with three implementation subagents, independent
cross-reviews, supervisor integration and browser verification. **Live
production acceptance remains open; the task and acceptance checkboxes remain
unchecked.** Source implementation is separate from deployment and real-host
acceptance.

### Slice status

| Slice | Implemented and locally verified | Remaining real acceptance |
| --- | --- | --- |
| 4a Library | Shared `@drivebeats/client` breadcrumbs, filename highlighting, folder rows, search controls and shuffle rules consumed by both apps. Plugin has full account-scoped complete-generation IndexedDB catalog, filename search, pagination, provider-verified import boundary, external first-party Picker and encrypted local import receipts. Durable session mailbox exposes local search/browse to MCP. | Actual external Google Picker selection/return/restoration in ChatGPT, unsaved nested real track search, account/import isolation on real Drive. |
| 4b Player/collections | Stable browser Audio, real scoped media adapter, normal controls, no-repeat shuffle, synced collections and ID3 metadata reads, atomic Playlist-with-tracks creation, owned favorite removal, expiry/gesture/teardown handling. Existing website adapters retained. | Audible real Google Drive playback, another-session sync refresh, website sign-in/refresh/logout, disconnect data preservation, authorized disposable-account cloud deletion. |
| 4c Chat actions | 24 total production tools with authenticated session targeting, provider ancestry validation, durable claims, stable UUID operation IDs, stale/duplicate/closed command handling, queued/applied/failed/unavailable results. Data tools omit render resources. | Actual natural-language ChatGPT search/save/playback chain, real target selection and follow-up/unsupported requests. |
| 4d DJ Mode | Explicit start/stop, supported MCP Apps host sampling, bounded verified candidate metadata/recent history, ahead-of-time selections, timed refill/error fallback, manual override and late-result guards. No additional paid provider or API key. | Real target-host sampling capability and another automatic selection in a real listening session; leave incomplete if host support is absent. |

### Contracts and paths

See [music functionality](../music-functionality.md) for the complete request,
result, timeout, persistence, permission and DJ contracts.

- Portable audio types/rules remain in `packages/drivebeats-core`; audio helpers
  now share the same filename/MIME support between web/server and plugin catalog.
  Shared client views/catalog/player/shuffle live in `packages/drivebeats-client`.
- Production UI uses `music-bridge.ts`, `player.tsx`, the existing account bridge,
  and a stable external Audio element. All fixture runtime modules, sample tools,
  checked-in MP3s, immutable fixture headers and sample asset build steps removed.
  Synthetic data/media exist only in tests and temporary browser verification.
- Backend: `lib/mcp/{music-tools,music-library-service,music-session-service,import-selection-service}.ts`,
  table-owned `db/mcp-music-{sessions,commands,imports}.ts`, shared cloud service
  atomic create and per-table query builders. New forward migration0009 adds
  three temporary coordination tables and optional media session binding.
- Import: `/mcp/import/[capability]` plus `/api/mcp/import/[capability]`; the
  ordinary website's existing Picker hook is reused without modifying its
  imports. Selection account/Origin/body/provider/type/trashed checks precede
  atomic capability consumption. Pending selection has a capped10-minute lease.
- Release source: `plugins/drivebeats`, version1.0.0, production endpoint and
  four baseline scopes. Existing private plugin ID/audience/icon/default prompt
  preserved in the prepared update; the demo package name is removed. The exact
  compatibility archive passes the actual desktop loader. Remote release is
  still version0.2.2 targeting preview until activation.
- GitHub validation now also runs on pushes to main, matching the authorized
  direct-main publication workflow.

### Verification

| Check | Result |
| --- | --- |
| Root automated tests | Final `pnpm test` passes **468 tests: 9 client + 25 MCP UI + 434 web**, plus core typecheck. |
| Root lint/build | `pnpm lint` and `pnpm build` pass. Existing Biome config deprecation, unrelated broken skill symlink and oversized logo warnings remain; Vite warns about dropping a Next client directive in its browser-only bundle. |
| Important contracts | Complete/failed/canceled/overlapping catalogs; generic MIME supported filenames; bounded search pages and query/generation-bound cursors; duplicate queues/shuffle state; stale/cross-account commands; claim/retry/expiry; auth scopes; provider ancestry and batch validation; Playlist transaction; owned favorite removal; expired receipt recovery; unavailable host; pending creates; manual/late DJ results; actual Stop click cannot restart DJ through form submission. |
| Native local SQL | Applied actual migrations0008/0009 and exercised actual transpiled DB queries in temporary PGlite0.5.9: ownership, single-use imports, pending-import lease, revision guards, duplicate insert, claims, invalid/stale/closed/expired acknowledgements and cleanup. Advisory-lock function was stubbed; cross-connection PostgreSQL concurrency remains unverified. Nothing was applied to remote Neon. |
| Local production HTTP | Compiled Next server with temporary ephemeral auth keys: modern discovery/list with24 production tools, anonymous shell, full four-scope auth challenge, bundled player/CSP and signed-out import/consent recovery passed. No provider/database call or real linking implied. |
| Browser player | Isolated Chromium and compiled UI inside a simulated standard MCP Apps host: **20 checks passed**, including unsaved nested full-Library search/ack, expired-action failure, actual generated WAV decode/time advance, play/pause/next/seek/volume/shuffle/repeat, stable Audio after tool result, saved collection distinction, two host-sampling invocations with automatic refill, explicit DJ stop, closure pause and no overflow at320/428/1100px. Separate measurement found all button/input/select targets at least44x44px. Synthetic media/data stayed in `/private/tmp`, outside production source. |
| Browser auth/web | Actual local first-party signed-out Import page, separate-tab website sign-in link, expired consent recovery and ordinary website signed-out redirect verified. Website Vercel Analytics script404/MIME errors are local hosting artifacts; not MCP bridge errors. Actual Google sign-in remains unverified. |
| React Doctor | No error findings. Fixed confirmed indexed lookup, missing stable empty catalog and account-reset issues; three MCP maintainability warnings remain. Sequential catalog reads intentionally bound provider request concurrency. No installation/configuration changes, score API or supply-chain scan. |
| Desktop package | Compatibility-only1.0.0 ZIP passes actual bundled desktop CLI manifest/server/icon byte checks in isolated temporary state. No installed-plugin update or real OAuth inferred. |
| Remote read-only | Correct Vercel project/root verified through CLI; five MCP variables are preview-only. Neon confirms0009 absent. Plugin Creator confirms original USER/PRIVATE plugin,0.2.2 release and four-file inventory. |

### Review fixes

Independent review and browser verification corrected non-atomic Playlist
creation, stale imports/catalog claims, data-tool render remounts, old shuffle
cycles/duplicate queue loops, delayed authoritative closure, inaccurate previous
track acknowledgement, account-switch navigation leakage, removing saved
favorites outside imports, expired receipts, ambiguous Playlist retry IDs,
manual/late DJ selections, byte-bound pagination and Stop-DJ form resubmission.
The supervisor also aligned the plugin catalog with the website's supported
filename fallback for generic provider MIME types.

### Remaining production work

[Production activation](../production-release.md) records the concrete migration,
production configuration, guarded private-plugin update and real acceptance
sequence. Production MCP configuration, migration0009 and saved-plugin update
require approval under AGENTS.md. The user separately authorized committing
and pushing main. Remote deployment/CI evidence is appended after publication.
No real Google Picker/Drive media, multi-session sync/logout/deletion or actual
ChatGPT DJ sampling has been accepted in this task. Local browser/SQL simulation
is not a substitute for that proof.
