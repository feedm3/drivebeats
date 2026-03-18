CREATE TABLE IF NOT EXISTS users (
  google_user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_google_id TEXT NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playlists_user_google_id_idx
  ON playlists (user_google_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size TEXT,
  modified_time TEXT,
  parents TEXT[] NOT NULL DEFAULT '{}',
  parent_folder_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, file_id)
);

CREATE INDEX IF NOT EXISTS playlist_tracks_playlist_position_idx
  ON playlist_tracks (playlist_id, position ASC);

CREATE TABLE IF NOT EXISTS favorite_tracks (
  user_google_id TEXT NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size TEXT,
  modified_time TEXT,
  parents TEXT[] NOT NULL DEFAULT '{}',
  parent_folder_name TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_google_id, file_id)
);

CREATE INDEX IF NOT EXISTS favorite_tracks_favorites_idx
  ON favorite_tracks (user_google_id, updated_at DESC)
  WHERE is_favorite = TRUE;
