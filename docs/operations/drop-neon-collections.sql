-- PREPARED ONLY. Allocate the next forward migration number at T13, never now.
-- Execute only after target, rollout, server compatibility and permissions proof.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtext('drivebeats-appdata-retirement'));
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM appdata_rollout WHERE singleton AND cleanup_due_at<=now()) THEN
    RAISE EXCEPTION 'DriveBeats 30-day rollout cutoff has not been established or reached';
  END IF;
  -- Serialize cancellation with server start/complete, using their account lock
  -- order. Verified copies remain authoritative even if a deletion-only fence
  -- survives; an unverified late callback may never publish retired music data.
  PERFORM 1 FROM appdata_accounts a WHERE EXISTS(
    SELECT 1 FROM appdata_operations o WHERE o.account_id=a.account_id AND o.kind='migration'
      AND o.status IN ('reserved','uploading','uncertain') AND NOT o.migration_is_empty
  ) ORDER BY a.account_id FOR UPDATE;
END $$;
UPDATE appdata_rollout SET legacy_retired=TRUE WHERE singleton;
UPDATE appdata_upload_attempts t SET state='unknown'
WHERE t.state='active' AND EXISTS(SELECT 1 FROM appdata_operations o
  WHERE o.account_id=t.account_id AND o.generation=t.generation AND o.operation_id=t.operation_id
    AND o.kind='migration' AND o.status IN ('reserved','uploading','uncertain') AND NOT o.migration_is_empty);
UPDATE appdata_operations o SET status='cancelled',unresolved_upload=(o.unresolved_upload OR EXISTS(
  SELECT 1 FROM appdata_upload_attempts t WHERE t.account_id=o.account_id AND t.generation=o.generation
    AND t.operation_id=o.operation_id AND t.state<>'settled'))
WHERE o.kind='migration' AND o.status IN ('reserved','uploading','uncertain') AND NOT o.migration_is_empty;
DROP TABLE IF EXISTS playlist_tracks;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS favorite_tracks;
DROP FUNCTION IF EXISTS fence_legacy_appdata_writes();
DROP FUNCTION IF EXISTS enforce_playlists_per_user_limit();
DROP FUNCTION IF EXISTS enforce_playlist_tracks_limit();
COMMIT;
