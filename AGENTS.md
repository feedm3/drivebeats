# Repository Guidelines

## Build, Test, and Development Commands

Use `pnpm` for local work because the repository tracks `pnpm-lock.yaml`.

- `pnpm dev` starts the Next.js dev server on `http://localhost:3000`.
- `pnpm build` creates the production build and catches type and route issues.
- `pnpm start` serves the built app locally.
- `pnpm lint` runs Biome checks.
- `pnpm format` applies Biome formatting and import organization.

## Coding Style & Naming Conventions

This project uses TypeScript with `strict` mode and Biome for formatting and linting. Prefer 2-space indentation, double
quotes, and the `@/` path alias for imports from `src`. Keep React components in PascalCase exports, but name files in
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
- `recently played`, imported Drive items, player state, and offline downloads remain device-local.
- Do not store the full imported folder tree in the database.
- Only store metadata needed for synced features. Never store audio blobs in Neon.

## Testing Guidelines

There is no dedicated automated test runner configured yet. Before opening a PR, run `pnpm lint` and `pnpm build`, then
manually verify the affected flow in the browser. For authentication or playback changes, document the manual checks you
performed, for example Google sign-in, Drive import, and player controls. If you add tests, colocate them as `*.test.ts`
or `*.test.tsx` near the feature they cover.

For sync-related changes, also verify:

- playlist and favorite changes appear after switching devices or refreshing another session
- logout clears local device data but does not delete synced cloud data
- deleting cloud data removes synced playlists and favorites without writing anything back to Google Drive

## Google Drive Access Policy

Treat Google Drive as strictly read-only in this codebase. Never add code that writes, edits, moves, renames, uploads,
trashes, deletes, or changes permissions for Drive files or folders. All Drive integrations must be limited to reading
metadata, listing content, and streaming user-selected audio with the minimum required access.
