# Repository Guidelines

## Local commands

Use `pnpm` for local work because the repository tracks `pnpm-lock.yaml`.

Read `package.json` for available scripts. `pnpm format` applies formatting only;
use `pnpm exec biome check --write <changed-files>` to apply safe lint fixes and
organize imports as well.

## Vercel access

Before inspecting or changing Vercel resources, read
[docs/vercel-access.md](docs/vercel-access.md).

Work only on `drivebeats`. Read-only inspection is authorized.
Ask before changing remote Vercel state or exporting secrets locally.

## Coding Style & Naming Conventions

Keep React components in PascalCase exports, but name files in
kebab-case such as `playlist-track-item.tsx`. Follow Next.js file conventions exactly: `page.tsx`, `layout.tsx`,
`route.ts`, `manifest.ts`, and similar. Store modules should keep the `*-store.ts` suffix.

## Database & Service Conventions

Keep database access easy to audit.

- Put the shared Neon client in `src/db/client.ts`.
- Put table access in `src/db`, with one file per table such as `playlists.ts`, `playlist-tracks.ts`, and
  `favorite-tracks.ts`.
- Keep those `src/db` files focused on queries against their own table.
- Put multi-table workflows in `src/lib/*service.ts`.
- Keep route handlers thin: validate the request, load auth, call a service, return the response.

## Migrations

- Add new SQL migrations in `db/migrations`.
- Do not rewrite old applied migrations for existing environments. Add a new forward migration instead.
- If you rename a table, index, or constraint, add an explicit migration for existing databases.
- Keep database constraints aligned with API validation limits where possible.

## Sync Boundaries

- `playlists` and `favorites` are cloud-synced through Neon.
- ID3 title, artist, and album metadata for tracks in playlists or favorites also syncs through Neon.
- `recently played`, imported Drive items, player state, and offline downloads remain device-local.
- Do not store the full imported folder tree in the database.
- Only store metadata needed for synced features. Never store audio blobs in Neon.

Before changing Library Search catalog acquisition, storage, or invalidation, read
[the device-local catalog ADR](docs/adr/0001-keep-library-search-catalog-device-local.md).

## Testing Guidelines

Before delivering code changes, run `pnpm test`, `pnpm lint`, and `pnpm build`,
then manually verify the affected flow in the browser. Report the results and any
checks that could not be completed.
For authentication or playback changes, document the manual checks you performed, for example Google sign-in, Drive
import, and player controls. Colocate tests as `*.test.ts` or `*.test.tsx` near the feature they cover.

For sync-related changes, also verify:

- playlist and favorite changes appear after switching devices or refreshing another session
- logout clears local device data but does not delete synced cloud data
- deleting cloud data removes synced playlists and favorites without writing anything back to Google Drive

## Google Drive Access Policy

Treat Google Drive as strictly read-only in this codebase. Never add code that writes, edits, moves, renames, uploads,
trashes, deletes, or changes permissions for Drive files or folders. All Drive integrations must be limited to reading
metadata, listing content, and streaming user-selected audio with the minimum required access.

## Mobile-First Design

Design for mobile first; all UI must be usable on small screens before scaling up.

- Interactive elements (buttons, links, toggles) must have a minimum touch target of 44×44 CSS pixels (Apple HIG / WCAG
  recommendation).
- Leave adequate spacing between tap targets so adjacent elements are not accidentally triggered.
- Avoid hover-only interactions; every action must be reachable via tap.
- Test layouts at 320px–428px viewport widths before wider breakpoints.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Domain language

Before naming domain concepts or changing reader-facing terminology, read
[GLOSSARY.md](GLOSSARY.md), the canonical domain glossary.
