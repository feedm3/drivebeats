# iOS installed-PWA reliability research

Date: 2026-07-29
Scope: Drivebeats offline audio downloads and playback in an iOS/iPadOS Home Screen web app
Current shipping baseline checked: Safari/iOS 26.6, released 2026-07-27

## Executive conclusion

Drivebeats is affected by the most important iOS PWA reliability constraint:
its download queue runs as ordinary page JavaScript, while iOS can suspend
inactive web content and Safari has no Background Sync or Background Fetch API.
The current queue therefore cannot promise native-style continuation after the
PWA is backgrounded, the screen locks, the process is killed, or a fetch stalls.

The reported `21/24 downloaded` state is consistent with this design. Drivebeats
does persist intent and reconcile IndexedDB on a fresh app initialization, but it
does not reconcile and restart the queue on every foreground resume. It also has
no per-request timeout. One unresolved `fetch()`/`blob()` operation can keep the
single in-memory `queuePromise` occupied indefinitely, preventing a later
`processQueue()` call from starting a fresh queue.

The best improvement is not to move the same long-lived loop into a service
worker. Service workers are also event-driven and terminable. The queue should
instead be a durable, restartable state machine that treats every launch,
`pageshow`, visible `visibilitychange`, authenticated cloud-library update, and
successful connectivity probe as an opportunity to reconcile actual IndexedDB
records and process the next bounded unit of work.

## Confirmed iOS/WebKit limitations

### 1. Page execution is suspended in the background

WebKit says that when a page becomes inactive it applies power-saving measures
and, on iOS, “tabs are completely suspended when possible.” It recommends the
Page Visibility API for reacting to background/foreground transitions.
[WebKit: How Web Content Can Affect Power Usage](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)

WebKit also has a still-open iOS issue showing that close/kill transitions are
not reliably observable: `visibilitychange` can fire for a tab switch, but
`pagehide`, `beforeunload`, `unload`, and even `visibilitychange` may not fire
when a tab is closed or Safari is suspended/killed. The report remains `NEW` and
was last modified in 2026.
[WebKit bug 199854](https://bugs.webkit.org/show_bug.cgi?id=199854)

Consequences:

- A foreground download loop must be assumed to pause and may never get a
  cleanup callback.
- “Save state on unload” is not a sufficient recovery design on iOS.
- Work should be checkpointed before suspension is possible, and app startup
  and foreground resume must be able to reconstruct the truth without relying
  on the previous JavaScript process.

### 2. A service worker is not a persistent background process

The Service Worker specification ties a worker’s lifetime to the lifetime of
events, and explicitly permits the user agent to terminate it whenever it has no
event to handle or exceeds imposed time limits.
[W3C Service Workers, lifetime](https://w3c.github.io/ServiceWorker/#service-worker-lifetime)

WebKit’s implementation description likewise says service workers are run only
when needed, normally terminate after a grace period when there is no client,
and restart for events such as `fetch` or `postMessage`.
[WebKit: Workers at Your Service](https://webkit.org/blog/8090/workers-at-your-service/)

Consequences:

- Moving a playlist-sized `while` loop to `sw.js` would not make it durable.
- `event.waitUntil()` is appropriate for completing one bounded event, not for
  manufacturing an indefinite background download service.
- Durable queue state must live in storage; each worker/page instance must be
  disposable and able to resume from that state.

### 3. Background Sync is not available in Safari/iOS

Current MDN browser-compatibility data records `SyncManager` as unsupported in
Safari, with iOS Safari mirroring that result.
[MDN browser-compat-data: SyncManager](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SyncManager.json)

WebKit’s Periodic Background Sync feature request was closed `WONTFIX`; the
discussion cites power, privacy, and fingerprinting concerns.
[WebKit bug 204117](https://bugs.webkit.org/show_bug.cgi?id=204117)

Consequence: Drivebeats cannot register a background sync task and expect iOS to
wake the PWA when connectivity returns.

### 4. Background Fetch is not available in Safari/iOS

Background Fetch is the web API designed for browser-managed, user-visible,
long-running downloads, but current compatibility data records it as unsupported
in Safari and therefore iOS Safari.
[MDN browser-compat-data: BackgroundFetchManager](https://github.com/mdn/browser-compat-data/blob/main/api/BackgroundFetchManager.json)
[WICG Background Fetch specification](https://wicg.github.io/background-fetch/)

Consequence: there is no currently shipped browser-managed iOS download API
that can take ownership of Drivebeats’ large authenticated audio downloads after
the PWA page is suspended or terminated.

### 5. Screen Wake Lock helps only while the PWA remains visible

Screen Wake Lock works in iOS/iPadOS Home Screen web apps starting with 18.4.
[WebKit: Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
[MDN browser-compat-data: WakeLock](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/WakeLock.json)

The API only prevents screen dimming/locking. The specification permits only
visible documents to acquire it, requires release when the document becomes
hidden, and allows the user agent to release it for low battery, power-saving
mode, or other implementation reasons.
[W3C Screen Wake Lock](https://w3c.github.io/screen-wake-lock/)

Consequences:

- Wake Lock cannot make a backgrounded PWA continue running.
- It can be an optional, clearly disclosed aid for a user-initiated foreground
  “download this collection now” operation.
- A wake lock must be reacquired after visibility returns and its `release`
  event must be handled; it cannot be treated as a reliability guarantee.

### 6. Web Locks coordinates work but does not keep it alive

Web Locks is supported in Safari/iOS from 15.4 and can coordinate queue ownership
between windows/workers of the same origin.
[WebKit: Safari 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
[MDN browser-compat-data: LockManager](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/LockManager.json)

The specification terminates remaining locks and requests when their document
unloads or their worker agent terminates.
[W3C Web Locks, termination](https://w3c.github.io/web-locks/#termination-of-locks)

Consequence: a Web Lock can prevent two live Drivebeats contexts from downloading
the same queue concurrently, but cannot preserve or resume a queue and cannot
prevent iOS suspension.

### 7. Storage is sizable but still quota-bound and evictable

WebKit’s current published storage policy covers Cache API, IndexedDB, service
workers, and the File System API together. Since Safari/iOS 17:

- a browser origin can receive a quota of up to 60% of total disk space;
- overall browser storage can reach up to 80% of disk space;
- a standalone Home Screen web app receives the same quota class as a browser
  app;
- exceeding an origin quota makes the write fail with `QuotaExceededError`;
- overall quota pressure, system storage pressure, or inactivity can trigger
  origin-level least-recently-used eviction;
- storage starts in best-effort mode, while persistent mode can exclude an
  origin from automatic eviction;
- `navigator.storage.persist()` is heuristic, and being a Home Screen web app is
  one factor WebKit considers;
- `navigator.storage.estimate()` is only an estimate/upper bound, not a promise
  that the reported free capacity can be consumed.

[WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

The Storage Standard similarly defines best-effort versus persistent storage
and states that persistent storage cannot be cleared by the user agent without
origin/user involvement.
[WHATWG Storage Standard](https://storage.spec.whatwg.org/#persistence)

Important clarification: the historic ITP seven-day script-storage rule is not
expected to delete the first-party data of a correctly installed Home Screen web
app. WebKit explicitly exempts the first-party Home Screen app domain from ITP’s
website-data removal algorithm. That exemption does not remove quota, storage
pressure, explicit user deletion, or implementation-bug risks.
[WebKit: CNAME Cloaking and Bounce Tracking Defense](https://webkit.org/blog/11338/cname-cloaking-and-bounce-tracking-defense/#home-screen-web-application-domain-exempt-from-itp)

### 8. IndexedDB is durable storage, not an infallible media-download manager

IndexedDB transactions commit atomically: either the transaction’s changes are
written or the transaction aborts and changes are rolled back. The
specification recommends short-lived transactions and notes that a transaction
can still fail after an individual request reports success, so callers should
observe transaction completion.
[W3C IndexedDB 3.0, transaction lifecycle](https://w3c.github.io/IndexedDB/#transaction-lifecycle)

WebKit’s bug tracker contains real iOS PWA failure reports worth designing
recovery for:

- loss of the IndexedDB server connection after quota/cache pressure in an iOS
  PWA (`NEW`);
  [WebKit bug 277598](https://bugs.webkit.org/show_bug.cgi?id=277598)
- historical `UnknownError` / “Connection to Indexed Database server lost”
  reports in standalone PWAs;
  [WebKit bug 235579](https://bugs.webkit.org/show_bug.cgi?id=235579)
- a current iOS 26 report where an IndexedDB write transaction never fires
  `complete`, `error`, or `abort` after a particular Web Push flow (`NEW`).
  [WebKit bug 315804](https://bugs.webkit.org/show_bug.cgi?id=315804)

These bugs do not prove that every current iOS device will fail, and two involve
special circumstances. They do establish that “reopen the app” cannot be the
only recovery path: the database connection and transaction operations need
timeouts, telemetry, reconnection, and a user-visible repair/retry path.

### 9. Whole-response blobs increase the interruption and memory window

`Response.blob()` invokes Fetch’s “consume body” algorithm, which fully reads the
response and then constructs one Blob from the resulting byte sequence.
[WHATWG Fetch: Body `blob()`](https://fetch.spec.whatwg.org/#dom-body-blob)

Safari 26.4 added byte-oriented response streams, BYOB readers, and
`Blob.stream()` BYOB support specifically to improve memory efficiency for large
files and media.
[WebKit: Safari 26.4, ReadableByteStream](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/#readablebytestream)

Consequences:

- With a whole-file blob, Drivebeats gets no durable checkpoint until the full
  network response has completed and the subsequent IndexedDB write commits.
- Three concurrent whole-track downloads widen the amount of in-flight binary
  data and the interruption window.
- Chunked/checkpointed storage or a supported streaming file-store design would
  improve recoverability. It is a larger migration and should follow the simpler
  queue-resume/timeout fixes.

## Common cross-browser PWA risks

These are not unique to iOS, but the iOS lifecycle makes their impact more
visible.

### Connectivity events are hints, not proof

The HTML Standard says `navigator.onLine` returns `true` when the user agent
*might* be online and calls the attribute inherently unreliable: a device may
be connected to a network without Internet access.
[WHATWG HTML: browser online state](https://html.spec.whatwg.org/multipage/system-state.html#browser-state)

Mitigation: use `online` only as a retry trigger. Determine success from the
actual authenticated Drive request, use bounded timeouts, and classify HTTP,
authentication, quota, and network errors separately.

### Queue state can diverge from stored bytes

Metadata such as “downloaded” is not the media itself. Quota eviction, explicit
data clearing, a failed/aborted transaction, or an implementation failure can
leave status metadata inconsistent with IndexedDB.

Mitigation: IndexedDB records are the source of truth. Reconcile collection
membership and actual records on launch/resume; only mark a track downloaded
after its transaction completes; optionally verify expected size.

### In-memory mutexes can become stale

An in-memory “queue already running” promise protects against duplicate work
only while that exact JavaScript realm is healthy. A hung operation can turn it
into a permanent blocker; a second PWA context has a separate mutex.

Mitigation: give every network/storage step a deadline; release the in-memory
guard in `finally`; use a Web Lock only for cross-context coordination; keep the
authoritative lease/attempt state durable and expiring.

### Retries need classification and durable scheduling

Immediate retries cannot fix quota exhaustion, invalid authorization, a deleted
Drive file, or an unsupported codec. Retrying all errors identically wastes
battery and can obscure the action the user needs to take.

Mitigation: persist an error category, attempt count, and next-attempt time;
retry transient network/5xx failures with capped exponential backoff and jitter;
pause for re-authentication, quota cleanup, or permanent 4xx errors; expose
“Retry failed downloads.”

### Service worker updates and caches can create mixed-version states

Service workers have install/waiting/activate phases and can be terminated
between events. Cache entries and registrations are also storage subject to the
same quota/eviction policy described above.

Mitigation: keep shell caches versioned, make install/activate idempotent, do not
delete the last usable shell before the replacement is ready, and ensure both
old and new page versions tolerate the durable queue schema. Drivebeats already
implements several of these shell-cache safeguards in `public/sw.js`; the larger
remaining reliability gap is the page-owned media queue.

## Drivebeats: confirmed current exposure

This section is based on the repository state inspected on 2026-07-29.

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Queue execution | Three page-level workers (`MAX_CONCURRENT = 3`) call authenticated Drive `fetch()`, then `Response.blob()`, then one IndexedDB `put` per complete track. See [`offline-download-manager.ts`](../../src/lib/offline-download-manager.ts). | **Affected.** No browser/OS-managed ownership after the PWA is suspended. Whole-file progress is lost on interruption. |
| Stalled operation | Fetches share an `AbortController`, but there is no per-attempt timeout. `queuePromise` rejects duplicate queue starts until the existing promise settles. | **Affected.** A fetch/storage operation that never settles can make the UI remain at `21/24` with no new queue start. |
| Queue drain | `runQueue()` snapshots pending IDs once. A `processQueue()` call made while that run is active only receives the existing promise; it does not request another drain after newly queued IDs arrive. | **Affected.** Favorites added by cloud sync during an active recovery/download run can remain queued with no later processor. |
| Recovery/cloud-sync race | `recoverOfflineState()` captures the tracked IDs before its asynchronous IndexedDB scan, then replaces the entire `trackStatus` map from that old snapshot. | **Affected and a strong match for `21/24`.** If cloud sync adds three favorites during the scan, recovery can erase their new `queued` statuses while the collection still records 24 members. |
| Launch recovery | `recoverOfflineState()` scans IndexedDB, converts non-present non-failed tracks to `queued`, and starts the queue. It is invoked once by `initOfflineSync()` from an app-shell effect. | **Partially protected.** A true reload/relaunch can heal state, but an iOS resume of the same realm is not guaranteed to rerun initialization. |
| Foreground recovery | The manager restarts on the `online` event and collection membership changes, but has no `visibilitychange`/`pageshow` handler. | **Affected.** Returning to the visible PWA while still nominally online provides no guaranteed retry trigger. |
| Cancellation | Removing a collection adds every unreferenced file ID to a module-level cancellation set. IDs that are already downloaded are not visited by a pending worker, so their markers can survive until a later re-download attempt, which consumes the marker and skips the track without scheduling another drain. | **Affected.** Removing and re-enabling offline downloads in the same app realm can leave queued tracks inert until a reload or another trigger. |
| Partial-download control | In an enabled but incomplete collection, pressing the download control calls `stopCollectionDownload()`; removal is a separate confirmation only after all tracks are complete. | **Affected product behavior.** The obvious control at `21/24` removes the collection instead of retrying/resuming it, so the user has no safe recovery action. |
| Online detection | `online` is treated as a queue trigger. | **Partially protected.** Correct as a trigger, but insufficient alone because the event may not occur on resume and does not prove Drive reachability. |
| Background APIs | No Background Sync or Background Fetch use. | **Correct for iOS compatibility.** These APIs are unavailable; a foreground-resumable design is required. |
| Storage persistence | The collection-start path calls `navigator.storage.estimate()` and only logs a warning if the estimate is tight. It does not request/check persistent mode. | **Affected.** The app cannot communicate low-space risk to the user and remains best-effort unless WebKit has granted persistence heuristically. |
| Quota errors | IndexedDB errors flow through the same three generic retries and end as `failed`; error category is console-only. | **Affected.** Retrying a quota failure does not create space, and the UI cannot explain or repair it. |
| IndexedDB connection | `offline-db.ts` memoizes one `openDB()` promise for the life of the realm and does not install `blocked`, `blocking`, or `terminated` recovery callbacks. | **Affected by a plausible WebKit failure mode.** A lost database process/connection may require reconstructing the connection, but the current wrapper has no path to reset it. |
| Durable source of truth | Launch recovery checks actual IndexedDB track records rather than trusting persisted Zustand status. | **Good.** Extend this reconciliation to foreground resume and post-cloud-sync. |
| Cross-context ownership | The queue guard is module-local; no Web Lock is used. | **Low-to-medium risk.** Installed PWA and Safari/another live context could process the same queue. A Web Lock would coordinate them, but does not solve suspension. |
| Service worker media serving | The service worker reads stored blobs and implements range responses for offline media. | **Good architecture for playback.** It keeps playback serving separate from queue ownership; it still must tolerate worker restarts and missing records. |
| Service worker cache writes | Runtime shell/static-asset cache writes are started without attaching their completion to `FetchEvent.waitUntil()`. | **Secondary reliability gap.** The response remains usable, but a short-lived worker may be terminated before a detached cache write or stale-while-revalidate update completes. This affects later offline boot/update reliability, not the `21/24` media queue directly. |

## Recommended mitigation plan

### Priority 0 — reproduce and instrument before changing storage architecture

1. Capture iOS version, installed/standalone state, app build, visibility state,
   track ID, attempt number, request phase, elapsed time, HTTP status, blob size,
   IndexedDB phase, and normalized error name (`AbortError`,
   `QuotaExceededError`, `UnknownError`, auth, 4xx, 5xx).
2. Add a local diagnostics view/export that never includes OAuth tokens or audio
   content.
3. Reproduce these cases on a real iPhone with Safari Web Inspector:
   background for 30 seconds, lock screen, switch networks, airplane mode
   mid-track, low storage/quota failure, terminate the PWA, and update the app
   while downloads are pending.

### Priority 1 — make the existing queue self-healing

1. On launch, visible `visibilitychange`, `pageshow`, authenticated cloud-library
   completion, and `online`, run one idempotent reconciliation:
   compare enabled collections with actual IndexedDB records, reset stale
   `downloading`/`updating` statuses to `queued`, then schedule work.
2. Make `processQueue()` drain until no eligible work remains, including work
   added during an active run. A request made during a run must set a durable
   rerun flag rather than only adopting the old promise.
3. Serialize recovery, cloud membership changes, cancellation, and queue
   scheduling. Recovery must merge against the live set of tracked IDs after its
   IndexedDB read instead of replacing state from a captured snapshot.
4. Replace permanent cancellation markers with operation-scoped cancellation,
   or clear them deterministically after stop. Re-enabling a collection must
   always create runnable work.
5. Give metadata fetch, media fetch/body consumption, and IndexedDB writes
   explicit deadlines. On deadline, abort/reopen as appropriate, clear the
   in-memory queue owner, persist a retryable failure, and allow the next resume
   to proceed.
6. Persist `phase`, `attempt`, `lastAttemptAt`, `nextAttemptAt`, and a normalized
   error category. Do not persist a permanent `downloading` state without an
   expiring lease.
7. Restart the IndexedDB connection after `terminated`/`close`/connection-loss
   errors. The `idb` wrapper’s `openDB` options include a `terminated` callback
   for abnormal browser termination.
   [idb `openDB` documentation](https://github.com/jakearchibald/idb#opendb)
8. Ensure queue startup waits until the cloud library contains the tracks added
   on another device; if a queued file ID has no current track metadata, leave
   it pending and retry after cloud sync rather than silently finishing an empty
   queue.
9. Change the incomplete-collection control to “Resume/Retry downloads.” Keep
   “Remove downloads” as an explicit separate action, and show the error category
   for each failed track.

### Priority 2 — make storage behavior explicit

1. When the user first enables offline downloads, call
   `navigator.storage.persist()`, record the returned boolean, and show
   best-effort versus protected status without claiming persistence was granted.
2. Check estimated remaining storage before each batch/large track, but still
   catch `QuotaExceededError` on every write because the estimate is not a
   reservation.
3. Replace console-only warnings with actionable UI: required/available estimate,
   “Free device storage,” “Remove downloads,” and “Retry.”
4. Continue treating actual IndexedDB records as authoritative after any resume
   or storage error.

### Priority 3 — reduce interruption cost

1. Start by lowering iOS concurrency from three to one or two and compare
   completion rate, memory pressure, total time, and battery use. Do not hardcode
   a permanent platform rule without measurement.
2. Consider an optional user-controlled Screen Wake Lock for an active foreground
   download session on iOS 18.4+, with visible explanation and correct release/
   reacquisition handling.
3. Evaluate chunked/checkpointed downloads or a streamed origin-private file
   design for current Safari. This can reduce peak buffering and resume from a
   byte boundary, but it requires server Range support, integrity/size checks,
   partial-file cleanup, and a migration for existing IndexedDB blobs.

### Priority 4 — coordinate multiple live contexts

Wrap queue ownership in a named Web Lock with an abortable/expiring durable lease.
Use it only to prevent duplicate live processors. Do not describe it as a
background-execution solution.

## Product expectation to communicate

With current Safari/iOS 26.6 APIs, the honest contract is:

> Drivebeats resumes pending offline downloads whenever the app is open and
> online. Keep the app visible for the fastest completion. Downloads may pause
> when iOS backgrounds or closes the app, and should continue automatically the
> next time the app becomes active.

After Priority 1, `21/24` should be a temporary, explainable state with visible
per-track failure/retry information—not an inert state that requires the user to
guess whether anything is happening.

## Source currency

Safari 26.6 is the current stable release as of this note and includes service
worker registration fixes, but no announcement of Background Sync or Background
Fetch support.
[WebKit: Safari 26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)

Compatibility claims above use the current `main` branch of MDN
browser-compat-data where WebKit did not publish a dedicated current feature
status entry. Recheck those machine-readable records before implementation if
the browser target changes, especially after Safari 27 ships.
