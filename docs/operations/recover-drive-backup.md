# Recover an interrupted Google Drive backup

Prepared operator procedure. No production override has been performed. Confirm
the DriveBeats project, database and account before every action; obtain explicit
approval before changing remote data or settling an unknown provider request.
Never export refresh tokens, access tokens, browser cookies or music metadata.

## What recovers automatically

Never-started reservations can be cancelled safely. After 90 seconds without a
live attempt, a new save can abandon an interrupted operation and use a new
immutable operation ID. This restores write availability; it does **not** prove
that the old Google request cannot finish later. Cancelled operations cannot
become active Library data.

An explicit backup reset can start an empty account generation after live writes
have stopped. Old requests remain fenced out of that generation. If an old
request is still unknown, reset reports pending cleanup. Full account deletion
checks unresolved requests across every generation and retains the account and
encrypted grant until cleanup is verified.

## Read-only preflight

Use bounded account-scoped queries against `appdata_accounts`,
`appdata_operations` and `appdata_upload_attempts`. Inspect state, generation,
operation/attempt IDs, timestamps and hashes; do not read music payloads or grant
contents. Include previous generations. Check whether the original server
request can still settle its own attempt token normally before intervening.

Distinguish these outcomes:

- Missing approval or `invalid_grant`: reconnect Google, then retry.
- Temporary provider/control outage: retry after recovery; preserve consent.
- A request with a verified, successful original completion: normal settlement
  or an audited correction can remove its uncertainty fence.
- A genuinely unknown request: provider evidence is required before settlement.
  Elapsed time, an absent file, readback of another retry, HTTP 5xx, manually
  deleting hidden app data, or revoking access alone are insufficient proof.

Google describes server-error upload outcomes as indeterminate in its
[upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
The [delete reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete)
does not establish that a delayed original POST cannot recreate an ID after its
file was deleted. Without authoritative completion evidence, keep the fence and
report account deletion as incomplete. Escalate to the provider or the operator;
do not promise a retry will necessarily finish cleanup.

## Audited settlement after proof and approval

Only an authorized operator may execute the following transaction after checking
the exact attempt's successful original completion or equivalent authoritative
provider evidence. Substitute bound parameters through the database client;
record evidence and human approval references, never credentials or payloads.
The runtime API exposes no manual settlement endpoint.

```sql
BEGIN;
SELECT attempt_id, state FROM appdata_upload_attempts
WHERE account_id = $1 AND generation = $2::uuid
  AND operation_id = $3 AND attempt_id = $4::uuid
FOR UPDATE;

INSERT INTO appdata_recovery_audit
  (account_id, generation, operation_id, attempt_id,
   proof_reference, approval_reference, approved_by)
SELECT account_id, generation, operation_id, attempt_id, $5, $6, $7
FROM appdata_upload_attempts
WHERE account_id = $1 AND generation = $2::uuid
  AND operation_id = $3 AND attempt_id = $4::uuid
  AND state <> 'settled';

SELECT settle_appdata_upload($1, $2::uuid, $3, $4::uuid, FALSE);
COMMIT;
```

Verify the matching audit row and every remaining attempt for the account.
Settlement is **not** account-deletion success: retry the ordinary deletion
service, which lists and removes all hidden app-owned files, verifies cleanup,
then atomically removes credentials and tombstones the account. A failure must
retain its recovery capability. Never directly clear `unresolved_upload`, bypass
the service, or mark an account deleted based only on this transaction.

## Retirement is separate

The [collection retirement runbook](retire-neon-collections.md) fences and cancels
unverified legacy exports at the global cutoff. Verified Drive copies survive.
An old unknown request keeps its account deletion fence, but does not extend
the legacy table retention window or block other accounts' normal saves.
