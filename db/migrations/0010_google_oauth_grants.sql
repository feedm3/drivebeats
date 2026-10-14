-- Keep approved Google connections across website logout and device changes.
-- Tokens are encrypted by the application; account deletion removes the grant.
CREATE TABLE google_oauth_grants (
  google_user_id TEXT PRIMARY KEY REFERENCES users(google_user_id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
