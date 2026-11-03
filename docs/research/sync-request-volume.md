# Sync request volume verification

## Review correction on 3 November 2026

Independent Claude Code review identified repeated checksum inventories on
continuation pages. The first page now stores its checkpoint in the signed
cursor, and continuations reuse it while retaining envelope verification and
live account/manifest checks. Regressions require exactly one inventory for a
complete multipage restore and reject a modified checkpoint in a signed cursor.
The 31 October measurements below describe the implementation before this
correction.

The delivery checkout is based on `9e8588c`, including the current dependency
update. Concurrent metadata-progress work, older WebMCP edits and MCP retirement
files are excluded from this sync commit.

Final checks on 3 November: all 961 tests, lint and build passed in that isolated
checkout. The focused Claude follow-up reported no actionable findings. It
covered the full sync diff and confirmed that the PostgreSQL tests executed;
live Google acceptance and old-format cursor-specific regressions remain
coverage gaps.

A refreshed isolated Chrome check used the actual client modules and server
service/database functions with disposable PGlite and a synthetic Drive
transport. The first restore and collection sync downloaded 20 bodies using two
inventories and two portable pages. The unchanged repeat downloaded zero bodies
using two inventories and one portable page. Peer edits converged, a fresh
session downloaded all 20 current bodies again, and removing the synthetic
Drive files produced an error. These fixtures did not access real credentials,
production Neon, Google Drive or music files.

## Original verification on 31 October 2026

Verified locally on 31 October 2026. No deployment, production data, Neon
settings or schema changes were performed for this optimization.

Read routes reuse their already validated session. Collection-only reads avoid
the pending tag-compaction lookup and redundant account lookup. Conditional
collection and portable reads check both the committed operation manifest and a
fresh hidden Drive checksum inventory before skipping body downloads. Ordinary
collection mutations and bootstrap do not request that additional inventory.
Checkpoints do not replace the final account and authority checks.

## Automated checks

- `pnpm test`: 961 tests passed, including PostgreSQL-backed retry, concurrency,
  reset and account-deletion scenarios against disposable PGlite databases.
- `pnpm lint` and `pnpm build`: passed. Existing Biome configuration deprecation,
  broken skill symlink and oversized logo warnings remain.
- React Doctor, changed scope: no findings.

New regressions cover completed multipage restore reuse, fresh sessions,
incomplete restores, a commit at an unchanged reservation revision, final
identity rejection, peer edits, root choices staged during revalidation,
collection cache isolation and provider checksum/deletion/incomplete-listing
detection. Existing write receipts and settlement functions are unchanged.

## Isolated browser check

An isolated Chrome session exercised the actual client modules, IndexedDB,
server app-data service, transport and database functions. Dependencies were
an in-memory PGlite database and synthetic Google responses; no real Google
credentials or user files were involved. This was a flow check, not a billing
or production-latency benchmark.

| Read work | First restore and collection sync | Unchanged repeat |
| --- | ---: | ---: |
| Backup body downloads | 20 | 0 |
| Drive checksum inventory requests | 3 | 2 |
| Portable API pages | 2 | 1 |
| Collection response | Full payload | Unchanged, no body |

A simulated peer's Playlist edit and new tags appeared on the next sync.
Stopping the session and clearing local collection state forced a full restore.
Removing the synthetic hidden Drive files caused a restore error rather than
an unchanged response. The browser and fixture server were stopped afterward.

Real Google sign-in, music import, player controls, edits between two physical
devices and disposable Google-account deletion were not manually exercised.
Those live acceptance checks remain necessary after an authorized deployment;
local synthetic browser evidence does not establish production behavior. No UI
layout changed, so mobile layout requirements are unaffected.
