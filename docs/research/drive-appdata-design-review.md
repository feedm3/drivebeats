# Google Drive app-data design review

Implementation entry point: [supervisor handover](drive-appdata-handover.md) and
[task briefs](drive-appdata-tasks.md). This document supplies design rationale and
historical evidence; the handover defines task order, ownership and final review.

Reviewed 2026-10-22. Research and design only: no application changes, authenticated
Drive calls, runtime tests, deployment or remote mutations. This note combines
repository inspection, Google/Chrome primary sources, parallel agent reviews and
two independent Claude Code reviews. Proposals below are not current behavior.
Source baseline: `02c728ca5c2a93be4875bfb1c831d8bf5711956d`; existing marketing
edits and screenshots were preserved. Both reviews inspected Git status/diff,
finished without errors, and left existing file hashes unchanged.
The mandatory consent, one-time migration and 30-day retirement requirements below
were added by the user after those reviews; Claude has not reviewed these additions.

## Recommendation

Use the user's hidden Google Drive app data for portable music data. Build storage
and deletion first, then roll out mandatory app-folder consent and a one-time
playlist/favorite migration. The migration is required rollout scope, rather than
an optional later feature. Keep authentication, profile, grants and the session/account
generation fence on the server. Keep audio, offline download state, Playback Queue,
active player position and device storage state local. Simple preferences can follow
later; do not restore downloads automatically or synchronize live player controls.

The required result is count-independent: Browser A has **a remotely acknowledged
saved subset**, is abruptly closed, and a clean Browser B restores those records before
missing-tag analysis starts. For unchanged tracks with complete descriptors from
folder listings, B makes **zero per-track audio/Range requests and zero per-track
metadata GETs** for that saved subset. The earlier 100-track example is not a
required test size, batch size or limit. B still downloads app-data batches and uses
ordinary paginated folder listings to rebuild its device-local Library catalog.
Changed files, missing descriptors, inaccessible roots and actual playback are
separate cases; do not advertise that the new browser makes no Drive requests.

## Required login, migration and retirement flow

1. **Mandatory access after login.** Require verified `drive.appdata` approval
   before normal DriveBeats use, including playback and API/WebMCP access. Missing,
   declined or revoked permission shows the grant/retry screen. Keep sign-out,
   privacy and account-deletion/recovery available. Existing users must approve
   too; reuse valid approval on later logins. No optional-sync/local-only bypass.
2. **Migrate once after approval.** Automatically copy existing Neon playlists and
   favorites to Drive, preserving IDs, names, track order and descriptors. Verify
   the complete copy before switching authority and opening the app. Persist the
   account generation and migration version/status on the server; a new browser
   restores Drive data instead of migrating again. Concurrent logins and retries
   must not duplicate or overwrite collections. Failures stay on a retryable
   migration screen; empty source collections are valid initialization.
3. **Start a fixed 30-day window at production rollout.** Record `implemented_at`
   once mandatory consent and working migration are live, and set
   `neon_cleanup_due_at = implemented_at + 30 days`. Display the exact cutoff in
   Europe/Berlin. This is a global deadline, not 30 days after each user's login.
4. **Schedule cleanup in Codex at rollout.** Create a scheduled follow-up in the
   executing supervisor chat using the automation tool for that deadline; record
   its ID. It applies a prepared forward SQL migration removing obsolete music-data tables,
   verifies completion, then disables itself. Notify on completion, failure or
   required action. Scheduling is an implementation deliverable; no job or date
   is created now because rollout has not happened.
5. **Unmigrated users lose old collections at cutoff.** This is the user's explicit
   decision; do not postpone cleanup until everyone migrates. Later logins still
   require app-folder approval, then initialize empty playlists/favorites with a
   clear explanation that they must be recreated. Migrated users restore Drive
   normally. Never query dropped tables or silently reimport stale local
   collections through the old bootstrap path.

Cleanup scope: `playlist_tracks`, `favorite_tracks`, `playlists`, and their retired
indexes/constraints/triggers/functions; include legacy `track_metadata` only if
confirmed present and obsolete. Preserve account/auth tables such as `users`,
`google_oauth_grants` and required migration/session coordination. Prepare the
destructive SQL outside auto-applied migrations until its deadline, as a scoped
operations artifact. When due, allocate the next forward migration under
`db/migrations`; use an explicit object allowlist, not a broad schema drop.
Reconcile the separate existing metadata-retirement runbook/schedule at
`docs/operations/retire-cloud-track-metadata.md` rather than duplicating it.
Deploy support for late unmigrated logins and retire legacy writes before cleanup.
Preflight the intended database, cutoff and remaining dependencies; migration
coverage does not extend the deadline. Cleanup and retries must be idempotent.
At cutoff, block new legacy migration claims/reads and boundedly settle or cancel
in-flight migrations before DDL. Preserve verified Drive copies; incomplete work
and delayed callbacks cannot publish old collections after retirement.

Verify job permissions/access when scheduling. Local Codex scheduling needs the
computer/app running; if unavailable at cutoff, report and run at the next
permitted opportunity, never early.
[Official scheduled-task guidance](https://developers.openai.com/codex/app/automations)

Unresolved product questions: none. Rollout time, cleanup SQL and the actual Codex
job are implementation deliverables.

## Current source evidence

All paths below are repository-relative; line numbers refer to the reviewed source.

| Evidence | Current behavior and implication |
| --- | --- |
| `apps/drivebeats-web/src/lib/metadata-cache-db.ts:4-44` | IndexedDB records are account-scoped and loaded locally, with local epochs. This is not a cross-browser backup. |
| `apps/drivebeats-web/src/lib/metadata-cache-types.ts:3-37,63-93` | Cache identity already includes file modification time/size, parser/policy/schema versions and account; some failures depend on environment/range strategy. Preserve content identity, not device failures. |
| `apps/drivebeats-web/src/lib/track-metadata-loader.ts:266-308,313-335` | A current local record returns before individual metadata lookup or range extraction. Remote restore must hydrate this cache before the missing-tag path runs. |
| `apps/drivebeats-web/src/lib/library-search-drive.ts:80-120` | Bulk lists include `id,name,mimeType,size,modifiedTime,parents`, page through results and reject incomplete searches. These descriptors can validate cache hits without individual file GETs. |
| `apps/drivebeats-web/src/stores/imported-drive-store.ts:7-12,44-77` | Imported Folder and Standalone Track roots are currently local persisted arrays; removing a folder filters its array. Persist deliberate choices, not the entire descendant tree. |
| `apps/drivebeats-web/src/hooks/use-drive-import.ts:36-75` | Picker import fetches individual selected-item descriptors. Do not replay this flow for every restored track when bulk listings already supply complete descriptors. |
| `apps/drivebeats-web/src/lib/webmcp-tools.ts:761-770,785-820` | `cache_only` explicitly performs no Drive or cloud requests. Keep restore separate from generic local cache hydration and `setAccount()`. |
| `apps/drivebeats-web/src/lib/google.ts:12-16,130-138,165-166` | Current auth requests and checks `drive.file`; app-data access needs a separate granted-scope check and consent path. |
| `apps/drivebeats-web/src/lib/server-auth.ts:8-10`; `apps/drivebeats-web/src/lib/cloud-library-service.ts:70-72,331-333` | Server auth parses a signed session; cloud deletion deletes the user row, while mutation paths can upsert users. A durable deletion/session fence must precede new Drive writes. |
| `apps/drivebeats-web/src/components/storage-dialog.tsx:183-191,298-327,375-400` | Delete account calls cloud deletion then logout; Cloud currently shows playlists/favorites. App-data cleanup/status needs inclusion. |
| `apps/drivebeats-web/src/lib/google-grant-service.ts:14-44` | Encrypted Google grants are persisted server-side; invalid grants are removed. Cleanup must happen before usable credentials are discarded. |
| `apps/drivebeats-web/src/stores/playlist-store.ts:101-161`; `apps/drivebeats-web/src/lib/cloud-library-service.ts:276-300` | Collection mutations include create/rename/delete and membership-sensitive reorder. Unioning tag records cannot implement these semantics. |

## Confirmed platform facts

- App data is hidden and restricted to the app. It requires the additional
  non-sensitive `drive.appdata` scope; create files with `appDataFolder` as parent.
  App-data files cannot be trashed. The folder can be removed through Drive app
  management; this is distinct from logging out or revoking an OAuth token.
  [Google app-data guide](https://developers.google.com/workspace/drive/api/guides/appdata)
- Enumerate app data with `spaces=appDataFolder`, following every `nextPageToken`.
  Listing can return partial pages. Delete the app's cache files with
  `files.delete`, which permanently deletes and supports `drive.appdata`; do not
  assume that deleting the special app-data root alias is an API operation.
  [List reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
  [Delete reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete)
- Uploads with pre-generated IDs can safely retry after uncertain results;
  successful creation followed by a retry returns `409` without duplication.
  IDs can be generated for the app-data space.
  [Upload retry guidance](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files),
  [ID generation](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- Google explicitly maps `Files.etag` to unavailable in v3. Neither current
  `files.update` nor upload documentation establishes conditional `If-Match`
  media writes. **Supported compare-and-swap was not confirmed.** Do not assume
  a version reread, final readback or browser lock prevents another device's write.
  [Migration reference](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference),
  [Update reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- Hidden app data consumes the user's Google storage; storage exhaustion blocks
  creation/uploads. Rate limits require bounded retries with backoff.
  [Storage explanation](https://support.google.com/drive/answer/17196458?hl=en),
  [Drive errors](https://developers.google.com/workspace/drive/api/guides/handle-errors),
  [API limits](https://developers.google.com/workspace/drive/api/guides/limits)
- Closing a mobile browser can skip `beforeunload`, `pagehide` and `unload`;
  terminated in-flight work can be killed. Continuous acknowledged saves are
  necessary. A visibility-change flush is best effort, not proof of remote save.
  [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

## Proposed restore and save protocol

Use immutable, uniquely identified JSON batches for tags. Persist an outbox and
stable retry IDs locally; send bounded batches continuously through authenticated
server routes. A server acknowledgment must mean Drive accepted the complete
batch, not merely that a browser queued it. Only then show its records as saved.
Already valid local cache records should enter the outbox without reanalyzing
audio. Save trustworthy completed “no target tags” outcomes too; keep transient
network, permission, browser and budget failures local unless explicitly designed
as portable outcomes.

Choose batch limits by encoded bytes, record count and a short time threshold.
Larger batches reduce requests but enlarge the unsaved tail; smaller batches
reduce interruption loss but increase file count. Batch file count depends on
record sizes and chosen count/time/byte thresholds, rather than one file per track.
No example count prescribes the batch size. Crash-before-ack leaves work
pending; it cannot honestly be guaranteed available in another browser.

After required consent and any first migration have completed, restore remote
root choices and tag batches, validate and merge, then publish roots and rebuild
the local Library catalog from bulk Drive listings.
Gate only missing-tag network extraction while restore is pending. Existing local
playback, downloaded audio, navigation and current cached tags remain usable.
On restore timeout or offline startup after the access gate, defer extraction and
expose a retry state. Missing/revoked app-folder permission returns to the required
access gate. A timeout must not silently start rereading already saved
audio. WebMCP `cache_only` remains entirely local; explicit restore is independent.

Tag merge keys include authenticated account, account generation, track ID,
content fingerprint and compatible parser/policy/schema versions. Prefer valid
completed records over incomplete outcomes; resolve equal-key duplicates
deterministically, without browser-clock last-writer assumptions. Concurrent
browsers may duplicate unsaved extraction but must retain each other's saved
records. Per-browser mutable snapshots also need coordination between tabs that
share the same producer ID; immutable batches avoid that initial failure mode.

Validate app-data input as untrusted: schema, account/generation binding, bounded
file and record sizes/counts, IDs, tag string lengths, fingerprints and supported
versions. Reject unknown future formats safely, render tags as text and never
interpret cache content as executable HTML. Corrupt files must not erase valid
local/remote records or trigger unlimited downloads. Avoid arbitrary time expiry
that makes unchanged tracks require audio analysis again.

Bound growth with measured thresholds and later safe compaction: write and verify
a merged snapshot before deleting only the exact source batches it contains.
Preserve concurrent new batches and deletion tombstones. A mutable manifest cannot
be the sole authority without server serialization. Incremental `changes.list`
is available for app data, but initial paginated listing is sufficient for the
first implementation. [Change-list reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

## Imported choices and collection migration

Persist Imported Folder and Standalone Track choices, with useful descriptors,
as explicit add/remove operations with stable IDs and account generation.
An empty clean browser means uninitialized, not “delete all remote choices.”
Hydration creates no writes. New imports during restore queue explicit adds.
Retain removals/tombstones so an old browser cannot resurrect an unimported root.
Missing or inaccessible roots remain saved but unavailable; offer reselect/retry.
Access errors are not intentional removal. Remote unimporting must not silently
purge downloaded audio or stop active playback without a defined user action.
Explain that removing an Imported Folder removes its Library selection in other
browsers too, while its Google Drive music files remain untouched.

Playlists and favorites use the same app-data transport, but need explicit
commands/revisions for removal, rename, deletion and track ordering. Move a
consistent Neon snapshot, verify the Drive representation, persist the account's
migration version, and switch its writer/read authority. Reject or route old
clients' writes. Do not maintain indefinitely writable Neon and Drive masters.
The target is portable Library content and preferences, not the removal of all
server account/security records. Listening history is optional later scope, with
its own retention and deletion decisions; the catalog/folder tree stays local.

## Account deletion and reset

All app-data mutations should pass through the server. A durable server-side
account incarnation/generation and deletion state must cover tags, roots and
collections. Check it for every mutation and bootstrap; a stale signed
session must not upsert/recreate a deleted account or upload its old outbox.
Use a new generation for a deliberately recreated account. Merely ignoring files
older than account creation hides orphans; it does not delete them.

Deletion order: record deleting/fence writers → serialize/drain in-flight writes
and reject stale sessions → list all pages and permanently delete app-created
files → verify cleanup → remove application/cloud data and credentials and
complete local logout. Snapshot listed IDs before deletion, then verify again.
Keep enough protected retry state/credentials while deletion is pending; partial
failure must remain idempotently retryable and must not report complete. A local
logout fence alone does not stop another browser or a server request already in
flight. Ordinary logout preserves remote music data.

Google revocation invalidates access; it does not establish that hidden data was
deleted. If access was already revoked, require reauthorization for cleanup or
give the manual path **Google Drive Settings → Manage apps → DriveBeats → Options
→ Delete hidden app data**. Be explicit about unresolved remote cleanup rather
than silently claiming success. Removing usable credentials first prevents the
app from completing cleanup. [OAuth lifetime/revocation](https://developers.google.com/identity/protocols/oauth2),
[OAuth web-server handling](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google manual cleanup](https://support.google.com/drive/answer/6374270?hl=en)

## Storage and privacy changes required when implemented

Keep Storage copy short: **Google Drive backup**, saved track count, pending count,
last successful save, approximate bytes and an actionable permission/full-storage/
retry state. Show actual saved/pending counts and explain that music files are
never changed. Distinguish clearing this device from deleting portable music data.
Account-delete confirmation must explicitly include hidden DriveBeats app data.
Show migration completion and the exact legacy-data cutoff while the 30-day
window is open. The consent/onboarding flow must explain that app-folder access
is required and that old playlists/favorites are permanently removed at the
cutoff unless migrated. After cutoff, explain the empty-collection outcome to
late users rather than implying that migration is still possible.
Do not expose batch IDs, compaction internals or other implementation details.

The current privacy policy at
`apps/drivebeats-web/src/app/(marketing)/privacy-policy/page.tsx:33-39,68-97,117-125,141-144`
must change alongside the feature: add `drive.appdata`, describe tags and imported
choices saved to Google, state any server transit, retain the accurate local-data
list, describe logout/deletion/pending-cleanup behavior, and distinguish app-owned
hidden writes from read-only music files. During the migration window Neon retains
legacy playlists/favorites alongside encrypted connection data; migrated accounts
use Drive. Describe the fixed 30-day retention/cutoff and loss of unmigrated
collections, then update provider/storage wording when table removal completes.
Keep README, FAQ, AGENTS sync/access rules and
GLOSSARY Library Search wording consistent with the final behavior. This review
does not itself modify policy or product copy.

Treat “except user data” as excluding profile/login/authentication records from
the move. Account-linked Library choices, playlists and tags still relate to an
identifiable person; the privacy policy must describe them even inside the user's
own Drive. [European Commission definition of personal data](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en)

## Independent review adjudication

Both Claude Code reviews completed successfully; parallel source reviews covered
restore/cache semantics and deletion/storage/privacy. Accepted: restore gate,
immutable tag batches, root removals/tombstones, additional consent, server deletion
fence/order and phased single-authority migration. Rejected or tightened:

- A short timeout followed by extraction would refetch saved tracks; defer only
  metadata work instead.
- Browser-direct writes plus timestamp-based orphan hiding do not guarantee
  account cleanup; server mutation fencing and draining are required.
- Shared `library.v1.json` merge/write/readback is not concurrency-safe without
  supported CAS or server serialization.
- Keeping all tags local contradicts this feature's requirement. Arbitrary
  180-day expiry and syncing device/budget failures cause unnecessary reanalysis.
- Root removal does not imply permission to purge offline audio automatically.

## Remaining verification gates

No runtime checks have been performed for this proposal. Verify the OAuth app's
new scope/consent and previously Picker-granted folder access in a genuinely clean
second browser; saved IDs alone do not prove access. Measure batch size/latency,
restore request counts, supported file-version identity and full-storage behavior.
Do not infer current hosted legacy-table content from migration filenames.

Implementation acceptance must cover arbitrary saved subsets across abrupt closure
with network assertions; existing-local-cache upload without audio analysis;
restore overlapping visible rows/WebMCP/background work; account switching; changed
tracks; no-tag outcomes; two browsers saving disjoint batches; duplicate retry;
corrupt/future data; imported-root add/remove and inaccessible roots; interrupted
deletion and stale/offline clients; revoked access; logout preserving remote data;
and playlist/favorite create/remove/delete/reorder and one active authority.
Also test denied/missing/revoked consent blocking UI and API/WebMCP use; one-time
migration across fresh browsers/concurrent logins/retries; exact cutoff timing;
late unmigrated login without legacy-table reads or stale-local bootstrap; and
cleanup-job retry/idempotency with account/auth tables preserved.
Run required repository test/lint/build and browser checks when
code exists. No passing implementation or deletion guarantee is claimed here.
