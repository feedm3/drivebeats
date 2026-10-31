-- User-authorized early retirement on 31 October 2026; original rollout dates remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtext('drivebeats-appdata-retirement'));
DO $$
BEGIN
  -- Early retirement explicitly requested by the user on 31 October 2026.
  -- Preserve the original rollout start and deadline as historical records.
  IF current_database()<>'neondb' OR NOT EXISTS(
    SELECT 1 FROM appdata_rollout
    WHERE singleton
      AND implemented_at=TIMESTAMPTZ '2026-10-23T09:18:44.02591Z'
      AND cleanup_due_at=TIMESTAMPTZ '2026-11-22T09:18:44.02591Z'
  ) THEN
    RAISE EXCEPTION 'Unexpected DriveBeats rollout or database; early retirement refused';
  END IF;
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
