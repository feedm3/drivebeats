# DriveBeats production activation

The repository contains the production implementation and a compatibility
plugin package in `plugins/drivebeats`. Remote activation is separate from
source preparation. The user's instruction to commit/push main authorizes Git
publication; AGENTS.md still requires approval for Vercel configuration,
remote migration and saved-plugin updates.

## Confirmed remote state, 2026-10-13

- Vercel CLI independently resolved team `fabian-dietenbergers-projects`,
  project `drivebeats` / `prj_xy3ZuYI2SwkVLh3r3CpWxbWfTRcY`, root
  `apps/drivebeats-web`, Node24. The connector returned403 for environment
  listing; the documented CLI fallback succeeded without exporting secrets.
- The five MCP environment variables exist only for Preview on
  `codex/mcp-account-linking`. Production has the existing database/Google/web
  variables, but lacks MCP activation variables.
- Read-only Neon inspection of project `old-night-81938469`, main branch
  `br-rapid-mud-agwwmwmp`, database `neondb` confirms migration0009 is unapplied:
  the three music coordination tables and media `session_id` column are absent.
- The existing owned USER/PRIVATE plugin is
  `plugins_6accdcd7dcd88191a0beba5e3f94eb63`, version0.2.2, release
  `pluginrel_6ace1a0342688191b982013b6e92e134`. Its inventory contains only the
  two compatibility manifests and two PNG assets. It still targets preview.
- Account-linking notes record both production and preview Google callbacks
  saved in the existing Google client. This turn did not re-open Google Cloud
  to independently confirm that provider configuration.

## Concrete activation sequence

1. After approval, apply only `db/migrations/0009_mcp_music_sessions.sql` to
   the verified main database in one transaction. Migrations0007/0008 are
   already applied; do not rerun0007. Verify the three new tables, constraints,
   indexes, nullable media session column and unchanged music/user row counts.
   No existing collections or audio are migrated or deleted.
2. Configure the five MCP variables for **Production** on `drivebeats`:
   `MCP_AUTH_ISSUER=https://www.drivebeats.app`,
   `MCP_CLIENT_ID=drivebeats-chatgpt`, and
   `MCP_CLIENT_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect,http://127.0.0.1:46123/callback`.
   Generate independent32-byte base64url values for
   `MCP_ACCESS_TOKEN_SIGNING_KEY` and `MCP_CREDENTIAL_ENCRYPTION_KEY`;
   retain them only in secret configuration. Do not export current secrets.
   Keep the existing database/Google/public app configuration and preview scope.
3. Build/redeploy the reviewed main commit with production variables. Verify
   the production alias points to that commit and READY deployment. Verify
   discovery,24 tools, no anonymous sample tools, consent scopes and bundled
   player CSP. Provider/account proof remains separate from these HTTP checks.
4. Package only `.codex-plugin/plugin.json`, `.mcp.json`, and PNG assets from
   `plugins/drivebeats`. Source manifests use version1.0.0. The platform requires the immutable
   existing package identifier `drivebeats-fixture-player`; the display name
   remains DriveBeats and no demo behavior is retained. The known desktop loader must receive the compatibility
   archive, excluding portable `plugin.json`/`mcp.json`. Verify with
   `scripts/verify-plugin.py` and the actual bundled CLI before upload.
5. Re-read the exact plugin files/release, then update that same plugin ID
   guarded by its latest release ID. Preserve USER/PRIVATE ownership/audience,
   existing icon bytes and default prompt. No unrelated integration is removed.
   Current inventory contains no additional demo files requiring deletion.
   Read back the manifests, endpoint,version,scope and file inventory.
6. Reconnect the installed plugin to the production issuer. Previous preview
   grants remain issuer-bound and are not silently upgraded. Consent includes
   `library:write`; Google Drive remains `drive.file` and read-only.

## Required real-host acceptance

Use the existing Google account and deliberately selected real music:

- Connect and compare the existing cloud Playlists/favorites/metadata.
- Open external Picker, select an Imported Folder with nested audio and a
  Standalone Track absent from saved collections. Return to the plugin and
  confirm full browsing plus filename search, including the unsaved track.
  Reject an unrelated Drive ID. Reopen the player and verify receipt/catalog
  restoration under the same grant.
- Play actual Drive audio and verify audible play/pause/next/previous/seek,
  volume/shuffle/repeat at mobile and desktop sizes. Confirm data tools leave
  the same Audio element mounted and gesture rejection has useful recovery.
- Ask ordinary chat to search, queue, play/pause/skip and save a Playlist.
  Verify queued versus applied outcomes, duplicate retries and closed targets.
  Refresh another website session to see the saved Playlist/favorite changes.
- Start DJ Mode explicitly. Confirm the target host advertises sampling and
  performs another automatic refill without a new user message; demonstrate
  manual override, stop, refill failure and closure. If the real host lacks
  sampling, leave4d incomplete. A backend paid provider would require separate
  approval for provider and cost limits; none is introduced here.
- Verify plugin disconnect and website logout clear the appropriate local
  data while preserving synced collections. Cloud deletion is destructive and
  requires explicit authorization or a dedicated disposable account; verify
  the no-Drive-write behavior with existing automated contracts meanwhile.

Record each outcome in Task4. Local SQL/browser simulations establish specific
contracts, not real ChatGPT/Google acceptance. Do not mark Task4 complete or
claim production readiness until required live checks pass.

## Prepared artifact

A compatibility-only archive is generated in the ignored
`.vercel/releases/drivebeats-1.0.0.zip`. It is reproducible from the tracked
plugin source. The bundled desktop CLI loader check passed locally; the
production endpoint check becomes meaningful after activation. The archive
contains no environment files or credentials.


## Activated production, 2026-10-13

The user approved the exact activation sequence. All remote release actions
below are completed; real production-account/player acceptance remains open.

- Applied migration0009 in one repeatable-read transaction to the verified
  `drivebeats` main database. Added29 coordination columns plus nullable media
  `session_id`, seven indexes and16 constraints. The three new tables were
  empty after migration. The transaction verified unchanged existing counts:
  users263, Playlists72, Playlist Tracks761, favorites202, metadata179.
- Added the five MCP variables for Production only. The three public settings
  match the concrete sequence above; the two keys were independently generated
  and streamed directly into Vercel Secret variables. No plaintext key was
  printed, persisted locally or exported; preview settings were preserved.
- Redeployed reviewed implementation commit
  `1970b858a1a86f403af33d5cea14fb10960e3373` as READY production deployment
  `dpl_JAUJ71pEUhhZZ1TxPZyeU3SAYsGQ`, immutable URL
  `https://drivebeats-758vtb1xj-fabian-dietenbergers-projects.vercel.app`.
  Independent `www.drivebeats.app` alias readback resolves to that deployment.
  Source GitHub validation run38405424850 passed.
- Independent canonical HTTPS probe passed21/21 checks: modern stateless
  discovery,24 production tools, strict schemas/scopes/annotations, canonical
  OAuth metadata with all four baseline scopes and S256, production player
  resource/config/CSP, anonymous launcher, full-baseline linking challenge and
  early HTTP401 rejection for invalid Bearer credentials. No fixture tools or
  fixture UI remain. The actual bundled desktop loader also passed the exact
  archive and anonymously loaded all24 deployed tools.
- Updated the same USER/PRIVATE plugin ID to1.0.0, saved release
  `pluginrel_6ace3cb8f0088191ba50865726837c46`. Manifest/endpoint/client/callback/
  audience and complete four-file inventory readback passed. Default prompt and
  PNG assets remain unchanged. The service rejected renaming the internal
  package identifier, so `drivebeats-fixture-player` is retained solely as the
  immutable existing identity; displayed name is DriveBeats. The successful
  archive SHA256 is
  `f0bd0eb2a64d78aff9eb0345ca29340e542e73e8cca6cc9fad324ead1d6d6e57`.
- Published plugin:
  [DriveBeats](https://chatgpt.com/plugins/plugins_6accdcd7dcd88191a0beba5e3f94eb63).
  Saved release verification does not imply the current desktop installation
  refreshed. This chat still exposes the old preview tool inventory. At the
  post-release read-only check, no production-client grant existed yet.

The user was asked to update/reopen DriveBeats, reconnect to production and
select real music. Actual production linking, Picker selection, audible Drive
playback, cross-session sync and target-host DJ refill are not yet confirmed.
Task4 remains unchecked. The required real-host checklist above still applies.
