# Task 1 Create the monorepo

Read [execution context](../context.md). Scope: local migration only. No prerequisite; unanswered Library, login, and DJ choices do not block this task.

## Outcome and layout

The web app runs from apps/drivebeats-web and root commands remain usable. Establish a source-only core package consumed by web. Preserve ordinary product behavior and URL routes.

```text
apps/drivebeats-web/          Next app, manifest, public, app configs
packages/drivebeats-core/     manifest, src/types.ts, tsconfig.json
db/migrations/               existing SQL history unchanged
docs/                        guides, research, task briefs
package.json                 private workspace root and orchestration
pnpm-workspace.yaml          package globs and existing build permissions
pnpm-lock.yaml               one root lockfile
```

Task 2 creates the MCP frontend; task 4 creates shared client. No empty application placeholders are required now.

## Read first

- Workspace/tooling: package.json, pnpm-workspace.yaml, mise.toml, .gitignore, .worktreeinclude.
- App/checks: tsconfig.json, next.config.ts, postcss.config.mjs, components.json, biome.json, vitest.config.ts, vitest.setup.ts.
- CI/operations: .github/workflows/test.yml, .github/workflows/dependabot-automerge.yml, .github/dependabot.yml, README.md, docs/vercel-access.md.

For extraction inspect src/types/index.ts and callers. Installed Next guides: dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md, transpilePackages.md, and dist/docs/01-app/02-guides/environment-variables.md.

## Implementation

1. Capture Git status and current check results to distinguish existing failures. Preserve dependency versions and pnpm allowBuilds entries.
2. Move src/, public/, Next/PostCSS configs, components.json, app TypeScript config, Vitest config/setup into apps/drivebeats-web. Generated .next, node_modules, and Next type files are not source moves. Keep docs, SQL history, GitHub workflows, tooling pins, skills/configuration, and repository-wide Biome rules at root.
3. Create private @drivebeats/web with existing dependencies/Next commands. Root remains drivebeats, private, with the existing packageManager pin. Root dev/start target web; test/lint/build cover all active packages and propagate required failures. Keep one root install/lockfile and workspace:* local dependencies. No Turbo/Nx.
4. Create source-only @drivebeats/core with a /types export. Move portable types/constants from src/types/index.ts into core src/types.ts; leave a compatibility re-export in web src/types/index.ts so existing @/types imports resolve. Keep AuthTokens web-local. Include core's real TypeScript check in root validation. No UI/store/search/shuffle refactoring now.
5. Repair config paths: Vitest aliases/test includes remain relative to web; core checked separately. Root Biome covers packages and ignores generated output. Next resolves workspaces within repository root; preserve react-native-fs stub alias. Shadcn CSS path stays relative to its relocated config.
6. Handle env loading explicitly. Next app env files belong at its app root. Inspect ignored env filenames without exposing values; relocate existing app env files into apps/drivebeats-web as needed, retaining ignored copies until verified. Keep mise.local.toml and Vercel linkage at root because the guide's helper resolves credentials there. Update .worktreeinclude for the new env location. Do not export remote secrets. Ignore nested dependencies/build/coverage output as well as env files.
7. Preserve /app, existing /api/* routes, /sw.js, /theme-init.js, icons/manifest, and existing CSP/frame restrictions. Folder changes require no new Google callback URL.
8. CI installs from root with --frozen-lockfile. Retain workflow Test, job/check validation, and Vercel status expectations used by automerge. Adapt dependency scanning to both workspace manifests, preserving grouping/cooldown. Update README commands/env location and AGENTS database/service paths to apps/drivebeats-web/src, Next-doc resolution, and root migration location. Repair research links to moved sources.
9. Read-only inspect Vercel per its guide. Prepare exact build root/command/output/workspace-inclusion changes from actual settings and current docs. Apply remote changes only with approval; do not publish the migration before hosting paths are ready.

## Acceptance and checks

- After updating manifests/lockfile, root pnpm install --frozen-lockfile, pnpm test, pnpm lint, and pnpm build succeed. Existing web tests execute; core is checked. Review resolved versions for accidental upgrades.
- Root pnpm dev serves the ordinary app; pnpm start serves the production build. A real core import resolves in the built web app.
- Browser: marketing/app routes/assets; Google sign-in/callback; import/browse; filename Library Search; play/pause/next/seek/shuffle; Playlist/favorite changes after a second-session refresh. Verify env loading without logging values.
- Generated files/env stay ignored; historical SQL migrations remain unchanged. No new schema/auth behavior.
- Record Vercel readiness separately. Pending remote approval means local migration implemented, deployment readiness unverified. Never claim deployed behavior.

Unavailable account/credentials leave manual checks explicitly unverified. Complete independent checks before reporting that gap. Adjust existing tests; add no tests for a folder move alone.

## Execution notes

Implemented locally on 2026-10-12. Vercel Root Directory was subsequently updated and verified with explicit user approval. Full acceptance remains open for real-account manual checks. Task 2 can start locally because task 1's local checks passed; it has not been started here.

### Layout and decisions

- Web source, public assets, Next/PostCSS/Shadcn/TypeScript/Vitest configuration and setup now live in `apps/drivebeats-web` (`@drivebeats/web`). Next dev also generated the app-local `AGENTS.md`; it remains with the app.
- `packages/drivebeats-core` (`@drivebeats/core`) is source-only and exports `/types`. Portable declarations/constants moved verbatim; web `src/types/index.ts` re-exports them and retains `AuthTokens` locally. No shared client or MCP App placeholders were created.
- Root remains private `drivebeats`, with one lockfile, workspace globs, repository-wide Biome, and unchanged Node 24 / pnpm 12.7.0 pins and `allowBuilds` entries. Root dev/start target web; root test/build check core before recursive package scripts, and lint runs Biome plus package typechecks. Failures propagate.
- Next remains 16.4.0, React/React DOM 19.3.0, and resolved TypeScript 7.0.2. Existing dependency specifiers and the external lockfile packages/snapshots are unchanged; only workspace importers changed.
- Turbopack and output tracing explicitly use the repository root. Core is listed in `transpilePackages`. The `react-native-fs` stub remains app-relative `./src/lib/empty-module.js`; a first build caught an incorrect repository-relative alias, which was corrected before the passing final build.
- Existing ignored `.env` and `.env.local` were copied to the app root, retaining the root originals. Copies were verified byte-identical without exposing values. Dev/build/start load the app files. `.worktreeinclude` now copies `apps/drivebeats-web/.env*`; `mise.local.toml` and `.vercel` stay at root. No remote secrets were exported.
- Nested dependencies, env, Next/generated types, coverage, and build output remain ignored. Database modules/services remain web-local; `db/migrations` is unchanged at root. Source/assets/config moves were compared against Git HEAD; only the intended type adapter and Next configuration changed.
- README/AGENTS/source links now describe the new layout. Dependabot scans root, apps, and packages with its original grouping/cooldown. Existing Test workflow, validation job, and automerge Vercel gates remain unchanged.
- Starting state was `main`, with an existing modified `GLOSSARY.md` and untracked MCP/research docs. Those contents were preserved apart from task status/execution notes and required research source-link repairs. The initial implementation involved no commit, push, deployment, or remote mutation. The user subsequently authorized the Vercel setting change and committing/pushing the migration to `main`; the pre-existing glossary edit remains outside the migration commit.
- Before publication, GitHub `main` had advanced to `c71ab9c` with dependency updates. Fast-forwarded to that commit and carried its exact versions into the relocated web manifest: `@base-ui/react` 1.9.0, `lucide-react` 1.55.0, and `@types/node` 26.6.5. The final external package/snapshot sections match that upstream lockfile byte-for-byte. Repeated frozen install (569 policy entries), root tests (272), lint/core typecheck, and build successfully after integration. Lint also reported a broken local `.claude/skills/web-design-guidelines` symlink; it was left untouched.

### Checks

| Acceptance | Result and evidence |
| --- | --- |
| Baseline checks | Root `pnpm test`: 29 files / 272 tests passed; `pnpm lint` passed; `pnpm build` passed before moves. |
| Frozen workspace install | Root `pnpm install --frozen-lockfile` passed for all three projects; resolution skipped, existing 568-entry supply-chain policy check passed. |
| Root tests and core | Final root `pnpm test` passed: core `tsc --noEmit`, then the same 29 web files / 272 tests. No tests added for moves. |
| Root lint | Final `pnpm lint` passed across workspace source and core typechecking. Existing Biome recommended-field deprecation and oversized logo warning remain. |
| Root build | Final `pnpm build` passed after the stub fix, including core and web TypeScript; original routes retained, 23 pages generated. Core constants resolve from web, and the built client chunk contains the shared constants. |
| Dev and production start | Root `pnpm dev --port 3100` and `pnpm start --port 3101` started successfully; both loaded `.env.local` and `.env`. Production rendered successfully in the browser. |
| Browser routes/layout | Codex in-app browser verified marketing rendering at 320px, 428px, and 1440px without horizontal overflow; signed-out `/app` returns to `/`; production privacy/imprint navigation renders; callback without state redirects and displays the existing sign-in error. No production browser console errors observed. |
| Routes/assets/security headers | Local production HTTP checks returned 200 for marketing/legal routes, `/sw.js`, `/theme-init.js`, favicon/icons, manifest icons, manifest and a screenshot asset. `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` remain. OAuth login returns the Google authorization redirect with client ID, state, nonce, `drive.file`, and the unchanged callback path; values were not logged. |
| Real Google sign-in/callback | **Unverified:** the local app was signed out in the verification browser; no Google login was completed. Redirect initiation and invalid-state handling do not establish successful sign-in. |
| Import/browse and filename Library Search | **Unverified:** require the real signed-in account and user-selected Drive items. Sources stayed unchanged; existing tests pass. |
| Play/pause/next/seek/shuffle | **Unverified:** no authenticated imported audio for the browser session. Existing player tests pass; audible playback was not claimed. |
| Playlist/favorite cross-session refresh | **Unverified:** no authenticated second session. Logout preserving cloud data and cloud deletion without Drive writes were not exercised. No schema or sync behavior changed. |
| Repository preservation | `git diff --check` passed; SQL history unchanged; env/generated paths verified ignored; research source links resolve and GitHub YAML parses. |

Playwright CLI could not launch Chrome within the shell sandbox; browser verification used the Codex in-app browser instead. Temporary viewport overrides were reset and test servers stopped after verification.

### Hosting readiness

Read-only inspection confirmed the linked project is `drivebeats`, owned by Fabian Dietenberger's projects. Initial project settings: `rootDirectory=null` (repository root), `buildCommand=null`, `installCommand=null`, `outputDirectory=null`, `framework=nextjs`, `nodeVersion=24.x`, `sourceFilesOutsideRootDirectory=true`.

On explicit user approval, applied **Root Directory → `apps/drivebeats-web`** using the existing helper in `docs/vercel-access.md`:

```bash
vc project update drivebeats --root-directory apps/drivebeats-web --yes
```

The CLI reported only `rootDirectory` changed. An independent GET of `/v9/projects/drivebeats` then verified `rootDirectory=apps/drivebeats-web`, `buildCommand=null`, `installCommand=null`, `outputDirectory=null`, `framework=nextjs`, `nodeVersion=24.x`, and `sourceFilesOutsideRootDirectory=true`. Automatic build/install/output detection and shared-workspace inclusion remain enabled. No secrets were exported.

Root Directory is a project setting, not a `vercel.json` property. Official sources checked: [build configuration](https://vercel.com/docs/builds/configure-a-build), [monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq), and [monorepos](https://vercel.com/docs/monorepos). Hosting configuration is ready for the migration; deployed behavior still requires checking a deployment of the pushed commit and the real-account flows above.
