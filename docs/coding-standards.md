# Coding standards

## Naming

Export React components in PascalCase; use kebab-case filenames and `*-store.ts`
for stores. Follow Next.js file conventions such as `page.tsx` and `route.ts`.

## Database and services

Within `apps/drivebeats-web/src`:

- Share the Neon client through `db/client.ts`.
- Put table queries in `db`, one module per table, focused on that table.
- Put multi-table workflows in `lib/*service.ts`.
- Keep route handlers thin: validate, load auth, call a service, return a response.

## Migrations

Add forward SQL migrations in root `db/migrations`; preserve applied migrations.
Renaming a table, index or constraint requires an explicit migration for existing
databases. Align database constraints with API validation limits where possible.

## Mobile UI

Design and test at 320–428 CSS pixels before wider breakpoints. Give interactive
elements at least 44×44 CSS-pixel touch targets with adequate spacing. Every action
must work by tap, including actions also exposed on hover.
