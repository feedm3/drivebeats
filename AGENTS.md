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

## Code and migrations

Export React components in PascalCase; use kebab-case filenames and `*-store.ts`
for stores. Follow Next.js file conventions such as `page.tsx` and `route.ts`.

Within `apps/drivebeats-web/src`:

- Share the Neon client through `db/client.ts`.
- Put table queries in `db`, one module per table, focused on that table.
- Put multi-table workflows in `lib/*service.ts`.
- Keep route handlers thin: validate, load auth, call a service, return a response.

Add forward SQL migrations in root `db/migrations`; preserve applied migrations.
Renaming a table, index or constraint requires an explicit migration for existing
databases. Align database constraints with API validation limits where possible.

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

For sync changes, also complete
[sync verification](docs/data-and-sync.md#sync-verification).

## Mobile UI

Design and test at 320–428 CSS pixels before wider breakpoints. Give interactive
elements at least 44×44 CSS-pixel touch targets with adequate spacing. Every action
must work by tap, including actions also exposed on hover.
