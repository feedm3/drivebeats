# DriveBeats agent guide

This repository is public. Keep secrets and real user data out of tracked files;
use synthetic examples.

## Local work

Use `pnpm` from the repository root for installation, development and validation.
Read `package.json` for scripts. `pnpm format` only formats; use
`pnpm exec biome check --write <changed-files>` for safe lint fixes and imports.

The app lives in `apps/drivebeats-web`. Keep app environment files there;
`mise.local.toml` and Vercel linkage belong at the repository root.

## Read when relevant

- **Domain language:** before naming domain concepts or changing reader-facing
  terminology, read [GLOSSARY.md](GLOSSARY.md). Resolve conflicts with its canonical
  terms before introducing new language.
- **Coding standards:** before writing or reviewing code, changing the database
  schema, or designing or reviewing UI, read
  [coding standards](docs/coding-standards.md).
- **Next.js:** before writing app code, read
  [the app guide](apps/drivebeats-web/AGENTS.md) and the relevant installed Next.js
  guides it requires.
- **Data and sync:** before changing authentication/consent, persistence,
  restore/sync, imports, metadata extraction, Library Search, WebMCP data access,
  logout or account deletion, read [the data and sync contract](docs/data-and-sync.md).
- **Vercel:** before inspecting or changing resources, read
  [Vercel access](docs/vercel-access.md). Work only on `drivebeats`. Read-only
  inspection is authorized; ask before remote changes or local secret exports.
- **Retirement:** before retiring legacy Neon collections, read
  [the collection runbook](docs/operations/retire-neon-collections.md). Before
  retiring `track_metadata`, read
  [the separate metadata runbook](docs/operations/retire-cloud-track-metadata.md).
- **Backup recovery:** before resolving interrupted uploads, unknown save outcomes
  or manually settling account deletion, read
  [the recovery runbook](docs/operations/recover-drive-backup.md).

## Data boundaries

Google Drive music files and folders are strictly read-only: read metadata, list
content and stream user-selected audio. Never write audio, change music files,
folders or permissions, or expose arbitrary Drive write targets. The sole write
exception is versioned DriveBeats-owned data in `appDataFolder`, through the
authenticated server coordinator using `drive.appdata`.

## Verification

Before delivering code changes, run `pnpm test`, `pnpm lint` and `pnpm build` from
the repository root, then verify the affected flow in the browser. Report results,
manual scenarios and checks that remain unverified. Colocate tests as `*.test.ts`
or `*.test.tsx`; test observable behavior rather than restating the implementation.

For authentication or playback changes, document the relevant Google sign-in,
Drive import and player-control checks.

For UI changes, verify the
[mobile UI requirements](docs/coding-standards.md#mobile-ui).

For sync changes, also complete
[sync verification](docs/data-and-sync.md#sync-verification).
