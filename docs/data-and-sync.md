# Data and sync contract

These standing rules govern storage ownership and data lifecycle changes. The
Google Drive access policy remains in [AGENTS.md](../AGENTS.md).

## Storage ownership

- Playlists, favorites, Imported Folder/Standalone Track choices and completed,
  content-version-scoped tags sync through DriveBeats-owned hidden Google app data.
  Required app-folder consent and verified one-time migration gate normal use.
- Neon retains account/authentication and durable coordination records. Legacy
  collections are a migration source only until the global rollout cutoff.
- Store only metadata needed for synced features. Never store audio blobs or the
  full imported folder tree in Neon.
- Recently played, descendant catalogs, player state and offline downloads remain
  device-local. The Library Search catalog is account-scoped and device-local;
  publish only complete catalog generations.
- Restore saved tags before missing-tag extraction. WebMCP `cache_only` stays
  network-free.

## Sync verification

For sync changes, verify these scenarios in addition to the base code-change checks
in [AGENTS.md](../AGENTS.md):

- Playlist and favorite changes appear on another device or refreshed session.
- Logout clears local device data and preserves synced cloud data.
- Account deletion fences and drains writers, deletes and verifies all app-owned
  hidden data, then removes credentials. Use disposable accounts for destructive
  verification.

## Operational procedures

Before resolving interrupted uploads, unknown save outcomes or manually settling
account deletion, read [the recovery runbook](operations/recover-drive-backup.md).
Before retiring legacy collections, read
[the collection runbook](operations/retire-neon-collections.md); `track_metadata`
has [a separate retirement runbook](operations/retire-cloud-track-metadata.md).
