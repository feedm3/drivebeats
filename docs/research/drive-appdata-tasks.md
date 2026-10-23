# Drive app-data: task briefs

Read [supervisor handover](drive-appdata-handover.md) first. Its requirements apply
to every brief. Scope paths are starting points: inspect callers/tests and agree
ownership before edits. Each task includes focused behavioral verification; T10
integrates it. Use the [design review](drive-appdata-design-review.md) for evidence.

## T01 — Baseline, contracts and feasibility

Needs: implementation assignment. Owner: supervisor + read-only discovery agents.
Skills: `codebase-design`; `writing-for-agents` for guidance edits.

- Snapshot HEAD, preexisting changes and review scope. Read current package scripts,
  relevant installed Next docs, auth/token, loader/coordinator, imports, collection,
  deletion and migration-runner paths. Check existing metadata-retirement runbook
  `docs/operations/retire-cloud-track-metadata.md`; its schedule is separate.
- Define versioned envelopes, server interfaces, mutation serialization/fencing,
  migration/readiness states, cutoff source of truth and handling of migration
  already running at cutoff. Select supported durable
  coordination; browser/in-process locks and unverified Drive CAS are insufficient.
- Establish minimal account-scoped consent/restore feasibility, using authorized
  fixtures/real account only. Surface actual missing access while continuing local
  design. Narrowly amend AGENTS sync/access/testing rules for app-owned hidden data;
  retain read-only music access and original applied migrations.
- Done: accepted interfaces, ownership, meaningful failure cases and live-proof
  gaps recorded. No product behavior invented to avoid a technical check.

## T02 — Server coordination and app-data transport

Needs: T01. Skills: `codebase-design`, `neon-postgres:neon-postgres` for DB changes.
Scope: `src/db`, new app-data/control modules in `src/lib`, thin routes,
additive migrations under root `db/migrations`.

- Durable account incarnation, consent/migration/control state; stale-session
  rejection and idempotent operation IDs. Keep control data after music-table drop.
- Server-mediated app-data listing/read/create/delete, pagination, byte/schema
  bounds, retries and acknowledged writes. Write music data only to hidden app
  data; authenticate account independently of request payloads.
- Immutable batched tags; authoritative changes use T01's revision/operation
  contract. Coordinate reset/deletion with accepted/in-flight mutations across
  server instances; check-then-upload alone is insufficient.
- Done: isolation, duplicate/lost-response retry, concurrent writers, quotas,
  malformed data and mutation/deletion races exercised at real module interfaces.

## T03 — Required consent and readiness

Needs: T02. Skills: installed Next guides, React best practices, `shadcn`,
`ux-writing`, `accessibility`; `react-doctor` after React edits.
Scope: auth routes/services/store, bootstrap/guard and consent screen.

- After Google login, enforce app-folder approval for new/existing accounts and
  gate normal app/API/WebMCP use. Preserve sign-out/privacy/delete/recovery.
- Reuse valid approval; handle partial consent, denial, revocation and token
  refresh without loops. After approval enter the migration/restore readiness
  state; normal use opens only when required migration completes.
- Done: client and server checks agree; denied/revoked access cannot bypass gate;
  reconnect resumes correctly. Test mobile/tap/keyboard behavior and real OAuth.

## T04 — Metadata portability

Needs: T02. Skills: `codebase-design`; React guidance if hooks/providers change.
Scope: metadata cache DB/store, loader, coordinator, shared consumers and outbox.

- Restore account/version-compatible tags before missing-tag network reads; recheck
  cache afterward. Keep local hydration and WebMCP `cache_only` network-free.
- Upload existing local valid records without rereading audio. Persist an outbox;
  acknowledge only completed Drive saves. Time/count/byte batching is tunable and
  independent of any example track count. Portable completed/no-tag outcomes only.
- Preserve peer saves, account-switch fences, offline local use after consent
  readiness, scheduler priorities and bounded restore/compaction. A restore error
  defers extraction, not playback availability after readiness, and never silently
  triggers a duplicate scan. Explain the unacknowledged tail honestly.
- Done: variable saved subsets, interrupted batches and cross-profile restore
  produce correct tags with no redundant per-track extraction requests.

## T05 — Imported Library choices

Needs: T02. Skills: `codebase-design`; React guidance for store consumers.
Scope: imported-drive store, import/manage-folder flows, catalog bootstrap.

- Persist Imported Folder and Standalone Track choices with explicit add/remove
  operations; retain removals across stale clients. New empty browsers restore,
  not overwrite. Hydration emits no mutation; new imports during restore survive.
- Rebuild descendant catalog locally through bulk descriptors. Inaccessible roots
  stay saved/unavailable with recovery; they are not inferred removals.
- Explain synced removal scope; leave music and other devices' audio untouched.
- Done: fresh-browser restoration, simultaneous import/remove, resume of a stale
  profile and transient missing access preserve intentional choices.

## T06 — Collections and once-only migration

Needs: T02, T03. Skills: `codebase-design`, `neon-postgres:neon-postgres`;
React guidance for existing collection stores.
Scope: cloud-library services/routes/clients, playlist/favorite stores, control DB.

- Implement Drive-backed collection commands with create/rename/delete,
  membership/order, favorite removal, limits, conflict handling and durable retry.
- Claim account/version migration once, freeze/route legacy mutations, export a
  consistent Neon snapshot, preserve IDs/descriptors/order, verify Drive copy,
  then switch authority. Retry interrupted stages without duplicates or stale
  overwrite. Another browser reads completion and restores rather than imports.
- Empty/new accounts initialize. A previously migrated account never silently
  reimports deleted Drive data from Neon/local bootstrap. Keep the source window
  for eligible unmigrated accounts only; T09 defines the deadline branch.
- Done: concurrent logins, lost responses, partial export/write and every collection
  edit retain data and a single authority; gate remains closed on real failure.

## T07 — Deletion, reset and logout

Needs: T03–T06. Skills: `codebase-design`, relevant Next/auth guides.
Scope: account-delete service/route, control and mutation modules, client cleanup.

- Fence all writers and stale sessions, drain/finish accepted writes, delete every
  page of app-owned data, verify, then remove account/cloud rows and credentials.
- Idempotent/resumable partial failure; retain protected cleanup capability while
  needed. Revoked access requires reconnect/manual cleanup without false success.
  New signup gets a new incarnation; old clients cannot repopulate it.
- Ordinary logout/local download clearing preserve remote data. Explicit synced
  reset prevents a peer outbox from silently recreating removed content.
- Done: in-flight, offline/stale peer, repeated delete, account switch, timeout and
  revoked-token cases leave no orphan data after acknowledged successful deletion.

## T08 — Storage, onboarding and privacy

Needs: final behavior T03–T07; draft after T01. Skills: `ux-writing`, `shadcn`,
`accessibility`, React best practices/doctor; `writing-for-agents` for agent docs.
Scope: storage modal, consent/migration screens, privacy page/FAQ/README/GLOSSARY.

- Show saved/pending state, last save, estimated usage and actionable recovery;
  include required consent, once-only migration and exact global loss deadline.
- Distinguish device clearing, remote reset, logout and account deletion. Describe
  app-owned writes, Google/Neon/device data, server transit and window retention.
- Keep existing UI patterns; mobile 320–428px, 44px targets, tap/keyboard access.
  Avoid exposing batch IDs or technical recovery internals to ordinary users.
- Done: copy matches code and current rollout stage; privacy ships with feature;
  errors and late unmigrated empty collections have clear explanations.

## T09 — Retirement preparation

Needs: T06, T07. Skills: `neon-postgres:neon-postgres`; scheduling guidance at T12.
Scope: late-login/control/service compatibility and `docs/operations` runbook/SQL.

- Handle retired source explicitly: after cutoff, never-migrated accounts create
  empty Drive collections; migrated accounts keep their Drive data. Eliminate
  legacy-table dependencies and stale client/bootstrap resurrection paths.
- At cutoff, fence new legacy-source claims/reads. Settle already verified Drive
  copies; boundedly drain/cancel incomplete migration readers before DDL. Fence
  late callbacks and incomplete artifacts so they cannot become active collections
  afterward. Do not let an in-flight migration extend the global source window.
- Prepare exact deletion allowlist: playlists, playlist_tracks, favorite_tracks
  and retired dependent objects; preserve account/auth/control data. Reconcile
  existing track_metadata retirement rather than duplicating its separate job.
- Keep destructive SQL outside auto-applied migrations until due. Inspect runner
  and deployment behavior; at T13 allocate the next forward migration number.
- Write bounded read-only preflight and post-drop proof, rerun/idempotency path,
  target identification, permission requirements and scheduled-job prompt.
- Done: local disposable-schema tests prove no early drop, safe late login and
  preserved account data, including cutoff racing snapshot/export/verification
  and retry. Due timestamp and actual automation remain pending T12.

## T10 — Integrated verification

Needs: T03–T09. Skills: `react-doctor`; `playwright-cli` or applicable browser skill;
`diagnosing-bugs` if failures. Read the Mac launch guide before shell launches.

- Run repository-required test/lint/build from root. Inspect failures; preserve
  unrelated work and explain any preexisting baseline failures with evidence.
- In independent browser profiles, save arbitrary subsets, terminate the writer
  abruptly, restore another profile and count requests by track ID. Cover empty,
  partial, multiple-batch and representative large data, including batch/page
  edges. No fixed track count is required. Separate playback/list/cache traffic.
- Verify real consent, prior Picker access, existing-cache upload, delayed/failed
  restore, account switching, changed files/no-tag results, concurrent peer saves
  and removals, migration resume, collection sync and logout.
- Test deletion and cutoff with authorized disposable accounts/databases; record
  actual deletion proof. Simulate due time/permissions/offline job failures locally.
- Done: durable evidence for affected user flows and each requirement, without
  secrets. Mocks/HTTP success are distinct from real cross-browser/OAuth proof.

## T11 — Independent reviews and corrections

Needs: T10. Owner: supervisor; fresh read-only review subagents plus Claude Code.
Skills: `code-review`, `fabdie-claude-review`; relevant auth/DB/React/UI guidance.

- Freeze a review snapshot against T01 baseline, including scoped commits,
  staged/unstaged changes and untracked source; exclude documented unrelated work.
  The spec is this handover/task briefs plus design rationale, not an issue tracker.
- Use independent subagents for Standards and Spec review, with focused coverage
  of auth/deletion, sync/migration/concurrency and UI/privacy. Give reviewers the
  actual diff, settled requirements and test evidence; trace callers/contracts.
  Keep the Standards and Spec reports separate when recording their findings.
- Run actual Claude Code per its skill, with current human/execution authorization.
  Preserve normal configuration, provide read-only scope, retain result/stderr,
  wait for success and verify diff coverage and unchanged snapshot. Old design
  reviews and their sandbox approvals are not this implementation's review.
- Supervisor validates every finding; record accepted/rejected/unresolved with
  evidence. Fix confirmed important issues, rerun affected checks; substantial
  changes get one focused Claude follow-up under that skill. Confirm final revised
  patch is covered. A denied/incomplete Claude run stays an explicit review gap.
- Done: important findings resolved, post-fix verification current, review scope
  and remaining limitations recorded. No clean-review claim for missing coverage.

## T12 — Rollout and scheduling

Needs: T11 and applicable explicit remote-state authorization. Owner: supervisor.
Skills: applicable Vercel deployment/access skills and `openai-docs` for scheduling.

- Read `docs/vercel-access.md`; confirm DriveBeats target and OAuth scope setup.
  Prepare concrete release/migrations/privacy for review before remote approvals.
- After authorized rollout, prove serving behavior and required migration. Record
  deployed revision, global implemented_at and +30-day cutoff in Europe/Berlin.
- Use the Codex automation tool to create a follow-up in the executing supervisor
  chat for T13. Verify existing schedules first; record actual ID, due time,
  precise scope/prompt and required database permissions. Dry-run preflight only.
- Local jobs require running host/app; failures/offline delays must surface, not
  cause early execution. Notify only on completion, failure or required action.
- Done: verified production state and actual scheduled job recorded separately.
  If rollout is unapproved, deliver deploy-ready work; do not invent a start date.

## T13 — Due-date retirement

Needs: T12 and global cutoff reached. Owner: scheduled Codex supervisor.
Skills: relevant Neon/database and scheduling guidance.

- Re-read rollout record/runbook; verify exact database, elapsed deadline, deployed
  compatibility and allowlist. Remaining unmigrated users do not delay cutoff;
  unexpected live dependencies/permission failures are reported, not bypassed.
- Apply the cutoff fence and T09's bounded migration drain/cancellation protocol
  before DDL. Preserve verified Drive copies; late incomplete callbacks cannot
  recreate or promote legacy collections.
- Apply T09's prepared SQL as the next unused forward migration under
  `db/migrations` only now, within required execution permissions. Preserve
  user/auth/control records and Google app-data collections. No broad CASCADE.
- Verify intended table absence, migrated and late-user flows, and account/auth
  continuity. Record retirement durably; finish/disable this cleanup schedule
  without disturbing the separate metadata-retirement automation.
- Done: deletion and runtime proof recorded. Otherwise retain a concrete retryable
  failure state; never claim retired because the date passed or migration was queued.

Unresolved product questions: none. Actual credentials/platform feasibility and
remote/destructive permissions must be established by the responsible task.
