# Web app guide

## Installed Next.js guides

Resolve `next/package.json` from this app, for example from the repository root:

```sh
pnpm --filter @drivebeats/web exec node -p 'require.resolve("next/package.json")'
```

Read the relevant guides in `dist/docs/` beside that resolved manifest. The
repository root may have no `node_modules/next`. Keep the generated block below;
`next dev` maintains it in this app directory.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
