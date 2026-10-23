# Drive app-data final Claude review

Reviewed on 23 October 2026 at the user's request before closing the session.

## Scope and evidence

Claude Code 2.1.309 ran with the user's normal configuration outside the Codex
sandbox, with a read-only prompt, normal tools and no model override. Secrets,
browser profiles, remote actions and destructive account tests were excluded.
Both runs completed successfully, with no stderr or reported execution error.

The complete review covered 109 changed files from
`56259144d6a6be2d38c1c97472fa90bba77ebe36` to
`f2e6364d6b7a4b3c9b5e1af95273dc855f0ee394`, including migrations 0011–0013,
coordinator/transport/paging, auth, client caches, journals, recovery, retirement
scripts and UI. Claude verified its actual Git diff matched the saved snapshot
byte for byte. The SHA-256 of that snapshot was
`8da8c61799902d686f866a78d6d7548a3a12ca92f0f1c5d4872cc12fae9ba166`.

A single focused follow-up reviewed the seven changed correction/recovery files
and traced affected contracts. Its diff also matched its saved snapshot. During
the review, the separate search task committed `91b5ebd`; those five files were
preserved, excluded from this review and independently reviewed by that task.
The app-data corrections are unchanged by that intervening commit.

No unexplained review edits occurred. Codex implemented and independently tested
the confirmed findings. The follow-up's two additional fixes and the final timer
cleanup were validated by Codex after that bounded follow-up; no further Claude
review loop was started.

## Initial findings and dispositions

1. **Accepted: transient bootstrap failure interrupted returning playback.**
   Cached readiness now survives temporary provider/control failures and retries
   with capped exponential backoff. Consent and explicit cleanup/missing-file
   rejection still revoke readiness and pause the global audio object.
2. **Accepted: checkpoint order could override a newer Imported Folder event.**
   Restore chooses the newest original `sourceRevision` per root, independent of
   the checkpoint envelope's revision, and retains removal history for rebasing.
3. **Accepted: collection retries lacked intent order.** The journal assigns
   monotonic sequences under its storage lock. A distinct account/generation
   sender lock serializes retries and fresh sends, preventing a newer successful
   mutation from overtaking an unresolved older intent. Receipts retain their
   original operation identity; late replies cannot recreate cleared journals.
4. **Accepted: deliberate imports made before restore could disappear.** Root
   intents created in every non-ready state remain unready to send with an
   explicitly unknown causal base. A complete restore rebases them, including
   across browser restart, before they become eligible for upload. Previously
   submitted stale adds remain subordinate to later remote removals.
5. **Accepted: same-account replacement could retain an old restore session.**
   Generation replacement resets the client session and fences late old reads;
   concurrent replacement restores converge on one current flight.
6. **Partially accepted: excessive reconnect/paging work.** Active checks and
   recently verified online sessions now suppress repeated reconnect checks.
   Cross-request OAuth token caching is deferred: credential lifetime/revocation
   needs a separate design, and this review did not measure a token-exchange
   bottleneck. Requests retain their existing authenticated token exchange.

## Focused follow-up dispositions

1. **Accepted: permanent malformed/oversized backups retried silently.** They
   now stop automatic retries, mark backup error state and show a persistent
   recovery notice with a working Storage & data action while playback remains
   available. Transient failures retain backoff.
2. **Accepted: failed replacement restore could expose old choices or erase
   new-generation edits on retry.** Replacement clears/rebinds local caches
   before its remote read; the gate remains closed if that replacement restore
   fails or exceeds its UI deadline. A retry preserves new-generation intents.
3. **Documented rollout limitation:** old open bundles do not participate in the
   new sender lock or sequence protocol. Refresh them before collection edits.
   Multiple old unsequenced intents have no recoverable ordering information;
   preserve them for user-confirmed recovery rather than guessing. See the
   [recovery runbook](../operations/recover-drive-backup.md).

The follow-up found the corrected root ordering, sender/journal lock ordering,
idempotent receipts, unsent-intent rebasing and generation-flight fencing sound.
Its unconfirmed frozen-tab sender-lock availability concern remains a coverage
gap; no lock stealing or speculative protocol change was introduced.

## Verification and limits

The initial correctness regressions failed in eight cases before fixes. The two
follow-up issues failed in three more cases before their fixes. A separate
unmount regression reproduced a live deadline timer after navigation; explicit
deadline cleanup now accompanies retry and elapsed-timer cleanup. Tests also
cover no later retry after unmount and late old-generation responses.

All 946 tests across 90 files, lint/typecheck and production build passed before
the correction commit. Actual Firefox reloads reopen the Library with existing
collections; race, offline, ordering and permanent-error scenarios use isolated
automated fixtures, without introducing uncertain writes to the real account.

React Doctor's remaining `effect-needs-cleanup` diagnostic is a confirmed static
analysis false positive after the cleanup fix: the effect cleanup explicitly
clears both deadline and retry handles, and teardown tests prove zero remaining
timers and no subsequent request. No diagnostic suppression was added.

Claude skimmed the largest test/database files and marketing/research documents,
and ran no tests or browser itself. Google Drive UI integration logo settings
are outside Git and were not reverified by Claude. Live destructive account
deletion/reset remain explicitly waived by the user; this report does not claim
they work. The existing audited uncertain-upload deletion fence remains intact.
No applied migration or scheduled cleanup was changed by these corrections.

## Test cleanup and spinner follow-up

The isolated verification environment was retired on 23 October 2026 with user
approval. Its coordinator was fenced, all upload attempts settled, and the local
test session was signed out to clear its device cache before stopping the test
server. Cleanup verified every remaining test file against that environment's
journal, envelope identity and body hash, excluded all production file references,
then deleted 42 test-only hidden app-data files. A fresh listing found no remaining
test files. Production collection, root and tag backups remained readable. The
isolated Neon branch was deleted and its absence verified. Temporary review,
fixture and verification artifacts were removed; production retirement schedules
were preserved.

The metadata indicator now animates throughout the initial Library check,
including when backup restore pauses extraction. Reduced-motion preferences still
disable rotation. The obsolete test assertion requiring a static restore spinner
was removed; retry and failure behavior remain covered. All 946 tests,
lint/typecheck and production build passed. A browser fixture using the actual
component and built CSS reproduced the paused-restore state, verified changing
rotation transforms, the reduced-motion override, a 44px trigger and a 320px layout
without horizontal overflow. React Doctor reported no issues in the two changed
React files.

Completed tags already persist in account-scoped IndexedDB with parser and file
version checks. Localhost and production use separate browser origins. A local
completion flag must not bypass restore or freshness checks after account,
Library or content changes.
