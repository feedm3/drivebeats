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

## Conditional reads

Collection sync and portable restore may reuse a completed snapshot within the
current browser session. A checkpoint covers the account generation, committed
operation manifest and a fresh inventory of the saved Drive files' checksums.
Reservation revision alone is insufficient: an upload can commit without
advancing it. Missing files, changed checksums, incomplete provider listings and
authorization failures must never produce an unchanged response.

Checkpoints are memory-only and cleared on logout/account replacement. A failed
or incomplete portable restore cannot establish one. Root choices staged during
revalidation take the full restore/rebase path before they may be uploaded.
Conditional reads retain the final live identity and manifest checks; neither
authorization nor account state is cached across server requests.

Collection-only reads skip tag-compaction discovery. Read routes may reuse the
session already validated during that same request, preserving service-level
identity checks before and after Drive access. Writes, durable retry receipts,
upload settlement and account-deletion fences retain their existing behavior.

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
