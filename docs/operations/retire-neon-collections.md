# Retire legacy Neon collections after verified rollout

## Executed early on 31 October 2026

The user explicitly requested immediate execution instead of waiting for
22 November. Migration `0014_retire_legacy_collections.sql` committed against
the verified production database. Read-only verification afterward
confirmed `playlists`, `playlist_tracks` and `favorite_tracks` are absent,
along with the three allowlisted retired trigger functions. No CASCADE was used.

`legacy_retired` is true; the original rollout start and cutoff remain unchanged.
The early migration checks the exact original rollout row instead of the
scheduled procedure's due-date guard. Users without a verified Drive migration
can no longer recover collections from the retired source through normal login.

Read-only verification confirmed preservation of account/authentication, MCP and
app-data control/audit records. Upload coordination and dependency checks passed.
No Google Drive files were changed by this database operation.

The serving application source was checked: its bootstrap checks
`legacy_retired` before querying legacy collections.
Older deployments remain in Vercel's history and must not be used for rollback
unless their compatibility with the retired schema is established.

The transaction was rehearsed on an isolated database branch,
including rejection of nonempty legacy migrations and successful empty
initialization after retirement. The rehearsal branch was deleted afterward.
An expiring recovery snapshot was created before production execution;
recovery identifiers, expiry and history coverage are recorded in ignored local
operational evidence. Recovery should use
an isolated restore and an explicitly approved correction, not an unreviewed
whole-database rollback that could overwrite subsequent saves.

The user confirmed Playlists and Favorites loaded after refreshing both before
and after execution. The Codex automation tool confirmed deletion of
`retire-legacy-drivebeats-collections` after that post-retirement check.
Agent browser verification was unavailable because local browser access was
disabled; the production UI check was performed by the user. Fresh sign-in,
cross-device edits and a real late-user bootstrap were not manually exercised;
the late-user control flow was checked on the isolated branch.
`pnpm test` (954 tests), `pnpm lint` and
`pnpm build` passed; lint reported existing configuration, symlink and asset-size
warnings. The migration-window test fixture excludes the one-time production
retirement so its historical pre-cutoff scenarios retain their legacy schema.

## Original scheduled procedure (historical)

Original rollout status: production migrations 0011–0013 and release `a0e99b1` deployed and smoke
verified on 23 October 2026. The user subsequently approved starting the 30-day
window and scheduling cleanup. Latest verified serving revision is `a0d852c`.
This was separate from the track_metadata retirement, completed manually on
31 October; see its [record](retire-cloud-track-metadata.md). See
[production evidence](../research/drive-appdata-implementation-evidence.md#authorized-production-rollout).

## Recorded production window

- Target: Neon project `old-night-81938469`, production branch
  `br-rapid-mud-agwwmwmp`, database `neondb`.
- Immutable start: `2026-10-23T09:18:44.025Z` — 23 October 2026,
  11:18:44.025 Europe/Berlin (CEST).
- Immutable cutoff: `2026-11-22T09:18:44.025Z` — 22 November 2026,
  10:18:44.025 Europe/Berlin (CET), exactly 720 hours after the start.
- Active chat follow-up: `retire-legacy-drivebeats-collections`, returning to
  this executing chat after 720 hours. The database cutoff, not scheduler timing,
  controls eligibility. A failed due-date attempt changes its own cadence to
  hourly for bounded retries; unchanged non-actionable states stay quiet.
- Preflight dry run: target and serving revision confirmed; one verified
  migration, zero unresolved uploads, cutoff still in the future and all three
  legacy tables retained. No retirement SQL has run; `legacy_retired` is false.

The saved automation prompt carries these exact instants and target, requires
the due-date preflight below and available execution authorization, preserves
account/auth/control/audit and Drive data, and deletes only its own schedule
after verified completion. Local execution requires the host and desktop app
to be running. An offline delay never changes the cutoff.

## Release gates

Apply additive migrations `0011_drive_appdata_control.sql`,
`0012_appdata_upload_recovery.sql` and `0013_appdata_abandonment_reset.sql`,
in that order, only to an authorized
DriveBeats database target after disposable Postgres validation. No migration
runner exists in this repository; Next build/dev do not apply SQL. Coordinate
schema and application rollout: legacy tables remain present for the window.
Validate required app-folder consent, existing selected music access, one-time
Neon export, Drive readback, cross-browser restoration, playback, concurrent
changes and disposable-account deletion before publishing. Older servers must
be removed from production/preview/rollback use against the shared database;
legacy-write triggers prevent a second authority after migration begins.

Record the serving revision and real verification. Insert one singleton
`appdata_rollout` row with the verified `implemented_at` and `cleanup_due_at =
implemented_at + interval '720 hours'` after authorization. Preserve the immutable
start and deadline on retries. Display the exact instant in Europe/Berlin.
Never infer a rollout date from a local commit or build. Confirm backups/PITR and
required database permissions without exporting credentials.

## Bounded preflight at the due instant

1. Reconfirm the exact DriveBeats database/branch and serving/rollback revisions.
   Use configured read-only access, never put connection strings into evidence.
2. Read `SELECT implemented_at,cleanup_due_at,legacy_retired,now() FROM
   appdata_rollout WHERE singleton`. A missing row or future deadline stops work.
3. Count migration operations by status and `unresolved_upload`; inspect bounded
   operation IDs only when resolving a pending migration. Allow at most 30s for
   already executing callbacks to settle; do not extend the source window.
   Reservation and completion both check database time. Nonempty late callbacks
   cancel; new/late logins initialize empty collections without legacy reads.
4. An unknown provider POST is an account-deletion blocker, not an expired lock.
   Reconcile an existing exact immutable file before acknowledging it; do not
   clear `unresolved_upload` merely because time passed. Current implementation
   intentionally leaves truly ambiguous provider acceptance unresolved. Resolve
   using the [audited recovery procedure](recover-drive-backup.md), provider
   evidence and explicit execution permission; do not claim drain. This fence
   does not extend legacy retention: the due transaction cancels unverified
   exports so a late callback cannot publish them. Verified copies survive even
   when an old attempt's uncertainty remains recorded.
5. Verify no remaining server dependencies on the three collection tables. Check
   views/dependencies in pg_catalog and external deployment inventory. Unexpected
   dependencies stop the drop; never add CASCADE.

## Due-date execution

Only at T13, allocate the next unused forward migration number and copy
[prepared SQL](drop-neon-collections.sql) into it. Do not renumber existing
migrations. SQL checks the deadline in the transaction, marks the source retired,
cancels unverified reserved/uploading/uncertain exports while retaining their
account-deletion fences,
and drops exactly `playlist_tracks`, `playlists`, `favorite_tracks` plus their
retired trigger functions. A 5s lock timeout bounds waiting for readers; a 30s
statement timeout bounds execution. Failure rolls back the entire operation.

Preserve `users`, `google_oauth_grants`, all `mcp_*` account/auth tables,
`appdata_accounts`, `appdata_operations`, `appdata_rollout`,
`appdata_upload_attempts`, `appdata_recovery_audit`, and all hidden Google
app data. `track_metadata` belongs to its separate retirement. This operation
never deletes a Google music file or removes account credentials.

After commit, verify `to_regclass` returns NULL for each intended table and all
preserved tables still exist. Verify a previously migrated login reads its saved
Drive collections, a late unmigrated login initializes empty collections with an
accurate loss notice, and auth/account continuity works. Confirm no legacy reads
in serving logs. Reruns tolerate missing dropped objects; retain rollout/control
records. Never roll back to a server requiring removed tables.

## Schedule at T12 only

Use the Codex automation tool in this executing chat after rollout verification.
Check existing automations first; preserve the separate metadata-retirement job.
Record actual automation ID, target revision/database, start and due instant.
The saved prompt must say: wait until the exact cutoff; re-read this runbook and
rollout row; execute bounded preflight; apply only the explicit allowlist within
available permissions; preserve users/auth/control/Drive data; report completion,
failure or required action; stay quiet while unchanged; delete its own schedule
only after verified completion. If the host/app is offline, resume preflight at
next execution without moving the cutoff or claiming on-time completion.

Missing remote/destructive execution authorization remains a gate at execution,
even after a schedule exists. No automation is created during local development.
