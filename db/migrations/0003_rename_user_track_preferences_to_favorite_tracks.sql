DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_track_preferences'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'favorite_tracks'
  ) THEN
    ALTER TABLE user_track_preferences RENAME TO favorite_tracks;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'user_track_preferences_favorites_idx'
  ) THEN
    ALTER INDEX user_track_preferences_favorites_idx
      RENAME TO favorite_tracks_favorites_idx;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_file_id_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_file_id_length_check
      TO favorite_tracks_file_id_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_file_name_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_file_name_length_check
      TO favorite_tracks_file_name_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_mime_type_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_mime_type_length_check
      TO favorite_tracks_mime_type_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_size_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_size_length_check
      TO favorite_tracks_size_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_modified_time_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_modified_time_length_check
      TO favorite_tracks_modified_time_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_parent_folder_name_length_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_parent_folder_name_length_check
      TO favorite_tracks_parent_folder_name_length_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_track_preferences_parents_cardinality_check'
  ) THEN
    ALTER TABLE favorite_tracks
      RENAME CONSTRAINT user_track_preferences_parents_cardinality_check
      TO favorite_tracks_parents_cardinality_check;
  END IF;
END $$;
