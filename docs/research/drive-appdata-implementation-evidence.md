# Drive app-data implementation evidence

Date: 23 October 2026. Original main checkout; baseline
`56259144d6a6be2d38c1c97472fa90bba77ebe36`. Three untracked handover/design/task
documents were preexisting; baseline copies/hashes are in ignored
`.cache/appdata-baseline`. Initial local verification preceded the authorized
production rollout recorded below.

## Implemented contracts

Required drive.file + drive.appdata approval and signed account generation gate
normal UI/APIs/WebMCP. Verified OAuth initializes the generation; bootstrap claims
and fences one consistent legacy collection snapshot, verifies its immutable
Drive copy, then switches authority once. IDs, descriptors and original ordering
are preserved. Old client bootstrap snapshots cannot resurrect deleted data.

Hidden-data transport uses durable SQL reservations, hashes, immutable provider
IDs, per-attempt tokens and exact readback. Music files remain read-only. Neon
holds account/auth/control data, not new music metadata/audio. Tags and imported
choices restore before missing extraction; cache_only stays local. Persistent
outboxes, atomic IndexedDB sealing/rebase/successors and shared Web Locks protect
collection retry journals. Modern supported browsers provide Web Locks; unsupported
browsers fail closed for collection saves instead of claiming an unsafe CAS.

Collections read only their latest verified snapshot. Full restore uses signed,
constant-size cursors, responses bounded to 2 MiB including base64/header costs,
16 candidate files per page and eight workers. Oversized individual envelopes are
fragmented; the client publishes only a complete generation. Aggregate decoded
restore is bounded to 64 MiB; acknowledged backup capacity is checked at 48 MiB
before acceptance. There is no fixed saved-track limit. Collection responses stream
bounded chunks, including snapshots larger than Vercel's buffered-response limit.
See [Vercel's official guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

Never-started and abandoned writes no longer hold normal saves indefinitely.
After 90 seconds, stale attempts can become unknown and their operations can be
cancelled without pretending provider requests settled. A reset starts an empty
generation and reports older cleanup pending when necessary. Full account deletion
checks every generation, deletes/verifies app-owned files, then atomically removes
grant/user records and tombstones the account. Truly unknown provider outcomes
retain that deletion fence until authoritative evidence and approved audited
settlement. See [operator recovery](../operations/recover-drive-backup.md).

## User-reported loading failures

Two red-to-green regressions reproduce the metadata popover failure: descriptor
revision changes discarded first observed coverage; catalog checkpoints did not
rerender the popover. Counts now publish while exact freshness remains pending,
and discovery shows the number of Library items found. Actual Firefox popover
advanced 802 → 819 → 822 → 835 of 2,913 checked.

A third regression reproduced permanent preparation: a shared 45s timer expired
after a 40s bootstrap plus 10s restore, silently skipping readiness. Bootstrap now
has a bounded 45s deadline and retry; after successful bootstrap, a restore UI
deadline opens playback while the same restore continues with extraction deferred.
Named checking/restoring phases, elapsed seconds after 10s and truthful large-
Library minute-plus guidance explain waits. Restore-paused metadata has a 44px
retry action. Initial real backup reads took about 20s and collections about 10s;
after bounded parallel/latest-only reads, private Firefox measured 351ms–5547ms
for sampled backup reads and 1876ms for collection sync. These are local-dev
observations against real Google and isolated Neon, not production measurements.

## Authorized production rollout

On 23 October 2026 the user explicitly authorized committing/pushing main, then
applying production migrations and pushing. Commit
`a0e99b151297e01d794d3b58bb633b9f9434a30c` preserves the two newer remote
dependency/formatter commits. After the rebase, all 921 tests, lint/TypeScript
and the production build passed again. GitHub validation
[39929206029](https://github.com/feedm3/drivebeats/actions/runs/39929206029)
also passed installation, lint, tests and build.

Applied frozen migrations 0011–0013, in order in one transaction, to project
`old-night-81938469`, production branch `br-rapid-mud-agwwmwmp`, database
`neondb`. Verified all five control tables, eight lifecycle/coordination functions
and three legacy write fences. Before/after counts were unchanged: 94 playlists,
991 playlist entries, 221 favorites and 322 users. No credentials were exported.
Neon reports six hours of retained history for this project.

Vercel production deployment `dpl_CuiTKP2od1nQZG4oFrRgxWk6AJ5q` is READY;
inspection of `www.drivebeats.app` resolved to that deployment and exact commit.
Actual production Firefox showed required reconnect, then Musik, Banger (16)
and Favorites (25). Production control records confirmed one committed,
readback-verified migration and zero unresolved uploads. A reload restored the
Library without another consent prompt. Playback position advanced from 0.3 to
12.6 seconds and returned to paused state.

The user reported that production metadata progress began around 412 despite
greater localhost coverage. Read-only comparison confirmed the same account has
different backup generations in the isolated test and production databases.
Both had committed tag batches and zero pending operations at the comparison;
production restores its own generation's registered operation manifest, not the
test generation. Localhost work was retained, but was not promoted into
production. This environment transition is distinct from multiple production
devices restoring the same generation.

Automatic approval review initially rejected starting the immutable cleanup
cutoff because it was outside the explicit migration/push approval. The user
subsequently explicitly approved starting the window and scheduling cleanup.
The production singleton now records `implemented_at=2026-10-23T09:18:44.025Z`
and `cleanup_due_at=2026-11-22T09:18:44.025Z`, exactly 720 hours later. These are
23 October at 11:18:44.025 CEST and 22 November at 10:18:44.025 CET in
Europe/Berlin. Creation uses conflict-do-nothing so retries do not move the dates.

Created and read back active chat automation
`retire-legacy-drivebeats-collections` in executing chat
`01a16777-7c35-7a52-8782-e04a092cd4dc`, returning after 720 hours. Its durable
prompt records the exact target, verified serving revision `a0d852c`, start and
cutoff, bounded preflight and allowlist, preservation requirements, permission
gates, offline handling and notifications only for completion/failure/action.
It deletes itself only after verified completion and switches to hourly retries
after a failed due-date attempt. The separate 29 October `track_metadata`
retirement automation is unchanged.

Dry-run preflight confirmed the deadline is future and `legacy_retired=false`;
all three legacy tables remain, with 94 playlists, 991 playlist entries and 221
favorites at the preflight. No retirement SQL ran. The deployed Storage modal
addition in `a0d852c` was verified live and passed all 921 local tests, lint/build
and React Doctor; it links to Google Drive settings with accurate hidden-data
guidance. Current production alias resolved to that revision before starting
the window.

## Authorized isolated database

User approved an isolated test branch/database. Neon initially returned no projects
for unscoped listing; the Vercel-managed organization exposed DriveBeats project
`old-night-81938469`. Created `drive-appdata-verification-20261023`, branch
`br-broad-dust-agjjin8c`, from parent `br-rapid-mud-agwwmwmp`; endpoint
`ep-wild-bar-agwxh13u.c-2.eu-central-1.aws.neon.tech`.

During local verification, applied 0011, 0012 and 0013 only to that isolated branch.
The later authorized production application is recorded above. Existing credentials
are reused against its hostname in a child dev process; env files were not changed or
new passwords exported. Applied frozen hashes:

- 0012: `e5a6f4a58eb380667afbaed2e993857a76651d7ace2d292758169cb5c4717db1`
- 0013: `ac3c92f7ec06f1f300e65d7c0ffd6aaab39aba50a51162e793f206bddc379de1`

The requested 300s suspend setting was rejected HTTP412 before creation. The branch
uses the account-enforced suspend_timeout_seconds=0 and requires authorized
cleanup after review; keep this cost/state explicit. Before the later production
rollout, read-only checks found no appdata control table and unchanged
94 playlists / 221 favorites.

## Verification

Latest complete root run after the final feature changes: 921 tests across 90
files passed after temporary counters were removed. Final root `pnpm lint`
(including TypeScript) and `pnpm build` also passed. Existing warnings are a broken Claude skill symlink,
2.6 MiB public logo beyond Biome's 1 MiB scan bound, and deprecated Biome configuration.
These were not changed for this feature.

Focused proof includes 40 real PGlite/transport cases and 122 portable-owned tests:
SQL races/cutoff/reset/deletion across generations; rollback of credential removal;
provider 503 indeterminate outcome; abandoned writer without original client;
variable 3/67/129 subsets and 64/64/9 local batching; real IndexedDB two-tab sealing,
root reimport vs peer removal; long cancelled command chains; strict public body
bounds; missing/revoked grant 403 vs transient 503. A 1,717-record Unicode backup
larger than 4.5 MiB restores across bounded pages with zero loader descriptor/audio
reads; held last page publishes no partial tags. A 10,000-favorite Unicode snapshot
larger than 4.5 MiB streams and roundtrips without boundary corruption.

Real Firefox, existing normal profile and independently signed-in private session:

- Google consent approved by the human; once-only migration verified against real
  Drive and isolated control schema. Existing Banger (16 tracks) and Favorites (25 tracks) restored.
- Imported Folder Musik restored; catalog rebuilt locally. Private history began at 0.
- Played a Favorite: duration 3:54 loaded, position advanced 0:03→0:06, Play/Pause
  states observed. No claim of sustained playback beyond this check.
- Created empty DriveBeats verification 2026-10-23 playlist in private Firefox;
  it appeared in normal Firefox. Human explicitly approved its permanent cleanup;
  deleted only that fixture, and deletion appeared back in private Firefox.
- Private logout showed pending-save loss warning, cleared local state, and
  returned to sign-in. Re-sign-in restored cloud collections and Library choices.
  Normal Firefox stayed signed in. No cookies/tokens/profiles were copied.
- Native responsive mode inspected 320px and 428px; Library/player/Storage controls
  remained reachable, with touch targets implemented at 44px. Desktop also checked.
- Final clean private session restored 1,490 saved tracks. Temporary browser-only
  counters measured zero Range, descriptor and audio reads for those track IDs;
  30 other missing tracks did issue Range reads. Counters were removed from both
  source and browser memory afterward.

User waiver, 23 October 2026: skip manual disposable Google-account deletion/reset
tests because the effort is too high. These checks are unverified, not passed,
and no longer block rollout. Automated SQL/provider fixture coverage remains.

Remaining runtime coverage limits: actual
cross-account switching, abrupt process termination across multiple representative
saved subsets, and production cross-session/concurrency acceptance beyond the
production smoke checks above. Real user account/reset was never
used destructively. Local engine/provider fixtures and successful HTTP/builds
are separate from those unperformed real-account checks.

## Review dispositions

Fresh independent Standards and Spec reviews found and corrected per-table DB
organization, pending command body stability, accumulated restore limits, atomic
account finalization, cross-tab sealing/rebase, durable overflow intent, offline
readiness and honest Storage error/pending labels. Final Standards review found
no actionable documented-standard findings. Final independent Spec recheck
covered 0013, paginated transfer, streaming, auth errors, timeout playback release
and journal locking; no new actionable code finding. Its runbook wording finding
was corrected for 0011–0013 and cutoff cancellation.

Actual Claude Code review and its single focused follow-up completed successfully
with normal configuration, after direct human authorization. Artifacts:
`/tmp/drivebeats-appdata-claude-review` and
`/tmp/drivebeats-appdata-claude-followup`. Both inspected Git diff/status and relevant
untracked implementation and reported coverage gaps. All important confirmed
findings were corrected: uncertain upload recovery, abandoned reservations,
recoverable reset/deletion gate, read latency, root causality, definitive domain
errors, collection contention/receipts, compaction reuse, transient auth failures,
migration ordering, logout tail warning and reachable Standalone Track removal.
Follow-up issues drove 0013, audited manual recovery, correct 5xx uncertainty,
pagination/streaming, revoked-grant recovery and playback during slow restore.

Rejected preference finding: multi-table aggregate migration SQL and SQL function
calls in lib services violate per-table query guidance. Repository guidance
explicitly locates multi-table workflows in lib services; the fresh Standards
review confirmed this boundary. True table-specific queries reside in db modules.

Coverage limit: 0013, final paging/streaming/manual-audit changes and final journal
locking landed after Claude's inspected snapshot. They received independent Spec
review and supervisor tests, not a third Claude review; the Claude skill ends
after one focused follow-up. Do not describe this as a clean final Claude review.
Truly unknown provider acceptance remains a conditional manual recovery gate,
never an automatic time-based deletion override.

## Rollout gates

No production migration/deployment, implemented_at/cutoff or 30-day automation.
T12 remains prepared pending production authorization and remaining runtime
acceptance; T13 is deferred until its established due time. The separate 29 October
track_metadata retirement is unchanged. Test branch/dev server remain available
for review and need an explicit cleanup decision later.
