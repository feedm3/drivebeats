# ID3 metadata: primary-source findings

Checked: 2026-10-15. Research and bounded local parser probe only. No private Drive request, browser control, audio playback, token export, product implementation, dependency change or deployment.

The earlier `drivebeats-metadata-sources.md` in Documents was used as a checklist; claims below were checked against official documentation, specifications and the installed package. Public documentation establishes possibilities; it does not establish behavior of the user's Drive files or ChatGPT browser.

## Findings and evidence

### Drive supports partial media reads; it does not supply MP3 text tags

Google documents partial blob downloads through `files.get?alt=media` with `Range: bytes=start-end`. Content-reading authorization and download capability remain necessary. Metadata-only scope does not authorize media reads. [Drive download guide](https://developers.google.com/workspace/drive/api/guides/manage-downloads#partial_download)

The documented `files` resource includes image/video metadata but no MP3 title/artist/album resource. Relevant validation fields are `md5Checksum` for binary content, `version` for every server-side change, `modifiedTime`, `size`, `headRevisionId` and `capabilities.canDownload`. `version` can therefore invalidate on changes beyond audio content; checksum is a better content identity when present. App properties require application writes and conflict with this repository's read-only Drive policy. [Drive files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)

**Design implication:** use embedded bytes for tags; keep provenance distinct from filename/folder inference. Cache under account + track ID + available content identity, with parser/schema version. A current folder/list refresh can discover stale entries cheaply by requesting validation fields in its existing field mask. Neither a persistent cache nor unchanged local `modifiedTime` proves a remote file is unchanged without a remote metadata refresh.

Google's `changes` collection can incrementally report file changes using a saved page token; removed/shared items and pagination need deliberate handling. It is an optional later invalidation strategy, not permission to ingest unrelated Drive content or to expand the Library. [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)

### An MP3 prefix is useful, but a small fixed prefix is insufficient

ID3v2.3 begins with a 10-byte header and a 28-bit size for the following tag, including padding and extended headers. Frames have sizes; APIC embeds artwork. Therefore artwork/padding may make the tag much larger than 64 KiB. Correct selective frame skipping must also handle version, extended header and unsynchronisation semantics. [ID3v2.3 specification, sections 3 and 4.15](https://id3.org/id3v2.3.0)

ID3v1 occupies the final 128 bytes; title, artist and album each have 30-byte fields. A tail read can retrieve it without reading intervening audio. [ID3v1 format](https://id3.org/ID3v1)

**Design implication:** retain existing parser initially, fetch a bounded header/tag range for supported formats, and return an explicit budget/unsupported outcome when the cap is reached. Do not silently label a truncated parse as `no_tags`. Exact duration, BPM and mood are outside the title/artist/album contract; their availability must be assessed separately.

### Installed jsmediatags already has the required extension seam

Current local evidence:

| Evidence | Finding |
| --- | --- |
| `apps/drivebeats-web/package.json:23`; `pnpm-lock.yaml:193-195` | Declared `^3.9.7`, locked `3.9.7`. |
| `pnpm --filter @drivebeats/web exec node -p 'require.resolve("jsmediatags/package.json")'` | Resolved `node_modules/.pnpm/jsmediatags@3.9.7/node_modules/jsmediatags/package.json`; manifest line 3 confirms `3.9.7`. |
| Installed `README.md:22-25,297-321,358-365` | ID3v1, ID3v2, MP4 and FLAC readers; custom `MediaFileReader` via `Reader.setFileReader`; selected tag fields via `setTagsToRead`. |
| Installed `build2/jsmediatags.js:78-86,127-205` | Reader constructs the custom file reader with the supplied location/context; automatic format identification requests beginning and end ranges independently. |
| Installed `build2/ID3v2TagReader.js:44-53,104-121` | `_loadData` loads the whole declared ID3v2 region before `_parseData` applies requested-field filtering. |
| Installed `build2/XhrFileReader.js:64-134,175-208,211-278` | HEAD/GET discovery, 1 KiB rounding, explicit full-file fallback, accepts both 200 and 206; sets Range and If-Modified-Since but has no ordinary Authorization option in this request path. |
| Installed `build2/BlobFileReader.js:52-84` | Slices a Blob already available locally; this saves parser memory work, not prior network download bytes. |
| `apps/drivebeats-web/src/lib/id3-metadata.ts:14-36` | Current extraction reads a Blob and collapses parser errors and empty useful tags into `null`. |

Installed package paths above are relative to the repository's `node_modules/.pnpm/jsmediatags@3.9.7/node_modules/jsmediatags/`, except explicitly named app files. Source references: [maintainer README](https://github.com/aadsm/jsmediatags), [ID3v2 reader](https://github.com/aadsm/jsmediatags/blob/master/src/ID3v2TagReader.js), [HTTP reader](https://github.com/aadsm/jsmediatags/blob/master/src/XhrFileReader.js), [format discovery](https://github.com/aadsm/jsmediatags/blob/master/src/jsmediatags.js). These upstream links are navigation aids; installed 3.9.7 is the version evidence.

**Design implication:** implement an authenticated, budgeted custom reader on the existing Google request boundary. Restrict returned fields to title/artist/album to reduce parsing/output, but do not claim that this skips artwork transfer. Coalesce/cache ranges within one extraction. The shared scheduler must serialize actual transport requests: serializing track jobs alone is insufficient because the parser can issue multiple `loadRange` calls concurrently. Reuse already available playback/offline Blobs first, with zero extra Drive media reads.

An MP3-only first remote path is a defensible explicit scope. MP4/FLAC use different structures; the fact that jsmediatags supports them does not prove an MP3 header recipe or the proposed budgets work for them. The repository's broader playable-format list must remain separate from metadata parser support.

### HTTP correctness and browser CORS must be verified separately

HTTP permits Range to be ignored; `Accept-Ranges` is advisory. A single-range 206 carries `Content-Range`; retry delays can be seconds or HTTP dates. [RFC 9110 sections 14 and 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-range)

Fetch safelists a valid single range with a numeric start, but not a suffix-only `bytes=-128`; Authorization needs explicit CORS permission. `Content-Range` and `Retry-After` are not default safelisted response headers. Their visibility depends on the server's expose list. [WHATWG Fetch: headers and CORS](https://fetch.spec.whatwg.org/#cors-safelisted-request-header)

**Design implication:** use known size for explicit tail offsets, avoid HEAD when existing metadata supplies size, require 206 + matching Content-Range + bounded body, cancel an unexpected 200 body immediately. Cancellation limits further consumption; it cannot guarantee zero bytes have already arrived or were buffered by the browser. Verify total file size, offsets and a stable validator where the endpoint exposes/enforces one. Do not assume an ETag or conditional header is supported simply because HTTP defines it. If same-version assembly cannot be established, discard suspicious/mismatched ranges and revalidate; never mix old/new bytes into a successful parse.

A successful current full-file fetch does not prove Range/CORS support in the real website context. A successful shell request does not prove browser response-header visibility. The jsmediatags README's full-download fallback must not be inherited by a sparse metadata path. [Maintainer CORS documentation](https://github.com/aadsm/jsmediatags#http-access-control-cors)

### Quota and retry facts do not establish a serial-only browser limit

The current Google limits page expresses new Drive REST quotas in **quota units**, with 1,000,000/minute/project and 325,000/minute/user/project. It lists `files.get` as 5, `files.list` as 100 and `files.download` as 200 units. Projects that used this API between November 2025 and April 2026 retain their previously set quotas; projects created from May 1, 2026 use the new quotas. DriveBeats' actual project configuration was not inspected. The page does not explicitly disambiguate media `files.get?alt=media` accounting. Do not extrapolate byte savings into exact quota/billing savings. Google recommends truncated exponential backoff with jitter. [Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits)

Google documents rate failures as 403 `rateLimitExceeded`/`userRateLimitExceeded` and 429, and transient server failures as 500/502/503/504. Permission 403 is a different outcome. [Drive error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors)

429 may include Retry-After; it is not guaranteed. [RFC 6585 section 4](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)

**Design implication:** one shared foreground Drive transport slot is a safe starting policy to measure, not a documented Google or ChatGPT concurrency requirement. Honor visible Retry-After, otherwise use bounded jittered backoff; keep a shared cooldown so other metadata/list callers do not immediately evade it. Stop permanent permission/not-found/unsupported retries. Do not retry user aborts. Retried bytes/requests consume the same budget. A batch tool should batch application IDs, not silently invoke Google's separate HTTP batch API for media.

## Bounded local experiment performed

Ran installed 3.9.7 in Node with an instrumented subclass of its `ArrayFileReader`. Synthetic bytes only: one 2 MiB file containing ID3v2.3 title/artist/album and an opaque 256 KiB APIC frame payload; a second 2 MiB zero-filled file with no recognized tag signature. Selected only `title`, `artist`, `album` in both cases. `loadRange` recorded requested intervals, then called success asynchronously. No actual transport occurred and no audio decoding was attempted.

| Sample | Parser loadRange intervals, inclusive | Unique requested bytes | Peak overlapping callbacks | Result |
| --- | --- | ---: | ---: | --- |
| Text + APIC frame | `0–15`, `2097024–2097151`, `6–9`, `0–262242` | 262,371 | 2 | Three expected text fields, no artwork field returned. Entire 262,243-byte tag requested. |
| No recognized signature | `0–15`, `2097024–2097151` | 144 | 2 | `tagFormat: No suitable tag reader found`. |

The APIC payload is deliberately opaque because the selected-field filter should skip parsing it. This proves the requested-range behavior for this fixture, not correct artwork decoding. The zero-filled file is not a valid MP3 and does not establish reliable `no_tags` classification for every real audio file. `loadRange` calls are not automatically network requests: the custom reader should eliminate overlaps and serialize misses. These numbers are **not** real Google transfer, request-count or latency measurements.

Reproduction, from repository root (no generated file):

```sh
pnpm exec node <<'NODE'
const dir = './node_modules/.pnpm/jsmediatags@3.9.7/node_modules/jsmediatags/build2/';
const tags = require(dir + 'jsmediatags.js');
const ArrayReader = require(dir + 'ArrayFileReader.js');
const frame = (id, data) => {
  const h = Buffer.alloc(10); h.write(id); h.writeUInt32BE(data.length, 4);
  return Buffer.concat([h, data]);
};
const text = s => Buffer.concat([Buffer.from([0]), Buffer.from(s)]);
const body = Buffer.concat([
  frame('TIT2', text('Synthetic title')),
  frame('TPE1', text('Synthetic artist')),
  frame('TALB', text('Synthetic album')),
  frame('APIC', Buffer.alloc(262144, 1)),
]);
const h = Buffer.from([73,68,51,3,0,0,
  (body.length >>> 21)&127, (body.length >>> 14)&127,
  (body.length >>> 7)&127, body.length&127]);
async function probe(name, bytes) {
  const ranges = []; let active = 0; let peak = 0;
  class ProbeReader extends ArrayReader {
    loadRange(range, callbacks) {
      ranges.push(range); peak = Math.max(peak, ++active);
      setTimeout(() => { --active; callbacks.onSuccess(); }, 0);
    }
  }
  const result = await new Promise(resolve => new tags.Reader(bytes)
    .setFileReader(ProbeReader).setTagsToRead(['title','artist','album'])
    .read({onSuccess: resolve, onError: resolve}));
  const covered = new Set();
  for (const [a,b] of ranges) for (let i=a; i<=b; i++) covered.add(i);
  console.log({name, ranges, uniqueRequestedBytes: covered.size, peak, result});
}
(async () => {
  await probe('text_and_apic', Buffer.concat([h, body,
    Buffer.alloc(2097152-h.length-body.length)]));
  await probe('no_signature', Buffer.alloc(2097152));
})().catch(e => { console.error(e); process.exitCode = 1; });
NODE
```

## Proposed safe defaults, pending measured tuning

These are historical independent researcher proposals from October 15, not protocol limits or accepted product decisions. The updated [implementation plan](id3-metadata-plan.md) is authoritative for ALL product and engineering policy below, including automatic whole-Library warming, catalog startup, scheduling, persistence, UI, cache/cloud scope and byte/request budgets. Its automatic warming policy and 10-ID/15-second/2-MiB batch supersede the earlier opt-in/no-scan and larger-batch alternatives below. The primary-source findings and bounded local experiment remain evidence; the following defaults are retained as research history only.

- One global Drive transport request at a time initially. Playback loading first, user navigation/explicit actions next, metadata last. Stop or preempt metadata when playback needs the slot; never abort active playback to start metadata. Release the transport slot during retry delays while preserving an account-wide rate cooldown.
- Start MP3 metadata probing with a coalesced 16 KiB prefix and explicit 128-byte tail only when needed; cap total fetched bytes at 1 MiB/track and actual requests at 4/track, retries included. Prefer a precise remaining-tag read; oversize returns `budget_exceeded`, never a silent full audio download.
- Deduplicate by account + ID + content identity across UI and WebMCP. Track independent subscriber cancellation so one navigating UI does not cancel an explicit agent caller. Abort underlying work when no subscribers remain; clear queues on account change/logout.
- Cache successful text, validated empty supported tags and deterministic unsupported outcomes. Transient network/auth/rate errors use retry timing rather than permanent negative caching. Keep previous values explicitly stale until revalidation succeeds.
- Proposed bounded tool batch: 1–20 known IDs, 30-second call deadline, 5 MiB total media budget and 40 actual media requests, all including retries. Return per-track outcomes for completed and deferred items. The real host may require smaller deadlines; verify its cancellation contract before promising prompt cancellation.
- Folder warming: visible tracks first; remaining current-folder tracks may follow in bounded idle slices if the product decision enables it. Pause when hidden/offline, navigation changes, network is metered when detectable, or a byte/request budget is spent. Device/network hints are incomplete and cannot prove an unmetered connection. No automatic whole-Library scan by default.

## Minimal real-browser measurement still required

No live Drive or ChatGPT-browser measurement was performed by this researcher. Suggested first experiment:

1. Use 3–5 already imported MP3 tracks selected for small/large tags and suspected legacy/no tags; no folder-wide scan. Begin with a 16-byte range, at most 128 bytes at the end, and inspect 206/header visibility before any tag payload. A failed Range/CORS check stops that arm.
2. Stop at 1 MiB/track, 5 MiB total, 20 actual media requests, 60 seconds, or first rate/permission/network failure. Do not change playback. Never consume unexpected full responses.
3. Record only sanitized counters: requested/consumed body bytes, optional browser-observed transfer bytes, status/reason, requested Content-Range, exposed-header availability, queue wait, time to headers/body/parse, cache hit, retries, abort outcome. No token, authorization header, filename or private ID in saved notes. Browser transfer totals may include headers/preflights and differ from consumed body bytes.
4. Compare serial with concurrency 2 on the same bounded sample only after successful serial probes. Include normal Chrome and the actual ChatGPT website browser as distinct environments, with its real authenticated DriveBeats session and origin. Keep account/endpoint/sample comparable. Do not claim a concurrency effect from a single failed request; capture HTTP error vs CORS/network block vs host tool timeout separately.
5. Reopen the folder/session: unchanged tracks should make zero new media reads. Refresh metadata and test changed content through a controlled fixture or user-provided changed track without modifying Drive here. Simulate retry/abort/version races locally rather than provoking live rate limits.

The browser hypothesis remains **unconfirmed**. Official Drive, HTTP, Fetch and installed parser sources establish no general ChatGPT serial-only request rule. Local parser probes establish internal overlapping range requests; they do not identify the cause of previously reported search/data request failures. Actual tag distribution, CORS behavior, media quota accounting, latency, host cancellation behavior and playback interference remain acceptance work.
