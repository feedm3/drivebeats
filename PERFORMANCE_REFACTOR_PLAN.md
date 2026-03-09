# Performance Refactor Plan

## Goals

- High runtime performance in the browser
- Cheap hosting and predictable infrastructure cost
- Maintainable, readable code with reliable quality gates

## Review Summary

The current implementation is functionally in decent shape, but several structural issues will become more expensive as the app grows:

- A playback correctness bug exists around cached folder navigation and access token handling.
- Folder loading and token refresh logic can issue duplicate requests.
- The authenticated app is heavily client-driven, including auth gating.
- Some Zustand subscriptions are broader than necessary, causing avoidable rerenders.
- Folder navigation and tree logic are duplicated across multiple components.
- The lint/tooling baseline is currently not reliable.

## Refactor Priorities

### 1. Fix playback token handling on cached folders

Why:

- This is a correctness issue in the hot path, not just cleanup.
- Cached folder renders can leave `FileList` with an empty access token.
- That can cause track playback to fail after navigating into already-cached folders.

Target areas:

- `src/hooks/use-folder-contents.ts`
- `src/components/file-browser.tsx`
- `src/components/file-list.tsx`
- `src/stores/player-store.ts`

Suggested direction:

- Remove `accessToken` as UI state from `FileBrowser`.
- Resolve the token closer to playback initiation, ideally inside a player action or a dedicated playback service.
- Alternative: return `{ files, token }` from the shared folder-loading layer so token availability is explicit and consistent.

Success criteria:

- Playing a file works both after a fresh folder fetch and after rendering from cache.
- No UI component depends on a stale token snapshot.

### 2. Deduplicate in-flight Drive fetches and auth refreshes

Why:

- The app can currently make duplicate `root` and folder requests.
- Concurrent token refreshes also appear possible.
- This increases quota usage, serverless work, and latency.

Target areas:

- `src/hooks/use-folder-contents.ts`
- `src/stores/folder-cache-store.ts`
- `src/stores/auth-store.ts`
- `src/components/folder-tree.tsx`
- `src/components/file-browser.tsx`

Suggested direction:

- Add promise-level deduplication for folder fetches via `Map<string, Promise<DriveFile[] | null>>`.
- Add deduplication for token refreshes via a single shared pending refresh promise.
- Consider separating cache entries into `data`, `fetchedAt`, and `pendingPromise`.

Success criteria:

- Loading the same folder from multiple surfaces triggers only one network request.
- Concurrent auth refresh attempts collapse into one request.

### 3. Move auth gating to the server boundary

Why:

- The app route currently renders a client shell first and authenticates later.
- That adds unnecessary JS work and slows first useful render for unauthenticated traffic.
- Server-side gating is cleaner and easier to maintain.

Target areas:

- `src/app/(app)/layout.tsx`
- `src/app/(app)/app/page.tsx`
- `src/components/auth-guard.tsx`
- auth cookie/session utilities

Suggested direction:

- Read auth session on the server in the `(app)` segment.
- Redirect unauthenticated requests before hydrating the app shell.
- Keep only truly interactive parts in client components.

Success criteria:

- Unauthenticated users are redirected server-side.
- The authenticated app page is thinner and less dependent on client bootstrap logic.

### 4. Narrow Zustand subscriptions for hot UI paths

Why:

- `currentTime` updates frequently during playback.
- Components subscribing to whole stores rerender more often than needed.
- This is a straightforward win for UI smoothness.

Target areas:

- `src/components/player/progress-bar.tsx`
- `src/components/player/play-controls.tsx`
- `src/components/player/volume-control.tsx`
- `src/components/folder-tree.tsx`
- `src/components/folder-filter-dialog.tsx`

Suggested direction:

- Replace whole-store reads with field-level selectors.
- Avoid destructuring `usePlayerStore()` / `useFolderFilterStore()` without selectors.
- Derive stable booleans and IDs outside heavy list rendering when possible.

Success criteria:

- Progress updates do not rerender unrelated player controls.
- Large tree/sidebar views rerender only when their relevant state changes.

### 5. Unify folder navigation state and browser history handling

Why:

- Folder navigation logic is duplicated between the app page and `FileBrowser`.
- Both manage history and `popstate`, which increases complexity and bug risk.
- This makes desktop/mobile behavior harder to reason about.

Target areas:

- `src/app/(app)/app/page.tsx`
- `src/components/file-browser.tsx`
- `src/lib/utils.ts`

Suggested direction:

- Introduce a single navigation hook or store for folder stack state.
- Centralize history syncing in one place.
- Make desktop and mobile read from the same navigation model.

Success criteria:

- One source of truth for folder stack and history integration.
- No duplicated `popstate` management.

### 6. Consolidate folder tree logic

Why:

- The folder tree and filter dialog both implement recursive tree loading and rendering.
- This is mainly maintainability debt today, but it will slow future feature work.

Target areas:

- `src/components/folder-tree-node.tsx`
- `src/components/folder-filter-dialog.tsx`

Suggested direction:

- Extract shared tree-loading logic into a hook or service.
- Reuse common recursion, cache sync, and child-loading logic.
- Keep rendering concerns separate from data traversal concerns.

Success criteria:

- Recursive folder loading behavior is implemented once.
- Tree-related changes do not need parallel fixes in two components.

### 7. Repair the linting/tooling baseline

Why:

- `npm run lint` is currently failing due to Biome configuration drift.
- That removes an inexpensive safety net for maintainability.

Target areas:

- `biome.json`
- Tailwind/Biome parsing config

Suggested direction:

- Update the Biome schema version to match the installed CLI.
- Enable Tailwind directive parsing support.
- Re-run lint and fix real issues after config noise is removed.

Success criteria:

- `npm run lint` runs successfully and can be used as a reliable gate.

### 8. Improve build and hosting ergonomics

Why:

- Cheap hosting depends on predictable output and small operational complexity.
- The app does not currently use `output: "standalone"`.
- Build success currently depends on remote font availability.

Target areas:

- `next.config.ts`
- `src/app/layout.tsx`
- font assets/config

Suggested direction:

- Add `output: "standalone"` if self-hosting is planned.
- Consider switching from remote Google font fetches to local fonts.
- Keep analytics and third-party code minimal and deferred.

Success criteria:

- Production builds are robust in restricted environments.
- Self-hosting setup is simpler and cheaper.

## Recommended Execution Order

1. Fix playback token handling bug.
2. Deduplicate folder and auth requests.
3. Narrow Zustand subscriptions in the player and sidebar.
4. Move auth gating to the server boundary.
5. Unify folder navigation state/history.
6. Consolidate tree logic.
7. Repair lint/tooling.
8. Improve hosting/build ergonomics.

## Verification Checklist

After each phase:

- Run `npm run build`
- Run `npm run lint`
- Run `npx -y react-doctor@latest . --verbose --diff`
- Manually test:
  - sign-in flow
  - cached folder navigation
  - playback start from folder and playlist views
  - next/previous/shuffle/repeat
  - folder filter behavior
  - desktop/mobile navigation consistency

## Current Verification Snapshot

- `npm run build`: passed
- `npx -y react-doctor@latest . --verbose --diff`: `90/100`, 1 error, 25 warnings
- `npm run lint`: failing because Biome config is out of sync and Tailwind directives are not configured for parsing
