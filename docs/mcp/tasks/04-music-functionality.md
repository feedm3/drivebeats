# Task 4 Shared music functionality

Read [execution context](../context.md) and [task 3 notes](03-account-linking.md#execution-notes). Requires real linked-account/Drive-read proof. Implement 4a → 4b → 4c → 4d as reviewable slices. An assignment to one slice requires earlier dependencies but does not silently authorize later slices.

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

Not started. Record 4a/4b/4c/4d separately, actual interfaces, import/session method, tool contracts, operation-ID handling, model invocation/budget, live outcomes and remaining limitations.
