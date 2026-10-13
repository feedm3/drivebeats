-- Separate plugin grants; deleting an account removes its grants, not Drive data.
CREATE TABLE mcp_grants (
  id UUID PRIMARY KEY,
  google_user_id TEXT NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  encrypted_google_refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mcp_grants_account_idx ON mcp_grants(google_user_id);
CREATE TABLE mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE mcp_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE mcp_link_requests (
  id UUID PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
