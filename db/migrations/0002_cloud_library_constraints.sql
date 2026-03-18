DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_email_length_check
      CHECK (char_length(email) <= 320);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_name_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_name_length_check
      CHECK (name IS NULL OR char_length(name) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_picture_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_picture_length_check
      CHECK (picture IS NULL OR char_length(picture) <= 2048);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlists_id_length_check'
  ) THEN
    ALTER TABLE playlists
      ADD CONSTRAINT playlists_id_length_check
      CHECK (char_length(id) <= 512);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlists_name_length_check'
  ) THEN
    ALTER TABLE playlists
      ADD CONSTRAINT playlists_name_length_check
      CHECK (char_length(name) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_file_id_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_file_id_length_check
      CHECK (char_length(file_id) <= 512);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_file_name_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_file_name_length_check
      CHECK (char_length(file_name) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_mime_type_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_mime_type_length_check
      CHECK (mime_type IS NULL OR char_length(mime_type) <= 255);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_size_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_size_length_check
      CHECK (size IS NULL OR char_length(size) <= 64);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_modified_time_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_modified_time_length_check
      CHECK (modified_time IS NULL OR char_length(modified_time) <= 64);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_parent_folder_name_length_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_parent_folder_name_length_check
      CHECK (
        parent_folder_name IS NULL OR
        char_length(parent_folder_name) <= 500
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'playlist_tracks_parents_cardinality_check'
  ) THEN
    ALTER TABLE playlist_tracks
      ADD CONSTRAINT playlist_tracks_parents_cardinality_check
      CHECK (cardinality(parents) <= 32);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_file_id_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_file_id_length_check
      CHECK (char_length(file_id) <= 512);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_file_name_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_file_name_length_check
      CHECK (char_length(file_name) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_mime_type_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_mime_type_length_check
      CHECK (mime_type IS NULL OR char_length(mime_type) <= 255);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_size_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_size_length_check
      CHECK (size IS NULL OR char_length(size) <= 64);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_modified_time_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_modified_time_length_check
      CHECK (modified_time IS NULL OR char_length(modified_time) <= 64);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_parent_folder_name_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_parent_folder_name_length_check
      CHECK (
        parent_folder_name IS NULL OR
        char_length(parent_folder_name) <= 500
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'favorite_tracks_parents_cardinality_check'
  ) THEN
    ALTER TABLE favorite_tracks
      ADD CONSTRAINT favorite_tracks_parents_cardinality_check
      CHECK (cardinality(parents) <= 32);
  END IF;
END $$;
