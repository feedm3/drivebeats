# iOS PWA offline-download reliability implementation plan

Status: ready for implementation

Prepared: 2026-07-29

Repository: `/Users/fabdie/IdeaProjects/private/drivebeats`

Target branch at handover: `main`

## Instructions for the implementing agent

Implement this plan, not a looser interpretation of it.

Before editing:

1. Read `/Users/fabdie/IdeaProjects/private/AGENTS.md`.
2. Read this repository's `AGENTS.md`.
3. Read this plan completely.
4. Read
   [`docs/research/ios-pwa-reliability-2026-07-29.md`](../research/ios-pwa-reliability-2026-07-29.md).
5. Check the current branch, worktree status, and recent history. Preserve all
   unrelated user changes.
6. Before each Next.js change, read the relevant current documentation under
   `node_modules/next/dist/docs/`, as required by the repository guide.
7. Use `pnpm`.

The lead agent must use subagents. Follow the ownership and integration model in
[Subagent execution plan](#subagent-execution-plan). Do not let agents edit
overlapping files concurrently. The lead agent remains responsible for reading
every diff, reconciling interfaces, running the complete verification suite, and
reporting anything that could not be verified on a real iPhone.

Do not commit, push, deploy, or open a pull request unless the user explicitly
asks for it.

## Outcome

DriveBeats must treat iOS suspension, process loss, network changes, and
IndexedDB interruption as ordinary lifecycle events.

The user-facing contract after this work is:

> Pending offline downloads resume automatically whenever DriveBeats is active
> and online. iOS may pause work while the app is backgrounded or closed, but
> returning to the app reconciles stored files and continues safely.

The reported `21/24 downloaded` state must never remain inert:

- a missing track is queued and attempted;
- a transient problem is visibly waiting or retryable;
- a permanent problem has a visible reason and recovery action;
- a storage problem explains what the user can do;
- the app never claims that iOS will continue a playlist-sized download in the
  background.

## Scope

### Required

- Eliminate the recovery/cloud-sync race that can erase newly queued favorite
  statuses.
- Make the queue drain work added during an existing run.
- Bound network, response-body, and IndexedDB phases with deadlines.
- Reconcile and resume on launch, foreground visibility, `pageshow`, cloud
  library updates, and `online`.
- Make cancellation operation-scoped so removing and re-enabling downloads in
  one app lifetime works.
- Reopen IndexedDB after abnormal connection termination.
- Classify failures and expose actionable retry/removal/storage UI.
- Request and report persistent-storage status without claiming it was granted
  when it was not.
- Keep a bounded, sanitized, device-local diagnostic trail that can be exported
  for iPhone debugging without OAuth tokens, audio, filenames, or raw API bodies.
- Preserve the existing read-only Google Drive access policy.
- Ensure service-worker runtime cache writes complete within their fetch-event
  lifetime.
- Bound service-worker IndexedDB open/read operations so an offline media request
  fails predictably instead of hanging forever.
- Add direct regression tests for the download manager and UI behavior.
- Manually verify the affected flows in a real browser, and document the iPhone
  cases that still require physical-device verification.

### Explicitly out of scope for this implementation

- Moving the queue into `public/sw.js`.
- Pretending Background Sync or Background Fetch exists on iOS.
- A native iOS wrapper or `URLSession` background download implementation.
- Chunked/range-resumable storage, OPFS migration, or changing the existing
  stored-audio schema from one complete Blob per track.
- Optional Screen Wake Lock.
- Web Locks/cross-context queue ownership. This is a lower-priority follow-up
  after the single-context queue is self-healing; do not let a suspended context
  hold a lock that blocks the visible PWA.
- Uploading, modifying, moving, renaming, trashing, deleting, or changing
  permissions on Google Drive files.
- A broad rewrite of playback, cloud sync, authentication, or the service-worker
  cache topology.

Those larger options may be evaluated after the foreground queue is proven
self-healing. Google Drive byte-range support makes resumable chunks possible,
but it is not needed to fix the current `21/24` failure.

## Verified current state

The following findings are established by the current source, not assumptions.

### Exact failure modes

1. `recoverOfflineState()` captures `trackedFileIds`, awaits an IndexedDB scan,
   then replaces the entire `trackStatus` map from the captured IDs. If cloud
   sync adds three favorites during the scan, the collection can contain 24 IDs
   while the new statuses disappear. This is a strong code-level match for
   `21/24`.
2. `runQueue()` snapshots eligible IDs once. If cloud sync or another caller
   queues work during the run, `processQueue()` only returns the existing
   `queuePromise`; it does not request a second drain.
3. A Drive fetch, `Response.blob()`, token refresh, or IndexedDB operation can
   remain unresolved without a deadline. A stuck `queuePromise` then blocks all
   future queue starts in that JavaScript realm.
4. Recovery runs once during `initOfflineSync()`. The queue listens for
   `online`, but not visible `visibilitychange` or `pageshow`.
5. `stopCollectionDownload()` leaves module-level cancellation markers for
   already-downloaded IDs. Those markers are not consumed by the active queue,
   so a later re-enable can skip the first attempt and leave the track queued.
6. The partial collection button calls `stopCollectionDownload()`. At `21/24`,
   the primary control removes/stops instead of retrying.
7. Storage estimation produces only a console warning. Persistent mode is not
   requested or displayed, and `QuotaExceededError` is not actionable.
8. `offline-db.ts` memoizes one `openDB()` promise and has no `terminated`
   callback or reset path.
9. Runtime service-worker cache writes are detached from the `FetchEvent`
   lifetime.
10. There is no direct test suite for `offline-download-manager.ts`. The current
    134 tests pass, but they do not exercise these races.

### Existing behavior to preserve

- Offline audio blobs remain in IndexedDB.
- Offline playback continues through same-origin `/offline-media/:fileId`
  responses with byte-range support.
- The session media cache survives service-worker activation.
- Shell caches remain generation-scoped.
- Immutable Next.js assets remain cross-generation and cache-first.
- Service-worker swaps remain deferred while audio is playing.
- Cloud favorites and playlists remain Neon-synced.
- Imported Drive folders, recently played state, player state, and offline
  downloads remain device-local.
- Logging out clears local device data without deleting cloud data.
- Transient token-refresh failures do not sign the user out.

## Design: one deep offline-download module

Keep the queue behind one small interface. React components and cloud-sync code
must not learn queue internals such as leases, retries, IndexedDB reconnection,
timeouts, or lifecycle generations.

The module's external seam should expose no more than:

```ts
export interface OfflineDownloadManager {
  start(): () => void;
  ensureCollectionAvailableOffline(collectionId: string): Promise<void>;
  retryDownloads(collectionId?: string): Promise<void>;
  removeCollectionDownloads(collectionId: string): Promise<void>;
  removeAllDownloads(): Promise<void>;
}
```

The exact TypeScript shape may remain exported functions if that avoids noisy
call-site churn. The interface semantics are mandatory:

- `start()` is idempotent, installs lifecycle/store subscriptions once, starts
  reconciliation, and returns cleanup for listeners/subscriptions.
- `ensureCollectionAvailableOffline()` is idempotent. It enables a collection
  if necessary, refreshes membership from the current collection source,
  reconciles stored bytes, and requests a drain.
- `retryDownloads()` clears only retryable/manual-blocked failures for the
  selected collection, or for all enabled collections when no ID is supplied,
  and requests one drain. It never deletes completed blobs. The Storage & data
  dialog uses the no-ID form; collection UI passes an ID.
- `removeCollectionDownloads()` removes collection intent and only deletes a
  blob when its reference count reaches zero.
- `removeAllDownloads()` aborts the current generation, clears local offline
  intent and bytes, and leaves no old worker able to write state into the new
  generation.

Do not expose `processQueue()`, `recoverOfflineState()`, retry counters, or
`AbortController`s to UI callers.

### Dependency classification and internal seams

The external seam above is the production/test surface. Internally, use
dependencies that can be replaced in tests:

| Dependency | Category | Production adapter | Test adapter |
| --- | --- | --- | --- |
| Google Drive | True external | Existing authenticated `google-api.ts` functions | Deterministic mock with controllable responses/hangs |
| IndexedDB | Local-substitutable | `offline-db.ts` using `idb` | In-memory adapter or mocked module with controllable completion |
| Clock/timers | In-process | `Date.now`, `setTimeout`, abort timer | Vitest fake timers / injected clock |
| Lifecycle events | In-process browser adapter | `window`/`document` listeners | Fake lifecycle emitter |
| Zustand projection | In-process | `offline-store.ts` | Fresh store/reset helper per test |

Keep these as internal seams. UI code should not receive adapters or scheduler
details.

## State model and invariants

### Three kinds of state

1. **Desired state:** enabled collections, current collection membership, and
   reference counts. Persist this so relaunch knows what the user wants offline.
2. **Observed state:** complete audio records actually present in IndexedDB.
   This is authoritative for whether a track is downloaded.
3. **Runtime/job state:** queued, active phase, failure category, retry timing,
   and progress metadata used by the current app realm and UI.

Do not treat a previously persisted `"downloading"` value as evidence that work
is active. At hydration/reconciliation it becomes queued unless a complete
IndexedDB record exists.

### Required invariants

1. A track is `"downloaded"` only after a complete IndexedDB write has committed.
2. A collection's `downloadedCount` is derived from current membership plus
   actual/reconciled track status; it is not independently trusted.
3. No async recovery result may replace state using IDs captured before its
   awaited work.
4. Queue work added during a drain is processed before the manager becomes idle,
   unless it is deliberately deferred by retry timing or a permanent error.
5. A run generation that was aborted or superseded cannot write status into the
   current generation.
6. Cancellation applies to a collection operation/generation, not permanently
   to a file ID.
7. One failed track cannot reject or permanently occupy the global queue.
8. A permanent 4xx, quota failure, or missing file cannot hot-loop.
9. A transient network failure may be retried with capped exponential backoff
   and jitter, but timers are only an optimization; launch/resume reconciliation
   remains sufficient after suspension.
10. A file shared by two enabled collections is downloaded once and deleted only
    after both references are removed.
11. If track metadata is temporarily absent because cloud sync has not hydrated,
    the job remains pending; it is not silently discarded.
12. An empty or unhydrated cloud-store projection cannot erase persisted offline
    collection intent or membership. Replace membership only after the relevant
    favorites/playlists store is authoritative.
13. Every listener/subscription installed by `start()` has a cleanup path, and a
    React development Strict Mode mount-cleanup-remount cycle installs exactly
    one live set of listeners.
14. Queue scheduling waits while authentication is unknown or a transient
    refresh failure/cooldown is active. Only an authoritative unauthenticated
    state is labeled `auth-required`.
15. A transition to an authenticated state or a newly usable access token
    requests a drain without requiring collection membership to change.

### Suggested track job projection

Prefer a structured job record over parallel maps:

```ts
type OfflineDownloadPhase =
  | "idle"
  | "authorizing"
  | "fetching"
  | "reading"
  | "storing";

type OfflineDownloadErrorCategory =
  | "network"
  | "timeout"
  | "auth-required"
  | "access-denied"
  | "missing-file"
  | "rate-limited"
  | "server"
  | "storage-full"
  | "storage-unavailable"
  | "integrity"
  | "unknown";

interface OfflineTrackJob {
  status: "queued" | "downloading" | "downloaded" | "failed" | "updating";
  phase: OfflineDownloadPhase;
  attempt: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  errorCategory?: OfflineDownloadErrorCategory;
}
```

Compatibility options:

- Migrate persisted Zustand state with a versioned `migrate` function; or
- keep `trackStatus` as a derived compatibility projection while introducing a
  `trackJobs` map.

Whichever option is chosen, old persisted data must load without throwing, and
old `"downloading"`/`"updating"` entries must normalize safely.

Do not introduce a SQL migration. Offline state is device-local.

## Queue algorithm

### Reconcile-and-drain entry point

All triggers call one internal operation, for example:

```ts
requestDrain(reason: DrainReason): Promise<void>
```

Required triggers:

- initial `start()`;
- visible `visibilitychange`;
- `pageshow`;
- `online`;
- a collection being enabled/retried;
- playlist or favorites membership changing;
- successful cloud-library payload application;
- authentication becoming ready or a usable token becoming available after a
  transient refresh failure;
- a retry timer while the document remains visible;
- IndexedDB connection recovery.

`focus` may be an additional idempotent trigger, but it must not be the only iOS
resume signal.

### Single-flight behavior

`requestDrain()` must not merely return an old promise.

Use a requested-again flag/counter:

1. Mark a drain requested.
2. If a drain is active, return the active promise.
3. The active runner loops:
   - consume the request flag;
   - reconcile desired membership with IndexedDB;
   - process all currently eligible jobs;
   - repeat if another request arrived or reconciliation found new eligible work.
4. Exit only when there is no requested rerun and no currently eligible work.
5. Release the active promise in `finally`.

Do not repeatedly select a failure whose `nextAttemptAt` is in the future or
whose category requires user action.

### Lifecycle generations

Maintain an increasing generation ID and a generation-scoped
`AbortController`.

- Initial start creates generation 1.
- Visible resume while an old run is unresolved aborts/supersedes that
  generation, reconciles actual IndexedDB records, and requests a new drain.
- Removing all downloads supersedes the current generation before clearing
  storage.
- Every async phase checks that its captured generation is still current before
  updating Zustand.
- A stale operation may finish at the browser/storage level, but reconciliation
  makes the committed IndexedDB record authoritative.

Abort/cancellation causes must remain distinct:

- **Timeout:** classify as retryable `timeout`, consume the appropriate attempt,
  and apply backoff.
- **Lifecycle supersession:** do not render an error or consume an attempt; the
  new generation reconciles it back to downloaded or queued.
- **Collection/remove-all cancellation:** remove the job/intent as requested and
  never schedule a retry or write a failure.

Do not rely on `pagehide`, `beforeunload`, or `unload` to save correctness.

### Timeouts

Use explicit, named constants, with values justified in comments and tests.
Suggested starting values:

- token/metadata request: 15 seconds;
- media response headers: 30 seconds;
- media body consumption: size-aware where possible, otherwise 120 seconds;
- IndexedDB open/read/write: 15 seconds.

The implementing agent may adjust values after inspecting typical track sizes.
The architectural requirement is that every phase settles or times out.

Compose caller cancellation and timeout cancellation without depending on only
the newest AbortSignal helpers. Clear every timeout in `finally`.

Token refresh currently has no signal. Extend the auth refresh fetch to use an
abortable timeout while preserving existing single-flight/cooldown and
authoritative-session semantics. Merely racing the queue's wait is insufficient:
the module-level refresh promise would remain wedged and every later caller would
adopt it.

When `getValidAccessToken()` returns `null`, inspect current auth state:

- `authStatus === "unauthenticated"` after an authoritative server rejection:
  pause as `auth-required`;
- `authStatus === "unknown"`, authenticated-without-token during bootstrap, or a
  transient refresh/cooldown failure: keep the job retryable/queued and wait for
  the auth-ready trigger; never tell the user to sign in based only on a
  transient null token.

### Retry classification

At minimum:

| Failure | Category | Automatic behavior | User action |
| --- | --- | --- | --- |
| Offline/network | transient | capped backoff; resume triggers retry | Retry now |
| Deadline abort | timeout | capped backoff; resume triggers retry | Retry now |
| Lifecycle supersession | control flow | new generation reconciles; no attempt consumed | None |
| Remove cancellation | control flow | remove intent/job; no retry | None |
| HTTP 408, 429 | transient | honor `Retry-After` when usable; capped backoff | Retry now |
| HTTP 5xx | transient | capped backoff | Retry now |
| HTTP 401 | auth | refresh once; then pause as auth-required | Sign in/retry |
| HTTP 403 | inspect response; usually permanent/access | no hot-loop | Check Drive access |
| HTTP 404 | permanent | no automatic retry | Remove missing track or retry |
| `QuotaExceededError` | storage-full | no automatic retry | Free/remove storage |
| IndexedDB connection/`UnknownError` | storage-unavailable | reset DB connection, bounded retry | Repair/retry |
| Blob size mismatch | integrity | bounded redownload | Retry |
| Unknown | unknown | one bounded retry, then stop | Retry and diagnostics |

Keep error data free of OAuth tokens, response bodies that may contain personal
data, and audio content.

### Integrity check

When Drive metadata includes the expected byte size:

- require the final Blob size to match before marking downloaded;
- delete/replace a mismatched temporary result;
- classify mismatch as integrity failure;
- keep the existing record until a replacement has committed successfully for
  an update.

Do not mark a track downloaded based only on an HTTP 2xx response.

### Concurrency

Keep concurrency as a small configurable internal value. For this pass:

- start with two concurrent tracks on all platforms, or one on iOS standalone
  and two elsewhere;
- document the choice;
- do not use three concurrent whole-file Blobs on iOS without measurement.

Correctness must not depend on the concurrency value.

## IndexedDB changes

Update `src/lib/offline-db.ts` so the database connection can recover:

- install `blocked`, `blocking`, and `terminated` callbacks supported by `idb`;
- close and clear the memoized database promise when the connection is no
  longer usable;
- allow the next operation to reopen the database;
- make transaction completion—not only the request result—the success signal;
- keep schema version 1 if no object-store shape changes are needed;
- if a schema version change is necessary, add a forward IndexedDB migration and
  keep `public/sw.js` compatible with both old and new records during rollout.

Decide explicitly what to do with `offline_collections`:

- either make it part of reconciliation as the authoritative desired-state
  store; or
- remove its unused read path in a later cleanup and document that persisted
  Zustand state owns collection intent.

For this reliability fix, avoid creating two competing authorities. The
recommended choice is:

- persisted Zustand: desired collection intent and job projection;
- IndexedDB `offline_tracks`: authoritative completed bytes;
- `offline_collections`: compatibility record only, written consistently but
  not used as a second source of truth.

## Lifecycle and cloud-sync integration

Replace the global one-way `initOfflineSync()` behavior with an idempotent start
that returns cleanup.

`AppShell` should install it in an effect and return cleanup:

```ts
useEffect(() => startOfflineDownloads(), []);
```

Make `start()` reference-counted:

- the first live caller installs subscriptions/listeners and requests initial
  reconciliation;
- later callers share that installation and increment a live-caller count;
- each returned cleanup is idempotent and decrements once;
- the last cleanup removes listeners/subscriptions, clears retry timers, and
  aborts realm-owned work;
- a later fresh `start()` installs one new set and requests one initial drain.

This gives React Strict Mode's setup-cleanup-setup sequence deterministic
behavior without a permanent module-level `subscribed` flag.

The manager's `start()` owns subscriptions to playlist, favorites, cloud
hydration, and auth readiness. A successful remote payload changes the
authoritative hydrated stores; the manager observes the signature/hydration
change and requests a drain. No queue-specific notification method or browser
event is exposed to cloud-sync callers.

The offline manager still owns the membership diff. Cloud sync only announces
authoritative state by updating the existing stores.

At startup, preserve the desired membership already persisted for offline use.
Do not treat `isCloudHydrated === false` or a temporarily absent playlist as an
authoritative empty collection. Once a successful cloud payload is applied, the
manager may replace membership from the hydrated source and queue additions or
remove references accordingly. When offline hydration cannot complete, existing
desired membership and downloaded bytes must remain usable.

Avoid a circular import between the cloud-sync runner and offline manager. Do
not import the manager from the cloud-sync runner. Prove the store-subscription
startup race and post-hydration drain in regression tests.

## Storage persistence and capacity

On the user gesture that first enables an offline collection:

1. Feature-detect `navigator.storage.persisted` and `persist`.
2. Check current persistence.
3. If not persistent, request it.
4. Record the actual boolean result as
   `granted`, `not-granted`, or `unsupported`; do not infer success from a
   resolved promise.
5. Keep downloading when persistence is not granted if capacity is sufficient,
   but explain that iOS may reclaim downloads under storage pressure.

Before a batch:

- estimate incremental bytes, excluding already-downloaded/shared tracks;
- compare against estimated remaining quota;
- show a warning or block when clearly insufficient;
- still catch `QuotaExceededError` because the estimate is not a reservation.

Update the Storage & data dialog to show:

- downloaded tracks and bytes;
- browser usage/quota estimate when available;
- offline storage protection status;
- actionable storage-full help;
- Retry failed downloads;
- Remove all downloads.

## Local diagnostics

Add a small device-local diagnostic module for the queue. This is not remote
analytics and must never send diagnostics automatically.

Keep a ring buffer of at most 100 events and cap serialized storage to a small
document (for example 64 KiB). Clear it with local app data/logout.

Allowed fields:

- timestamp and app build/version when available;
- iOS/standalone capability flags without a full fingerprint;
- document visibility and lifecycle trigger;
- a non-reversible short local track key, not the raw Drive file ID or filename;
- generation, attempt, phase, elapsed milliseconds, HTTP status class, Blob
  byte size, normalized error name/category, and outcome;
- storage persistence status and usage/quota estimates.

Forbidden fields:

- OAuth/access/refresh tokens, cookies, request authorization headers;
- audio content, Blob bytes, filenames, folder names, email, user name;
- raw Google API response bodies or unrestricted stack dumps.

Expose **Copy download diagnostics** or **Export download diagnostics** from the
Storage & data dialog. The user initiates export. Use a JSON or text payload that
can be attached to a bug report, and show when the buffer is empty.

Tests must prove the ring bound, sanitization/allowlist, local-data cleanup, and
that raw file IDs/tokens supplied in an error cannot appear in exported output.

## UI behavior

### Collection control

Use separate actions:

- Not enabled: **Download for offline**.
- Enabled and complete: **Remove downloads** with confirmation.
- Enabled and queued/downloading: show progress; primary action may be
  **Pause/Stop** only if pause semantics are implemented without deletion.
- Enabled and incomplete but idle/failed: **Resume/Retry downloads**.
- Permanent failure: show count and a discoverable explanation.

Do not overload the same tap target to silently delete completed files when the
collection is incomplete.

### Per-track state

Preserve compact icons, but distinguish:

- queued/waiting;
- actively downloading;
- downloaded;
- retryable failure;
- action-required failure.

Expose an accessible label and title with the normalized reason. Never expose a
Google access token or raw private API response.

### Honest foreground limitation

While a batch is active, show concise copy such as:

> Downloads continue while DriveBeats is open. iOS may pause them in the
> background; they will resume when you return.

Do not show this permanently once all downloads finish.

## Service-worker lifetime repair

Runtime cache writes/revalidation in `public/sw.js` must be associated with the
fetch-event lifetime.

Implementation constraints:

- do not move media queue ownership into the service worker;
- preserve generation-scoped shell caches and the shared immutable asset cache;
- preserve the session media cache across activation;
- ensure cache write promises are awaited by the response path or registered
  synchronously with `event.waitUntil()`;
- avoid calling `event.waitUntil()` for the first time from a later async task;
- preserve network-first navigation and cache-first immutable asset behavior;
- preserve stale-while-revalidate for mutable static assets.

Also bound the raw service-worker IndexedDB path used by
`/offline-media/:fileId`:

- bound database open and record read;
- close a late-opened connection when practical;
- return a controlled 503 for a storage timeout/unavailable database and 404
  only when a completed read proves the record is absent;
- never leave the media fetch unresolved indefinitely;
- keep valid full and Range responses unchanged.

Because `public/sw.js` is static and explicitly requires a version bump:

- bump `SHELL_CACHE_VERSION`;
- update the mirrored constants/tests in `src/lib/sw-cache.test.ts`;
- add a worker-like runtime harness that evaluates the actual `public/sw.js`,
  captures registered handlers, and proves `respondWith()`/`waitUntil()`
  behavior against that script;
- do not satisfy the new lifecycle tests by copying the production handler into
  another simulator—the existing mirrored helper tests may remain for focused
  cache topology, but at least one direct harness must exercise the real worker;
- do not delete the previous usable shell before the new install is complete.

## File-level change map

The implementing agent may adjust filenames if the final interface is cleaner,
but every responsibility must have one owner.

| File | Expected responsibility |
| --- | --- |
| `src/lib/offline-download-manager.ts` | Deep manager interface, reconciliation, generations, drain loop, retry classification |
| `src/lib/offline-download-manager.test.ts` | Race, lifecycle, timeout, cancellation, ref-count, and classification tests |
| `src/lib/offline-db.ts` | Reopenable IDB connection and authoritative completed-record operations |
| `src/lib/offline-db.test.ts` | Connection termination, transaction completion, and retry tests |
| `src/stores/offline-store.ts` | Structured job projection, persistence migration/normalization, derived progress |
| `src/stores/offline-store.test.ts` | Migration and invariant tests |
| `src/stores/auth-store.ts` | Abortable refresh deadline while preserving session verdict semantics |
| `src/stores/auth-store.test.ts` | Hung/transient/authoritative refresh regressions |
| `src/components/app-shell.tsx` | Start/cleanup lifecycle integration only |
| `src/components/playlist-view.tsx` | Separate retry/resume and remove behavior |
| `src/components/playlist-view.test.tsx` | Retry versus remove behavior |
| `src/components/playlist-track-item.tsx` | Accessible per-track error state |
| `src/components/storage-dialog.tsx` | Persistence/quota/error/retry UI |
| `src/components/storage-dialog.test.tsx` | Global retry, persistence, quota, and diagnostics behavior |
| `src/lib/storage-persistence.ts` (optional) | Small feature-detected storage helper if it earns locality |
| `src/lib/offline-download-diagnostics.ts` | Bounded sanitized local diagnostic ring/export |
| `src/lib/offline-download-diagnostics.test.ts` | Retention, sanitization, and cleanup tests |
| `public/sw.js` | Event-lifetime-safe runtime cache writes; version bump |
| `src/lib/sw-cache.test.ts` | Cache lifecycle regression tests |
| `src/lib/sw-runtime.test.ts` (recommended) | Worker-like harness that executes actual `public/sw.js` |
| `docs/research/ios-pwa-reliability-2026-07-29.md` | Evidence only; update only if implementation invalidates an assessment |

Do not put queue logic into React components.

## Implementation phases

Each phase must end with tests passing before the next begins.

### Phase 0: baseline, behavior-neutral test seam, and reproducible failures

- [ ] Re-read current Next.js documentation relevant to client effects, route
      caching, manifest/PWA behavior, and service workers.
- [ ] Run and record:
      - `pnpm lint`
      - `pnpm test`
      - `pnpm build`
- [ ] Make a behavior-neutral extraction/factory that establishes the external
      manager interface and injects the internal Drive/IndexedDB/clock/lifecycle
      adapters. Preserve current production behavior at this step.
- [ ] Run the existing suite to prove the seam extraction is green.
- [ ] Freeze that interface for Subagent A and launch its failing-test work.
- [ ] Add direct failing tests for:
      - recovery scans 21 old IDs while cloud sync adds three;
      - new work arrives while a queue is active;
      - a media fetch never settles;
      - remove then re-enable in the same realm;
      - visible resume while nominally online;
      - queued ID temporarily lacks cloud metadata.
- [ ] Confirm each new test fails for the expected current behavior, not because
      of a broken mock.

### Phase 1: self-healing deep manager

- [ ] Implement the requested-again drain loop.
- [ ] Implement lifecycle generations and stale-write guards.
- [ ] Merge recovery against live desired state.
- [ ] Make missing metadata remain pending.
- [ ] Normalize persisted active states to queued.
- [ ] Preserve ref-count semantics.
- [ ] Make start/cleanup idempotent.

### Phase 2: deadlines, retry policy, and IDB recovery

- [ ] Add phase deadlines and composed cancellation.
- [ ] Preserve auth refresh single-flight/cooldown behavior.
- [ ] Classify network, HTTP, auth, storage, integrity, and unknown failures.
- [ ] Add capped backoff with no hot loops.
- [ ] Add IndexedDB connection reset/reopen behavior.
- [ ] Verify transaction completion before downloaded status.
- [ ] Add Blob-size integrity check when expected size exists.
- [ ] Reduce/document concurrency.
- [ ] Add auth-ready scheduling and distinguish transient token unavailability
      from authoritative unauthenticated state.
- [ ] Bound the auth refresh fetch itself so its single-flight promise settles.

### Phase 3: storage persistence and user recovery

- [ ] Request/check persistent storage from the enable-download user gesture.
- [ ] Persist/display the actual result.
- [ ] Calculate incremental capacity rather than whole-collection double counts.
- [ ] Add actionable quota and storage-unavailable states.
- [ ] Separate Retry/Resume from Remove.
- [ ] Add Retry failed downloads to Storage & data.
- [ ] Add honest foreground limitation copy.
- [ ] Add the bounded sanitized local diagnostic ring and user-initiated export.
- [ ] Verify every interactive target remains at least 44×44 CSS pixels on
      320–428 px viewports.

### Phase 4: service-worker event lifetime

- [ ] Bind navigation/static cache writes to fetch-event lifetime.
- [ ] Bound service-worker IndexedDB open/read for offline media.
- [ ] Bump the shell cache version.
- [ ] Update mirrored cache-topology tests and add a harness that executes the
      actual `public/sw.js`.
- [ ] Preserve update-during-playback behavior.

### Phase 5: integration and cleanup

- [ ] Remove obsolete exported queue entry points and unused global listeners.
- [ ] Remove or document duplicate/inert state paths.
- [ ] Ensure logout/remove-all supersedes old generations.
- [ ] Inspect every changed file and every subagent diff.
- [ ] Run the full automated suite and browser verification.
- [ ] Document remaining physical-iPhone checks honestly.

## Required automated tests

Tests should cross the offline-download manager's external seam. Avoid copying
production algorithms into tests.

### Queue and recovery

1. **Cloud additions survive recovery**
   - Start with 21 enabled/downloaded favorite IDs.
   - Hold the IndexedDB scan unresolved.
   - Apply cloud favorites containing 24 IDs.
   - Resolve the scan.
   - Assert all 24 remain tracked, 21 are downloaded, and three are attempted.
2. **Drain processes work added during a run**
   - Hold one Drive request.
   - Add another queued ID and request a drain.
   - Resolve the first request.
   - Assert the second runs without a third external trigger.
3. **Hung request self-heals**
   - Never resolve a media request.
   - Advance fake time through the deadline.
   - Assert timeout classification, released queue ownership, and successful
     retry on resume.
4. **Foreground resume**
   - Simulate hidden/visible and `pageshow`.
   - Assert stale active work is superseded, IndexedDB is reconciled, and missing
     bytes are queued.
5. **Missing metadata**
   - Queue an ID before its cloud track is available.
   - Assert it remains pending.
   - Apply cloud data and assert it downloads.
6. **Unhydrated cloud state preserves intent**
   - Start with persisted enabled membership and completed bytes.
   - Expose an unhydrated/temporarily empty favorites or playlists store.
   - Assert membership and blobs are not removed.
   - Apply an authoritative cloud payload and assert its additions/removals are
     reconciled.
7. **Strict Mode lifecycle**
   - Start, clean up, and start the manager again.
   - Assert only one listener/subscription set and one initial drain remain.
   - Call `start()` twice, clean up one caller, and assert the second remains
     active; clean up the second and assert listeners and retry timers are gone.

### Cancellation and reference counts

8. Remove a complete collection and re-enable it in the same realm; all tracks
   download again without a reload.
9. Remove one of two collections referencing a track; the blob remains.
10. Remove the last reference during an active download; the stale generation
   cannot restore status after deletion.
11. Remove all downloads during a run; no old completion repopulates Zustand or
   playback cache.

### Failure behavior

12. 401 refreshes once; a successful refresh continues.
13. A transient refresh failure leaves the job retryable; a later auth/token
    state change resumes it without collection membership changing.
14. A never-settling auth refresh fetch times out, clears its single-flight
    promise, and permits a later successful refresh.
15. Authoritative invalid session becomes action-required without a hot loop.
16. 404 is permanent and visible.
17. Google 403 `rateLimitExceeded` is retryable while permission-denied is
    action-required.
18. `Retry-After` is parsed when valid, capped to the configured maximum, and
    ignored safely when malformed.
19. 429/5xx uses bounded retry timing.
20. Timeout, lifecycle supersession, and removal aborts produce respectively a
    retryable failure, a queued/reconciled job without an attempt, and no job.
21. `QuotaExceededError` is not automatically retried and exposes storage help.
22. Never-settling IndexedDB open, read, and write phases time out without
    permanently occupying queue ownership.
23. IndexedDB termination clears the memoized connection and the next operation
    reopens.
24. Blob-size mismatch never marks downloaded.
25. Unknown failures eventually settle as failed and release the queue.

### Persistence and migration

26. Existing persisted collections/statuses migrate without data loss.
27. Persisted `"downloading"` and `"updating"` normalize to queued when no
    complete record exists.
28. A real IndexedDB record overrides stale local `"queued"`/`"failed"` status.
29. Persisted `nextAttemptAt` survives relaunch; a manual retry clears the delay
    and resets the intended attempt/error fields.
30. Corrupt or partial persisted Zustand state rebuilds reference counts from
    enabled collection membership rather than deleting valid shared blobs.
31. Granted, denied, and unsupported storage persistence states render
    accurately.
32. A simultaneous `pageshow`, visible `visibilitychange`, and `online` burst
    produces one single-flight drain with a requested-again pass only when state
    actually changes.

### UI

33. Incomplete enabled collection invokes retry/resume, not removal.
34. Complete collection removal still requires confirmation.
35. Failed count/reason is accessible without hover.
36. Progress updates after reconciliation.
37. Storage dialog offers global Retry failed downloads and actionable quota
    text.
38. Diagnostics stay within the ring/serialized-size bounds and export only the
    allowlisted fields.
39. Diagnostics cleanup removes the buffer, and raw file IDs, filenames, tokens,
    authorization headers, API bodies, and injected error text cannot appear in
    export.

### Service worker

40. Runtime navigation cache write is retained for the event lifetime.
41. Mutable static stale-while-revalidate work is retained when a cached response
    is returned immediately.
42. The actual `public/sw.js` returns controlled 503 for a never-settling
    IndexedDB open/read and 404 only for a completed missing-record read.
43. Immutable assets remain cache-first and cross-generation.
44. Failed installation leaves the previous generation usable.
45. Session media cache survives activation.

## Manual verification

### Desktop/browser checks available to the agent

- Enable a favorites collection with multiple small audio fixtures or authorized
  Drive files.
- Add a favorite from another session while the first download queue is active.
- Reload during a download and verify reconciliation.
- Toggle offline/online in devtools and verify visible recovery.
- Remove then immediately re-enable downloads.
- Fill/force a storage failure where practical and verify actionable UI.
- Verify downloaded playback, seeking, next/previous, lock-screen metadata, and
  the currently playing session cache.
- Verify logout clears device-local data without deleting Neon cloud data.
- Verify Drive network requests remain read-only.

### Real iPhone/iOS matrix

If a real iPhone is available, use an installed Home Screen app and Safari Web
Inspector:

| Case | Steps | Expected result |
| --- | --- | --- |
| Background suspension | Start downloads, switch apps for 30–60 seconds, return | Queue reconciles and resumes; no permanent spinner |
| Screen lock | Start downloads, lock, unlock, reopen | Same as above |
| Process termination | Start downloads, swipe away PWA, relaunch | Stored completions remain; missing tracks resume |
| Wi-Fi to cellular | Switch network mid-track | Attempt times out/fails visibly, then resumes |
| Airplane mode | Enable mid-track, later disable | No hot loop; online/resume trigger retries |
| Cloud additions | Add favorites on PC, open/resume iPhone | New favorites enter enabled offline collection and download |
| Remove/re-enable | Remove downloads, immediately re-enable | No cancellation-marker stall |
| Low storage | Approach quota or simulate failure | Storage-full explanation and recovery action |
| Deployment update | Activate a new build while idle and while playing | No broken playback or mixed shell/assets |

If no physical iPhone is available, say so. Desktop Safari responsive mode is
not proof of iOS suspension behavior.

## Verification commands

Run after relevant phases and again at the end:

```sh
pnpm lint
pnpm test
pnpm build
```

Because React files will change, also run the repository's React Doctor skill or
command if available in the environment. Report honestly if package/network
access prevents it.

Run `git diff --check` and inspect `git status --short`. Do not stage unrelated
files.

## Subagent execution plan

The lead agent must delegate bounded, non-overlapping work.

### Subagent A: queue regression test specialist

Start in Phase 0 after the lead agent completes the behavior-neutral interface/
factory extraction and proves existing tests still pass. Do not wait for Phase 1
behavior changes.

Ownership:

- `src/lib/offline-download-manager.test.ts`
- test-only fakes/helpers created specifically for that suite

Task:

- encode the recovery/cloud race, work-added-during-run, timeout/resume,
  cancellation-cause, auth-readiness, missing-metadata, ref-count,
  Strict-Mode-lifecycle, and stale-generation cases;
- do not edit production files;
- report which tests fail against the behavior-neutral extracted implementation
  and why.

The lead agent integrates the tests and owns production implementation.

### Subagent B: service-worker lifetime specialist

May run in parallel with the lead agent's queue work only after the lead decides
that the IndexedDB record schema remains compatible with the worker. If the
offline track schema/version changes, schedule this subagent after that decision
and include old/new record compatibility in its brief.

Ownership:

- `public/sw.js`
- `src/lib/sw-cache.test.ts`
- `src/lib/sw-runtime.test.ts`

Task:

- associate runtime cache work with fetch-event lifetime;
- bump the shell cache version;
- preserve all existing cache topology and playback-update invariants;
- bound offline-media IndexedDB open/read with controlled failures;
- add focused regression tests that execute the actual worker script;
- run the service-worker tests and `git diff --check`.

The lead agent must inspect the worker lifecycle carefully before accepting the
diff.

### Subagent C: adversarial reviewer

Use after Phases 1–3 are integrated. Read-only by default.

Task:

- inspect the complete diff for queue races, stale writes, retry hot loops,
  migration problems, listener leaks, Drive write operations, and misleading
  iOS claims;
- compare implementation against every invariant and required test in this plan;
- return prioritized findings with exact file/line references;
- do not edit unless the lead agent sends a follow-up with exact ownership.

### Optional sequential UI subagent

Only after the store/manager interface is stable, the lead agent may delegate:

- `src/components/playlist-view.tsx`
- `src/components/playlist-track-item.tsx`
- `src/components/storage-dialog.tsx`
- corresponding new component tests assigned in the subagent prompt

Do not run this agent concurrently with anyone editing `offline-store.ts` or the
manager interface. Give it the final state types and exact copy requirements.

### Integration rules

- Shared filesystem means edits are immediately visible.
- Assign file ownership explicitly in every prompt.
- Never let two agents edit the same file concurrently.
- The lead agent reads every changed file and runs all verification personally.
- If a subagent proposes a broader architecture, compare it to this plan before
  accepting it; do not silently expand scope.
- Preserve unrelated work and the existing untracked documentation directory.

## Completion criteria

Implementation is complete only when all are true:

- [ ] The `21 old + 3 cloud-added` race has an automated passing test.
- [ ] Work added during an active drain runs without a new external trigger.
- [ ] Every async queue phase has a bounded deadline.
- [ ] Visible resume and `pageshow` reconcile actual IndexedDB bytes.
- [ ] Remove/re-enable works in the same app realm.
- [ ] Missing metadata remains pending until cloud sync supplies it.
- [ ] Unhydrated cloud state cannot erase persisted offline intent.
- [ ] Transient auth refresh failure resumes after auth becomes ready and is not
      mislabeled as sign-in required.
- [ ] IndexedDB can reopen after abnormal termination.
- [ ] Permanent/action-required failures cannot hot-loop.
- [ ] Storage persistence result and quota failures are honest/actionable.
- [ ] Sanitized local diagnostics are bounded, exportable by user action, and
      contain no prohibited fields.
- [ ] Retry/Resume and Remove are distinct UI actions.
- [ ] Runtime service-worker cache writes are retained by event lifetime.
- [ ] Offline-media service-worker IndexedDB timeouts return controlled failures.
- [ ] No Google Drive write-capable request or scope was introduced.
- [ ] Offline playback and byte-range seeking still work.
- [ ] Logout and cloud/device data boundaries still work.
- [ ] `pnpm lint`, `pnpm test`, and `pnpm build` pass.
- [ ] React Doctor was run or its blocker was reported.
- [ ] `git diff --check` passes.
- [ ] Real-iPhone verification was completed or explicitly listed as unverified.
- [ ] No commit, push, deployment, or PR occurred without user authorization.

## Final handoff format

The implementing agent's final response should report:

1. the outcome in user terms;
2. the chosen manager interface and the queue invariants it now enforces;
3. the exact race/recovery tests added;
4. automated verification results;
5. manual browser and real-iPhone results, clearly separated;
6. any remaining platform limitation or deferred chunked-download work;
7. the files changed;
8. current worktree status;
9. confirmation that Drive remained read-only;
10. whether anything was committed, pushed, or deployed.
