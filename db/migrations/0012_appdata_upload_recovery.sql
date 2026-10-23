-- Forward recovery fix. Attempt tokens distinguish a live request from a
-- retry; a lease only permits an immutable retry, never proves cleanup safety.
CREATE TABLE appdata_upload_attempts (
  account_id TEXT NOT NULL,
  generation UUID NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL CHECK(state IN ('active','settled','unknown')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(account_id,generation,operation_id) REFERENCES appdata_operations(account_id,generation,operation_id)
);
CREATE INDEX appdata_upload_attempts_operation ON appdata_upload_attempts(account_id,generation,operation_id);
-- Existing uncertain requests have no provable completion token. Preserve their
-- fence; reconnect/readback alone cannot establish absence of a late POST.
INSERT INTO appdata_upload_attempts(account_id,generation,operation_id,state)
SELECT account_id,generation,operation_id,'unknown' FROM appdata_operations
WHERE status IN ('uploading','uncertain') OR unresolved_upload;

CREATE FUNCTION begin_appdata_upload(p_account TEXT,p_generation UUID,p_operation TEXT,p_recover BOOLEAN DEFAULT FALSE)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts; op appdata_operations; token UUID;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state<>'active' THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  SELECT * INTO op FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.status='reserved' THEN NULL;
  ELSIF p_recover AND op.status='uncertain' THEN NULL;
  ELSIF p_recover AND op.status='uploading' AND NOT EXISTS(SELECT 1 FROM appdata_upload_attempts WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation AND state='active' AND started_at>now()-interval '90 seconds') THEN
    UPDATE appdata_upload_attempts SET state='unknown' WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation AND state='active';
  ELSE RETURN NULL;
  END IF;
  INSERT INTO appdata_upload_attempts(account_id,generation,operation_id,state) VALUES(p_account,p_generation,p_operation,'active') RETURNING attempt_id INTO token;
  UPDATE appdata_operations SET status='uploading',unresolved_upload=TRUE WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
  RETURN token;
END $$;

CREATE FUNCTION settle_appdata_upload(p_account TEXT,p_generation UUID,p_operation TEXT,p_attempt UUID,p_unknown BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM appdata_accounts WHERE account_id=p_account AND generation=p_generation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  UPDATE appdata_upload_attempts SET state=CASE WHEN p_unknown THEN 'unknown' ELSE 'settled' END
    WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation AND attempt_id=p_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'appdata_attempt_missing'; END IF;
  UPDATE appdata_operations o SET unresolved_upload=EXISTS(SELECT 1 FROM appdata_upload_attempts t WHERE t.account_id=p_account AND t.generation=p_generation AND t.operation_id=p_operation AND t.state<>'settled'),
    status=CASE WHEN p_unknown AND o.status='uploading' THEN 'uncertain' ELSE o.status END
    WHERE o.account_id=p_account AND o.generation=p_generation AND o.operation_id=p_operation;
END $$;

CREATE OR REPLACE FUNCTION reserve_appdata_operation(
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
  IF EXISTS(SELECT 1 FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND (status IN ('uploading','uncertain') OR (status='reserved' AND unresolved_upload))) THEN
    RAISE EXCEPTION 'appdata_pending_write';
  END IF;
  IF p_kind IN ('roots','collections','migration') AND (p_base IS NULL OR (p_base<>a.revision AND NOT (p_base=a.revision-1 AND EXISTS(SELECT 1 FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND revision=a.revision AND status='reserved' AND NOT unresolved_upload)))) THEN
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
      AND NOT (status='reserved' AND NOT unresolved_upload)
      AND NOT (p_kind IN ('collections','migration') AND kind IN ('collections','migration') AND status='committed' AND NOT unresolved_upload)),0)>50331648
  THEN RAISE EXCEPTION 'appdata_backup_capacity'; END IF;
  UPDATE appdata_operations SET status='cancelled' WHERE account_id=p_account AND generation=p_generation AND status='reserved' AND NOT unresolved_upload;
  UPDATE appdata_accounts SET revision=revision+1,updated_at=now() WHERE account_id=p_account;
  INSERT INTO appdata_operations(account_id,generation,operation_id,revision,kind,body_hash,file_id,bytes,migration_is_empty,command_hash,command_result,supersedes_operations)
    VALUES(p_account,p_generation,p_operation,a.revision+1,p_kind,p_hash,p_file,p_bytes,p_empty,p_command_hash,p_command_result,p_sources)
    RETURNING * INTO existing;
  RETURN NEXT existing;
END $$;


CREATE OR REPLACE FUNCTION complete_appdata_operation(p_account TEXT,p_generation UUID,p_operation TEXT,p_upload_settled BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE a appdata_accounts; op appdata_operations;
BEGIN
  SELECT * INTO a FROM appdata_accounts WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR a.generation<>p_generation OR a.state='deleted' THEN RAISE EXCEPTION 'appdata_stale_session'; END IF;
  SELECT * INTO op FROM appdata_operations WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR op.status NOT IN ('uploading','uncertain','committed','superseded') THEN RAISE EXCEPTION 'appdata_pending_write'; END IF;
  IF op.kind='migration' AND op.status<>'committed' AND NOT op.migration_is_empty AND EXISTS(SELECT 1 FROM appdata_rollout WHERE singleton AND (cleanup_due_at<=now() OR legacy_retired)) THEN
    UPDATE appdata_operations SET status='cancelled' WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
    RETURN;
  END IF;
  UPDATE appdata_operations SET status=CASE WHEN status='superseded' THEN 'superseded' ELSE 'committed' END,saved_at=COALESCE(saved_at,now()),unresolved_upload=EXISTS(SELECT 1 FROM appdata_upload_attempts t WHERE t.account_id=p_account AND t.generation=p_generation AND t.operation_id=p_operation AND t.state<>'settled') WHERE account_id=p_account AND generation=p_generation AND operation_id=p_operation;
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

