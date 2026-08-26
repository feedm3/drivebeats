---
status: accepted
---

# Keep the Library Search catalog device-local

DriveBeats caches a complete, account-scoped Library Search catalog in a separate browser IndexedDB so filename search can remain responsive without putting imported Drive metadata in Neon or another hosted service. The catalog contains only the metadata required for search and paths, is replaced atomically after a successful refresh, becomes stale after 24 hours, and is limited to 16 MiB; when durable storage is unavailable or the complete catalog exceeds that limit, search uses a session-only catalog instead. Library Search remains unavailable offline.

The catalog is acquired through separate paginated Google Drive listings for supported audio files and folders, then reduced to the current Imported Folders and Standalone Tracks by validating ancestry. When Imported Folders overlap, each matching imported-ancestor path is retained so removing the closest root can immediately re-anchor the track through a remaining ancestor. An audio item whose visible ancestry cannot connect to an Imported Folder is outside the proven Library boundary and is ignored, even when part of that chain is visible. If Drive reports an incomplete response or ancestry is circular, the refresh fails without replacing the last complete generation. The first implementation deliberately has no recursive fallback crawler.

## Considered Options

A hosted catalog was rejected because it would change the device-local Drive-data boundary and add database, privacy, retention, and hosting costs. Rebuilding on every session was rejected because it repeats Drive requests and metadata transfer. Drive-side prefix or whole-token search was rejected because it does not preserve the existing arbitrary-substring filename matching.

## Consequences

Catalog generations are scoped to one Google account and cleared on account switching, logout, account deletion, the shared clear-local-data workflow, and **Remove all downloads**. Import removal must hide affected entries immediately. A failed refresh keeps the last complete generation and marks its results as potentially outdated; partial generations are never searchable.
