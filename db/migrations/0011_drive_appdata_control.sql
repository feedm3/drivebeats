-- Coordination only. Music descriptors, tags and collection bodies never enter
-- these tables. Tombstones intentionally survive deletion of the users row.
CREATE TABLE appdata_accounts (
  account_id TEXT PRIMARY KEY,
  generation UUID NOT NULL DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','deleting','deleted')),
  source TEXT NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy','migrating','drive')),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  migration_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appdata_operations (
  account_id TEXT NOT NULL REFERENCES appdata_accounts(account_id),
  generation UUID NOT NULL,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
  revision BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tags','roots','collections','migration')),
  body_hash TEXT NOT NULL CHECK (length(body_hash) = 64),
  file_id TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 16777216),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','uploading','uncertain','committed','cancelled','superseded')),
  unresolved_upload BOOLEAN NOT NULL DEFAULT FALSE,
  migration_is_empty BOOLEAN NOT NULL DEFAULT FALSE,
  saved_at TIMESTAMPTZ,
  command_hash TEXT CHECK (command_hash IS NULL OR length(command_hash)=64),
  command_result JSONB,
  file_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_operations TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (account_id,generation,operation_id),
  UNIQUE (account_id,generation,revision)
);
CREATE INDEX appdata_operations_pending ON appdata_operations(account_id,generation) WHERE status <> 'committed';

CREATE TABLE appdata_rollout (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  implemented_at TIMESTAMPTZ NOT NULL,
  cleanup_due_at TIMESTAMPTZ NOT NULL CHECK (cleanup_due_at-implemented_at=INTERVAL '720 hours'),
  legacy_retired BOOLEAN NOT NULL DEFAULT FALSE
);

-- One row lock orders every reservation with the deletion fence. A durable
-- noncommitted operation blocks subsequent writes, even after a process crash.
CREATE FUNCTION reserve_appdata_operation(
  p_account TEXT, p_generation UUID, p_operation TEXT, p_kind TEXT,
  p_hash TEXT, p_file TEXT, p_bytes INTEGER, p_base BIGINT, p_empty BOOLEAN,
  p_command_hash TEXT DEFAULT NULL,p_command_result JSONB DEFAULT NULL,p_sources TEXT[] DEFAULT '{}'
) RETURNS SETOF appdata_operations LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts; existing appdata_operations;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state<>'active' THEN
    RAISE EXCEPTION 'appdata_stale_session';
  END IF;
  SELECT * INTO existing FROM appdata_operations
    WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
  IF FOUND THEN
    IF existing.body_hash<>p_hash OR existing.kind<>p_kind THEN RAISE EXCEPTION 'appdata_operation_conflict'; END IF;
    RETURN NEXT existing; RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND status NOT IN ('committed','cancelled','superseded')) THEN
    RAISE EXCEPTION 'appdata_pending_write';
  END IF;
  IF p_kind IN ('roots','collections','migration') AND (p_base IS NULL OR p_base<>a.revision) THEN
    RAISE EXCEPTION 'appdata_revision_conflict';
  END IF;
  IF p_kind='migration' AND a.source<>'migrating' THEN RAISE EXCEPTION 'appdata_migration_not_claimed'; END IF;
  IF p_kind='migration' AND a.migration_version=-1 AND NOT p_empty THEN RAISE EXCEPTION 'appdata_reset_requires_empty'; END IF;
  IF p_kind='migration' AND NOT p_empty AND EXISTS(SELECT 1 FROM appdata_rollout WHERE singleton AND (cleanup_due_at<=now() OR legacy_retired)) THEN RAISE EXCEPTION 'appdata_legacy_cutoff'; END IF;
  IF p_kind<>'migration' AND a.source<>'drive' THEN RAISE EXCEPTION 'appdata_not_ready'; END IF;
  IF cardinality(p_sources)>10000 OR EXISTS(
    SELECT 1 FROM unnest(p_sources) s WHERE NOT EXISTS(SELECT 1 FROM appdata_operations o WHERE o.account_id=p_account AND o.generation=p_generation AND o.operation_id=s AND o.kind=p_kind AND o.status='committed' AND NOT o.unresolved_upload)
  ) THEN RAISE EXCEPTION 'appdata_revision_conflict'; END IF;
  -- Bound supported backup bytes before accepting provider writes. Replacement
  -- snapshots and proven whole-batch sources are retired in the same commit.
  IF p_bytes+1024+COALESCE((SELECT sum(bytes+1024) FROM appdata_operations
    WHERE account_id=p_account AND generation=p_generation AND status NOT IN ('superseded','cancelled')
      AND NOT (operation_id=ANY(p_sources))
      AND NOT (p_kind IN ('collections','migration') AND kind IN ('collections','migration') AND status='committed' AND NOT unresolved_upload)),0)>50331648
  THEN RAISE EXCEPTION 'appdata_backup_capacity'; END IF;
  UPDATE appdata_accounts SET revision=revision+1,updated_at=now() WHERE account_id=p_account;
  INSERT INTO appdata_operations(account_id,generation,operation_id,revision,kind,body_hash,file_id,bytes,migration_is_empty,command_hash,command_result,supersedes_operations)
    VALUES(p_account,p_generation,p_operation,a.revision+1,p_kind,p_hash,p_file,p_bytes,p_empty,p_command_hash,p_command_result,p_sources)
    RETURNING * INTO existing;
  RETURN NEXT existing;
END $$;

-- Never reopen a crashed/uncertain upload automatically: the provider may still
-- accept it. Cleanup stays incomplete until an operator resolves that request.
CREATE FUNCTION start_appdata_upload(p_account TEXT,p_generation UUID,p_operation TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state<>'active' THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  UPDATE appdata_operations SET status='uploading' WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation AND status='reserved';
  RETURN FOUND;
END $$;

CREATE FUNCTION complete_appdata_operation(p_account TEXT,p_generation UUID,p_operation TEXT,p_upload_settled BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts; op appdata_operations;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state='deleted' THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  SELECT * INTO op FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR op.status NOT IN ('uploading','uncertain','committed') THEN RAISE EXCEPTION 'appdata_pending_write'; END IF;
  IF op.kind='migration' AND op.status<>'committed' AND NOT op.migration_is_empty AND EXISTS(SELECT 1 FROM appdata_rollout WHERE singleton AND (cleanup_due_at<=now() OR legacy_retired)) THEN
    UPDATE appdata_operations SET status='cancelled' WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
    RETURN;
  END IF;
  UPDATE appdata_operations SET status='committed',saved_at=COALESCE(saved_at,now()),unresolved_upload=CASE WHEN p_upload_settled THEN FALSE ELSE unresolved_upload END WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
  UPDATE appdata_operations SET status='superseded' WHERE account_id=p_account AND generation=p_generation AND operation_id=ANY(op.supersedes_operations) AND revision<op.revision AND kind=op.kind AND status='committed' AND NOT unresolved_upload;
  IF op.kind='migration' THEN
    UPDATE appdata_accounts SET source='drive',migration_version=1,updated_at=now() WHERE account_id=p_account;
  END IF;
  IF op.kind IN ('collections','migration') THEN
    UPDATE appdata_operations SET status='superseded'
      WHERE account_id=p_account AND generation=p_generation
        AND kind IN ('collections','migration') AND revision<op.revision
        AND status='committed' AND NOT unresolved_upload;
  END IF;
END $$;

-- Run only after hidden Drive cleanup was verified. A failure anywhere rolls
-- credentials, cascading application rows and the tombstone back together.
CREATE FUNCTION finish_appdata_deletion(p_account TEXT,p_generation UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state NOT IN ('deleting','deleted') THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  IF EXISTS(SELECT 1 FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND (status IN ('uploading','uncertain') OR unresolved_upload)) THEN RAISE EXCEPTION 'appdata_cleanup_pending'; END IF;
  DELETE FROM users WHERE google_user_id=p_account;
  UPDATE appdata_accounts SET state='deleted',updated_at=now() WHERE account_id=p_account;
END $$;

CREATE FUNCTION reset_appdata_account(p_account TEXT,p_generation UUID)
RETURNS SETOF appdata_accounts LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state<>'deleting' THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  IF EXISTS(SELECT 1 FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND (status IN ('uploading','uncertain') OR unresolved_upload)) THEN RAISE EXCEPTION 'appdata_cleanup_pending'; END IF;
  RETURN QUERY UPDATE appdata_accounts SET generation=gen_random_uuid(),state='active',source='migrating',revision=0,migration_version=-1,updated_at=now() WHERE account_id=p_account RETURNING *;
END $$;

-- Old deployments cannot continue writing a second authority once migration
-- claims its consistent snapshot. These triggers share the account row lock.
CREATE FUNCTION fence_legacy_appdata_writes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; a appdata_accounts;
BEGIN
  IF TG_TABLE_NAME='playlist_tracks' THEN
    SELECT user_google_id INTO owner_id FROM playlists WHERE id=COALESCE(NEW.playlist_id,OLD.playlist_id);
  ELSE
    owner_id:=COALESCE(NEW.user_google_id,OLD.user_google_id);
  END IF;
  SELECT * INTO a FROM appdata_accounts WHERE account_id=owner_id FOR UPDATE;
  IF FOUND AND NOT (TG_OP='DELETE' AND a.state='deleting') AND (a.state<>'active' OR a.source<>'legacy') THEN RAISE EXCEPTION 'appdata_legacy_fenced'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER appdata_fence_playlists BEFORE INSERT OR UPDATE OR DELETE ON playlists FOR EACH ROW EXECUTE FUNCTION fence_legacy_appdata_writes();
CREATE TRIGGER appdata_fence_playlist_tracks BEFORE INSERT OR UPDATE OR DELETE ON playlist_tracks FOR EACH ROW EXECUTE FUNCTION fence_legacy_appdata_writes();
CREATE TRIGGER appdata_fence_favorite_tracks BEFORE INSERT OR UPDATE OR DELETE ON favorite_tracks FOR EACH ROW EXECUTE FUNCTION fence_legacy_appdata_writes();
