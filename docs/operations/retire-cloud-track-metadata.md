# Retire cloud track metadata on 29 October 2026

The user requested removal of the retired `track_metadata` table one week after 22 October 2026, allowing older clients time to update. Do not drop it before **29 October 2026 (Europe/Berlin)**. The prepared [SQL](drop-track-metadata.sql) is outside `db/migrations` so this release cannot accidentally apply it. Migration `0006` stays unchanged. When due, allocate the next unused forward migration number; do not assume `0011` will still be available.

The removal covers extracted tags for all accounts, including tracks in Favorites and Playlists. Preserve users, Playlists, Favorites, collection descriptors, and Google Drive files. Never use `CASCADE` for the drop.

## Before removal

1. Verify the compatibility release is serving production. Inventory old production, preview, and rollback deployments that can reach the same database. Old **clients** tolerate missing synced tags and the authenticated no-op upload endpoint; old **servers** still querying this table do not. Retain the no-op endpoint and legacy bootstrap acceptance after the drop.
2. Verify the exact DriveBeats production Neon database and branch through configured tools, without exporting secrets. Confirm backup or point-in-time restore coverage for the table and a practical recovery path. Creating any additional backup branch requires the applicable remote-state authorization.
3. Read production server code and inspect sync/bootstrap/Playlist/Favorite/cloud-delete paths for remaining queries. Check recent tag writes after the verified compatibility deployment timestamp using a parameterized read-only query: `SELECT count(*) FROM track_metadata WHERE extracted_at > $1`. Any result above zero blocks removal until the writing server is identified. Zero is supporting evidence, not proof that every deployment is safe.
4. Verify collection sync and authenticated old-client tag uploads on the serving release. A week passing alone is insufficient if the compatibility release did not deploy or old servers remain in use.

## Removal and verification

On or after the due date, if those checks pass, use the prepared SQL as the next forward migration against only the verified DriveBeats database. Verify table absence and working collection sync/bootstrap afterward. Do not roll back to pre-retirement server builds after removal; use a forward correction or an explicitly approved restore instead.

A chat heartbeat named **Remove retired DriveBeats metadata table** is scheduled to return in one week. It must retain the table and report a concrete blocker if compatibility or the target cannot be established. After removal and verification succeed, it must **delete its own schedule**, as requested by the user, rather than merely pause it.
