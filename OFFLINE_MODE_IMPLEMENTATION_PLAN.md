# Offline Listening Implementation Plan

## Goals

- Allow users to mark **single songs**, **entire playlists**, and **folders** as available offline.
- Show a clear **offline availability indicator** on files and folders.
- Add a playback mode to **play only offline songs**.
- Automatically enforce offline-only playback when the network connection is lost.
- Show storage information: **offline song count**, **space used**, and controls to **delete offline data**.

## Scope & Guardrails

- Google Drive access remains read-only; offline availability is local caching of audio data and metadata.
- No upload, move, rename, or mutation calls are introduced for Drive content.

## Product Decisions Captured

- **Offline format:** download and store only original Drive files (no transcoding/bitrate variants).
- **Logout behavior:** always remove every offline track/blob and offline metadata on logout.
- **Folder download depth:** when user clicks “Make folder available offline”, show a confirmation asking whether to include subfolders.
- **Offline-only browsing mode:** when offline-only mode is active, hide songs that are not cached offline.
- **Large download warning:** before starting a selected download larger than **100 MB**, show a confirmation with estimated size.
- **Queue behavior:** always play one song after another; do not add complex skip-announcement behavior.
- **Storage simplicity:** no user-configurable hard storage cap.
- **Stale tracks:** if a cloud version changed, the cached stale track remains playable until refreshed.
- **Network option simplicity:** no “Wi-Fi-only downloads” option.

## Architecture Overview

### 1) Offline Data Layer

Introduce an IndexedDB-backed offline cache:

- `offline_tracks` object store:
  - `fileId` (key)
  - `blob` (audio file data)
  - `sizeBytes`
  - `cachedAt`
  - `lastAccessedAt`
  - `etag` or `modifiedTime` snapshot (if available from Drive metadata)
  - `source` (`"single" | "playlist" | "folder"`) for diagnostics
- `offline_manifests` object store:
  - `entityType` (`"track" | "playlist" | "folder"`)
  - `entityId`
  - list of resolved `fileIds`
  - `createdAt`

Use a small storage utility in `src/lib/offline-cache.ts` to keep IndexedDB APIs isolated.

### 2) Offline State Store

Add `src/stores/offline-store.ts` (persisted for settings + metadata, not blobs):

- `offlineEnabledByUser` (master toggle)
- `offlineOnlyMode` (manual mode)
- `effectiveOfflineOnlyMode` (computed from manual toggle OR network offline)
- `items`: map keyed by `fileId` with status:
  - `"not_cached" | "queued" | "downloading" | "cached" | "error" | "stale"`
  - `sizeBytes`, `progressPct`, `errorMessage`, `updatedAt`
- `queue`: download queue (track ids)
- aggregate selectors:
  - `offlineSongCount`
  - `offlineBytes`
  - `offlineByPlaylist`
  - `offlineByFolder`

### 3) Download Orchestration

Create a queue manager (client-side service) that:

- Resolves targets:
  - single track -> one file
  - playlist -> playlist track ids
  - folder -> traverse folder tree + audio files (already available through cache/API paths)
- Deduplicates by `fileId`.
- Downloads with concurrency limit (e.g., 2–3 parallel jobs).
- Supports pause/resume/cancel.
- Updates per-track progress and aggregate progress.
- Stores blobs in IndexedDB on success.

### 4) Playback Integration

Update player loading flow:

- First check offline cache for `fileId`.
- If found, load blob URL directly (no network required).
- If not found:
  - if `effectiveOfflineOnlyMode = true`, hide non-cached songs from active lists/queues and play next cached item.
  - otherwise use existing Drive streaming flow.

### 5) Connectivity Detection

Add connectivity hook (`navigator.onLine` + `online/offline` events):

- If browser goes offline: force `effectiveOfflineOnlyMode = true` (without overriding user’s saved manual preference).
- If browser returns online: restore `effectiveOfflineOnlyMode` to manual setting.
- Show toast/banner when this automatic switch occurs.

## Technical Possibilities for Background Downloading

Two practical implementation options exist in browser constraints:

1. **Foreground-tab downloads (simplest / most reliable for v1)**
   - Downloads run while DriveBeats tab is open and active.
   - Lowest complexity; easiest to debug and ship quickly.
   - Fits current architecture best.

2. **Best-effort hidden-tab downloads (moderate complexity)**
   - Continue queue while tab is backgrounded.
   - Subject to browser throttling/suspension; completion is not guaranteed if OS/browser freezes tab.
   - Needs careful resume logic on tab focus/visibility changes.

3. **Service Worker Background Sync style approach (highest complexity, limited fit)**
   - Not reliable for large media file transfer workflows across all browsers.
   - Adds significant complexity and still cannot guarantee long-running Drive downloads.

**Recommendation:** ship v1 with foreground-tab downloads; optionally add best-effort hidden-tab continuation in v2.

## UX Plan

### A) Actions: Mark Offline / Remove Offline

Add actions at 3 levels:

1. Track row actions (file list + playlist items)
   - “Make available offline” / “Remove offline copy”
2. Playlist-level action
   - “Make playlist available offline”
3. Folder-level action
   - “Make folder available offline”
   - On click: prompt user to choose “This folder only” or “Include subfolders”

### B) Indicators

- Track indicator states:
  - cached (check icon)
  - downloading (spinner/progress ring)
  - queued
  - error
  - stale
- Folder/playlist indicator:
  - fully cached (all tracks)
  - partially cached (x/y tracks)

### C) Offline-Only Playback Toggle

- Add toggle in player controls or header:
  - “Play offline only”
- Auto-enabled when offline (read-only badge explaining why).
- In offline-only mode, non-cached songs are not rendered in lists/queues.

### D) Storage Management Surface

Create an “Offline Storage” panel:

- Total offline songs
- Total size used
- Breakdown by playlists/folders
- Controls:
  - Remove individual track
  - Remove playlist offline copies
  - Remove folder offline copies
  - Clear all offline data

### E) Empty & Failure States

- Offline-only mode with 0 cached songs: show actionable empty state.
- Partial playlist availability: clarify how many songs can play.
- Download failures: retry CTA and error details.

## Data Freshness & Invalidations

- On metadata refresh, compare `modifiedTime`/`etag` where available.
- Mark cached files `stale` if cloud version changed.
- Keep stale cached files playable and provide “Refresh offline copy” action.

## Performance & Limits

- Use `navigator.storage.estimate()` to show usage and quota.
- Calculate estimated bytes before queueing downloads.
- If estimated selection size exceeds **100 MB**, require explicit confirmation before download begins.
- No user-configurable hard cap in v1 (simplicity).

## Security & Privacy

- Cached audio remains local to browser origin storage.
- On logout, always clear all offline blobs and offline metadata.

## Rollout Plan

### Phase 1 (Foundation)

- IndexedDB cache utilities
- Offline store (state + selectors)
- Manual per-track offline download/remove
- Track indicators
- Player fallback to offline source

### Phase 2 (Collections)

- Playlist/folder bulk actions
- Queue manager with progress
- Partial/full collection indicators
- Download-size preflight check + >100 MB confirmation

### Phase 3 (Offline-only Experience)

- Offline-only toggle
- Auto-switch on lost connection
- Offline storage panel with clear/delete controls

### Phase 4 (Polish)

- Stale detection refresh actions
- Retry UX improvements
- Optional hidden-tab continuation (best effort)

## Additional Important Functionality (Likely Missing)

1. **Conflict handling for renamed or moved tracks** while cached locally.
2. **Multi-tab coordination** so two tabs do not duplicate download jobs.
3. **Disk quota warnings** before failures.
4. **Accessibility cues** for offline status and progress updates (screen readers).
5. **Sorting/filtering by offline status** in file and playlist views.
6. **Retry strategy** for interrupted downloads after reconnect.
7. **Versioning/migration strategy** for IndexedDB schema updates.
8. **Explicit user consent text** for local device storage usage.
