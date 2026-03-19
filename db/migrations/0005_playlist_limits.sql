-- Keep these machine-readable DETAIL codes aligned with src/lib/playlist-limits.ts.
CREATE OR REPLACE FUNCTION enforce_playlists_per_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM playlists
    WHERE id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_google_id));

  IF (
    SELECT COUNT(*)
    FROM playlists
    WHERE user_google_id = NEW.user_google_id
  ) >= 10 THEN
    RAISE EXCEPTION
      USING MESSAGE = 'You can only have up to 10 playlists.',
            DETAIL = 'PLAYLIST_COUNT_LIMIT';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'playlists_per_user_limit_trigger'
      AND tgrelid = 'playlists'::regclass
      AND NOT tgisinternal
  ) THEN
    DROP TRIGGER playlists_per_user_limit_trigger ON playlists;
  END IF;
END $$;

CREATE TRIGGER playlists_per_user_limit_trigger
BEFORE INSERT ON playlists
FOR EACH ROW
EXECUTE FUNCTION enforce_playlists_per_user_limit();

CREATE OR REPLACE FUNCTION enforce_playlist_tracks_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM playlist_tracks
    WHERE playlist_id = NEW.playlist_id
      AND file_id = NEW.file_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.playlist_id));

  IF (
    SELECT COUNT(*)
    FROM playlist_tracks
    WHERE playlist_id = NEW.playlist_id
  ) >= 500 THEN
    RAISE EXCEPTION
      USING MESSAGE = 'This playlist has reached the 500-song limit.',
            DETAIL = 'PLAYLIST_TRACK_LIMIT';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'playlist_tracks_limit_trigger'
      AND tgrelid = 'playlist_tracks'::regclass
      AND NOT tgisinternal
  ) THEN
    DROP TRIGGER playlist_tracks_limit_trigger ON playlist_tracks;
  END IF;
END $$;

CREATE TRIGGER playlist_tracks_limit_trigger
BEFORE INSERT ON playlist_tracks
FOR EACH ROW
EXECUTE FUNCTION enforce_playlist_tracks_limit();
