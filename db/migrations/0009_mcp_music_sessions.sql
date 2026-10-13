-- Short-lived coordination only. Never persist a full Library catalog or audio.
CREATE TABLE mcp_music_sessions (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  google_user_id text NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  imported_folder_ids text[] NOT NULL DEFAULT '{}',
  standalone_track_ids text[] NOT NULL DEFAULT '{}',
  catalog_ready boolean NOT NULL DEFAULT false,
  imports_revision integer NOT NULL DEFAULT 0 CHECK (imports_revision >= 0),
  import_receipt text,
  import_pending_until timestamptz,
  expires_at timestamptz NOT NULL,
  max_expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (cardinality(imported_folder_ids) <= 100),
  CHECK (cardinality(standalone_track_ids) <= 100)
);
CREATE UNIQUE INDEX mcp_music_sessions_active_grant ON mcp_music_sessions(grant_id) WHERE closed_at IS NULL;
CREATE INDEX mcp_music_sessions_expiry ON mcp_music_sessions(expires_at);

CREATE TABLE mcp_music_commands (
  session_id uuid NOT NULL REFERENCES mcp_music_sessions(id) ON DELETE CASCADE,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
  command_type text NOT NULL,
  executor text NOT NULL CHECK (executor IN ('browser', 'server')),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 131072),
  payload_hash text NOT NULL,
  imports_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','applied','failed')),
  claim_token uuid,
  result jsonb CHECK (octet_length(result::text) <= 49152),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id, operation_id)
);
CREATE INDEX mcp_music_commands_pending ON mcp_music_commands(session_id, created_at) WHERE status IN ('queued','claimed');

CREATE TABLE mcp_music_imports (
  capability_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES mcp_music_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX mcp_music_imports_expiry ON mcp_music_imports(expires_at);
ALTER TABLE mcp_media_grants ADD COLUMN session_id uuid REFERENCES mcp_music_sessions(id) ON DELETE CASCADE;
