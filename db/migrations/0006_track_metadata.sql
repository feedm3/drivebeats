CREATE TABLE IF NOT EXISTS track_metadata (
  user_google_id TEXT NOT NULL REFERENCES users(google_user_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  file_modified_time TEXT,
  id3_title TEXT CHECK (char_length(id3_title) <= 500),
  id3_artist TEXT CHECK (char_length(id3_artist) <= 500),
  id3_album TEXT CHECK (char_length(id3_album) <= 500),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_google_id, file_id)
);
