-- DEFERRED: user authorized removal no earlier than 2026-10-29 (Europe/Berlin).
-- Not an active migration. Follow retire-cloud-track-metadata.md before use.
-- Deploy the local-only tag compatibility changes first. Verify all running server
-- deployments no longer query track_metadata and old open clients receive the
-- authenticated no-op metadata endpoint. Account for backups/retention separately.
-- This removes extracted tags for BOTH Playlists and Favorites for ALL accounts.
-- Collection file descriptors, Playlists and Favorites remain untouched.
DROP TABLE IF EXISTS track_metadata;
