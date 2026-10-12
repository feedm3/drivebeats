# MCP task execution context

Repository: /Users/fabdie/IdeaProjects/private/drivebeats. Read /Users/fabdie/IdeaProjects/private/AGENTS.md, repository AGENTS.md, /Users/fabdie/.agents/CODING_STANDARDS.md, and GLOSSARY.md. Repository rules take precedence. Check current Git status and preserve unrelated changes; task assignment does not authorize committing/pushing unless requested.

## Product and architecture

- Same Google identity and existing cloud Playlist/favorite data in both frontends. Identity uses verified Google sub, not an email-based second account.
- Full imported Library includes tracks absent from Playlists/favorites. Normal controls, requested AI actions, and optional DJ Mode are all in scope.
- Two frontend entrypoints; one existing backend/database initially. Web hosts the MCP endpoint and built MCP App UI resource.
- Package names: apps/drivebeats-web (@drivebeats/web), apps/drivebeats-mcp-app (@drivebeats/mcp-app), packages/drivebeats-core (@drivebeats/core), packages/drivebeats-client (@drivebeats/client). Create each when its task needs it.
- Core owns portable types/rules. Client owns shared music views and browser behavior. App shells own host adapters. Credentials/database code stay server-only in web.
- Prototype working default: users deliberately select folders/files once inside the plugin. This is an implementation default, not a claimed explicit user answer. Automatic inheritance of the website's exact imports remains a later option; override the default if the user requires inheritance.
- Private ChatGPT desktop/Work first. Public directory publication, cross-device player control, music-analysis pipelines, and plugin offline support are outside this prototype.

## Data and permission rules

Google Drive is read-only. Preserve drive.file and explicit user selection; never introduce unrestricted Drive search or writes. Cloud data includes Playlists, favorites, and their ID3 metadata. Imported roots, full Library catalog/tree, recently played, player state, and offline media remain device-local; audio never goes into Neon. Library Search is currently filename-only.

ChatGPT authenticates to DriveBeats with a DriveBeats-scoped grant; Google authorization is separate. The sandboxed UI does not inherit website cookies/storage. Token ownership and Library membership cannot come from model-supplied user IDs or arbitrary track IDs.

Read docs/vercel-access.md before Vercel inspection. Work only on drivebeats; read-only inspection is authorized. Remote Vercel changes and secret exports require approval. Follow the user rule to ask before changing anything outside this repository. Prepare concrete local work before a necessary external action. Never print credential values. Existing authorization can cover later actions; do not ask twice.

## Source paths and verification

Paths in task briefs are repository-relative. Before task 1, web paths start with src/. After task 1, prefix them with apps/drivebeats-web/. Preserve root docs/, GLOSSARY.md, AGENTS.md, and db/migrations/. Read the prerequisite task's execution notes for actual paths and decisions.

Current manifests/scripts own versions and commands. At authoring, mise.toml specifies Node 24 and pnpm 12.7.0; package.json has Next 16.4.0, React 19.3.0, and TypeScript 7.0.2. Revalidate instead of upgrading during migration. Read relevant installed Next docs before writing Next code; resolve the installed package from the app after migration.

For every code task run root pnpm test, pnpm lint, and pnpm build, plus manual affected flows. Sync additionally verifies another session/refresh, logout preserves cloud data, and cloud deletion clears synced data without Drive writes. Test 320–428px and desktop, with touch targets at least 44×44px. Add meaningful tests for changed contracts, not tests mirroring simple moves.

## Handoff result

Update the assigned brief's execution notes: changed paths, decisions/package versions, exact commands/results, manual evidence, and unresolved items. Record credentials by variable name only. Check the index task only when all required acceptance checks pass; otherwise distinguish implemented from unverified work. Report commit/push/deployment status without implying they happened.

Proceed into another task only when assigned or authorized. Technical unknowns are investigation work; missing credentials, account access, approval, or a changed requirement are user-input points. A successful build is not proof of ChatGPT auth, audible playback, or sync.
