-- Narrow, short-lived capabilities for one previously selected synced track.
-- Only hashes of capability secrets are stored; never provider tokens or audio.
CREATE TABLE IF NOT EXISTS mcp_media_grants (
  capability_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  google_user_id text NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  file_id text NOT NULL CHECK (length(file_id) BETWEEN 1 AND 256),
  mime_type text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mcp_media_grants_expiry ON mcp_media_grants(expires_at);
