# Drive app-data: supervisor handover

Status: implementation and review corrections complete locally on 23 October 2026;
manual Google-account deletion/reset tests were waived by the user on 23 October
2026 due to effort. Production rollout still requires authorization.
Current evidence: [implementation record](drive-appdata-implementation-evidence.md).
The following opening description is historical; the implementation assignment
explicitly supersedes the former documents-only scope.
This request prepares documents only. Begin implementation when the user assigns
this handover to the executing supervisor. No production change or schedule now.

## Start here

1. Read `/Users/fabdie/IdeaProjects/private/AGENTS.md`, repository `AGENTS.md`,
   `GLOSSARY.md`, this file, then [task briefs](drive-appdata-tasks.md).
2. Read the [design review](drive-appdata-design-review.md) for protocol rationale,
   source pointers and primary evidence. This handover controls execution; settled
   requirements below supersede older examples and optional-migration proposals.
3. Rebaseline HEAD, branch, staged/unstaged/untracked files and current runtime.
   Preserve existing work. Source line numbers and earlier Claude results are
   historical evidence, not verification of the new implementation.
4. Run as supervisor: delegate scoped tasks to subagents, integrate their results,
   maintain the table below and own final verification/review adjudication.

## Settled requirements

- After login, required Google `drive.appdata` consent gates normal UI, playback,
  APIs and WebMCP. Keep grant/retry, sign-out, privacy and account recovery/delete
  reachable. Reuse existing valid consent; no optional/local-only bypass.
- After consent, migrate Neon playlists/favorites once per account/version. Verify
  Drive copy before switching authority; retries/concurrent logins are idempotent.
- Persist tags and imported folder/Standalone Track choices in hidden app data.
  Restore before missing-tag network work. Existing local tags upload without
  reanalysis. Preserve version/account isolation and the local-only `cache_only`
  contract. Music files remain read-only; audio never enters app data or Neon.
- Any remotely acknowledged, unchanged saved subset must survive abrupt browser
  closure and restore in a clean browser without per-track audio/Range reads or
  descriptor GETs when bulk listings provide complete descriptors. Counts and
  batch sizes are variable; **100 was only an example**, never a product limit.
  Bulk listing/cache-file traffic and deliberate playback are separate.
- Preserve concurrent saves and intentional removals. Root choices, playlists,
  favorites and ordering need revision/operation semantics, not snapshot union.
- Delete account: fence/drain writers, delete all app-owned hidden data, verify,
  then remove account credentials/data. Stale clients cannot republish. Logout
  preserves remote data; failures/revoked access report incomplete cleanup.
- Ship accurate Storage, consent, privacy/FAQ and repository guidance. Account/auth
  and durable coordination stay server-side; audio/download state, active player,
  history and derived catalog stay device-local. Theme/other preference sync is
  deferred; it is not required scope for this delivery.
- At verified production rollout, record one global `implemented_at` and cutoff
  30 days later; schedule Codex cleanup then. Remove obsolete Neon music tables
  even if some users never migrated. Late users recreate playlists/favorites;
  account/auth/control tables survive. No indefinite dual writable authorities.

## Supervisor protocol

- Accept T01's contracts before parallel implementation. Use available subagent
  capacity; one owner per file at a time. Integrate shared auth/bootstrap/service
  changes serially. Reviews use independent agents, preferably not their authors.
- Every dispatch includes task ID/brief, settled requirements, dependencies,
  startup guides, exact file ownership, accepted interfaces, validation expectations and relevant
  skill names. Require reading the actual `SKILL.md` files before applicable work;
  a skill name in a report alone is not evidence of applying it.
- Discover skills from the executing session/project. Choose relevant guidance:
  `codebase-design` for contracts; `neon-postgres:neon-postgres` for DB work;
  installed Next.js guides and `vercel-react-best-practices` for React/Next;
  `shadcn`, `ux-writing`, `accessibility` for existing UI; `react-doctor` after
  React changes; `writing-for-agents` for agent docs; `diagnosing-bugs` for failures;
  `code-review` and `fabdie-claude-review` for final review. Read only relevant
  guides. If a required skill is unavailable, record the gap and resolve it.
- Subagents return: files changed, skills/guides applied, contract changes,
  focused checks/evidence, assumptions and blockers. Supervisor inspects actual
  diffs and reconciles claims before marking done; meaningful tests over tautologies.
- Continue independent work while a dependency is blocked. Resolve technical
  choices from evidence; ask only for missing product intent or required access.
- Honor current remote/destructive approval boundaries. The user accepted the
  30-day loss policy; that does not bypass execution permissions. Read Vercel
  access guidance before platform work and the Mac browser-launch guide before
  shell browser launches. Never print/export credentials without authorization.
- Record progress/evidence in this document, including changed decisions and
  review dispositions. Preserve durable summaries when raw evidence is temporary.

## Tasks and dependencies

All tasks initially pending; T13 is deliberately deferred until its due time.

| ID | Task | Needs | Status / evidence |
| --- | --- | --- | --- |
| T01 | Baseline, contracts, feasibility, policy exception | — | Done; baseline 5625914, accepted immutable/revision contracts, narrow hidden-data exception |
| T02 | Server coordination and hidden-data transport | T01 | Implemented; 0011–0013 isolated, 40 SQL/transport tests; real Drive saves/restores |
| T03 | Mandatory consent and readiness gate | T02 | Verified real OAuth; phase/elapsed/retry/slow-restore behavior tested |
| T04 | Portable metadata restore/checkpoint | T02 | Verified 1,490 saved tracks with zero per-track reads in clean Firefox; variable subsets/large pages tested |
| T05 | Imported choices and removal sync | T02 | Real clean-session Musik restore; removal/reimport/peer cases covered by durable client tests |
| T06 | Collections and one-time migration | T02, T03 | Real once-only migration and cross-session test-playlist create/delete; fixtures cleaned with approval |
| T07 | Account deletion, reset and logout lifecycle | T03–T06 | Implemented; SQL/provider fixture lifecycle tests and real logout pass; manual Google-account deletion/reset waived by user, unverified |
| T08 | Storage, onboarding and privacy copy | T03–T07 | Implemented; 46 focused UI tests; 320px/428px browser checks; loading reports fixed |
| T09 | Cutoff-safe retirement preparation | T06, T07 | Prepared SQL/runbook; local engine pre/post cutoff tests pass |
| T10 | Integration and end-to-end verification | T03–T09 | 921 tests, lint/build pass; real two-session evidence; manual deletion/reset waived; other runtime coverage limits recorded |
| T11 | Independent subagent + Claude Code reviews, fixes | T10 | Two Claude runs successful; confirmed fixes tested and independently rechecked; final Claude coverage limits explicit |
| T12 | Authorized rollout and Codex cleanup scheduling | T11 | a0e99b1 deployed; production 0011–0013, verified migration/reload/playback and CI pass; explicit cutoff approval and cleanup schedule pending |
| T13 | Due-date table retirement and verification | T12 + 30 days | Deferred |

T03/T04/T05 may run in parallel with disjoint ownership. T06 may overlap cache/root
work after its contracts stabilize. T08 copy can draft early but must match final
behavior. The user explicitly waived manual Google-account deletion/reset tests;
they are no longer a rollout gate and must not be reported as passed. Other
verification and production authorization requirements remain in place.
If T10 lacks real-account access, run independent source reviews while waiting;
retain the incomplete runtime gate rather than treating static review as its proof.

Dispatch template: “Implement Txx from `drive-appdata-tasks.md`. Read the private
workspace and repository AGENTS, GLOSSARY, handover requirements and applicable
SKILL.md files. You own [paths]; coordinate other files with supervisor. Use
[accepted interfaces], preserve preexisting work, verify [scenarios]. Return actual
diff scope, skills applied, checks/evidence and unresolved gaps. No remote actions
beyond the executing chat's authorization.”

## Completion and resume

Implementation-ready: T01–T11 done, required tests/lint/build and actual affected
browser flows evidenced, every important review finding resolved or reported.
If credentials prevent real proof, mark T10/T11 partial; a green build is not proof.
Deployment-ready and production-verified are separate states. After authorized
rollout, T12 records deployed revision, verification, timestamp, cutoff and actual
automation ID. T13 stays pending until real table removal is verified.

Resume from this table and actual code, not assumptions about prior agents. Final
report: behavior, files, checks, review outcomes, remote status, pending gates.

Unresolved product questions: none. Technical proof, rollout authorization and
future cleanup execution remain task-specific gates.

## Fresh supervisor prompt

> Act as supervisor for `docs/research/drive-appdata-handover.md`. Read its startup
> guidance and task briefs, rebaseline the working tree, then implement T01–T11
> with scoped subagents using appropriate skills. Keep progress/evidence current.
> Finish with independent subagent reviews and an actual Claude Code review;
> adjudicate findings, fix confirmed issues and verify. Preserve unrelated work.
> Prepare T12/T13; perform remote rollout or destructive actions only within the
> applicable user authorization and execution permissions. Saved metadata counts
> are arbitrary, not fixed at 100. Report remaining gates honestly.
