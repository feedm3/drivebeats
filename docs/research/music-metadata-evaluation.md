# music-metadata evaluation

2026-10-22. Candidate: `music-metadata` **12.2.3**, `strtok3` **10.6.2**;
installed parser: `jsmediatags` **3.9.7**. Initial application revision:
`292607a`; final reviewed implementation: `1a188a9`. Research scripts and
generated evidence only; no candidate dependency was added to the application.

## Decision

**No-go: retain the reviewed jsmediatags implementation.** The candidate broadens
local tag support, but the measured ID3v2.3 text regression, continued MP3 artwork
transfer, larger browser bundle and retained custom transport/tokenizer work do
not satisfy “simpler and more robust.” The existing parser also extracts FLAC
and MP4 text when supplied with audio; FLAC alone is not a reason to replace it.

The requested prerequisite is [Check metadata fetching efficiency](codex://threads/01a16416-e0ff-7a91-b844-7c6e9b73e89f).
Its implementation, two review rounds and corrected-build Firefox verification
finished before this final assessment. Its application changes are recorded
separately in commit `1a188a9`; the reader source matches the saved measurement
hash. This evaluation implements no parser migration and changes no application
dependencies.

## Experiment and evidence

[Primary-source review](music-metadata-primary-sources.md) pins API and parser
behavior to the released source. The npm registry confirmed 12.2.3 during this
run. [Package](https://www.npmjs.com/package/music-metadata),
[versioned source](https://github.com/Borewit/music-metadata/tree/v12.2.3).

The reproducible [Node experiment](music-metadata-evaluation/run.mjs) generates
20-second stereo sine audio with local FFmpeg, adds structural ID3/artwork and
trailer variants, and parses **25 fixtures**. It uses the browser `core.js` API,
not `parseFile`. A custom `AbstractTokenizer` performs actual HTTP Range GETs
against an isolated localhost server and records the server's request spans and
response body bytes. No Google requests, credentials, paid service or real
library data are involved.

Five strategies were tried: exact token reads, random-access caching with
4-KiB or 64-KiB read-ahead, and forward-only 4-KiB or 64-KiB caching. All retain the
**four media requests / 1 MiB** per-track cap. Reads use `skipCovers: true`,
`duration: false`, `skipPostHeaders: true`, and a 1-MiB allocation guard. The guard
is a deliberate experiment setting, not a claim that local blobs must share the
remote limit. Sparse `ignore()` moves position without transferring audio.
The tokenizer preserves failures and checks them after parsing because parsers
can catch errors internally. A production reader would also need all existing
endpoint validation, scheduling and scope guards.

[Node results](music-metadata-evaluation/results.json) include every strategy,
range, byte count, tag result and error. [Browser experiment](music-metadata-evaluation/browser.mjs)
bundles the same tokenizer and uses fresh disposable Chrome 155 and Firefox 151
profiles. [Browser results](music-metadata-evaluation/browser-results.json)
confirm the local Blob, random-access 4-KiB and forward-only 4-KiB outcomes
in both engines.
The 64-KiB alternative is measured in Node with browser-compatible APIs, not
claimed as independently browser-verified.

| Fixture | Candidate local Blob | Candidate remote, 4-KiB cache: requests / bytes |
| --- | --- | --- |
| MP3, generated ID3 | All three fields | 2 / 4,224 |
| ID3v2.2, v2.3, v2.4 | All three fields each | 2 / 4,224 each |
| FLAC Vorbis comments | All three fields | 2 / 4,224 |
| M4A and same bytes named MP4; trailing `moov` | All three fields | 4 / 8,435 each |
| WAV INFO, before or after audio | All three fields | 2 / 4,224 each |
| Raw AAC / ADTS without tags | No target fields | 2 / 4,224 |
| Raw AAC / ADTS with ID3 prefix | All three fields | 2 / 4,224 |
| OGG Vorbis | All three fields | Deferred at 4 / 12,416; 64-KiB cache succeeds at 2 / 65,664 |
| MP3, ID3v1 trailer only | All three fields | 4 / 4,256 |
| Plausible tagless MP3 | No target fields | 2 / 4,224 |
| Zero-filled `.mp3` | Unknown type error | Deferred at 4 / 12,416; 64-KiB cache instead resolves empty tags |
| MP3, 256-KiB APIC payload | All three fields | 4 / 266,467; artwork bytes still transferred |
| MP3, 1,200,000-byte APIC payload, before or after text | Allocation guard rejects | Rejects after 2 / 4,224; no increase in allowances |
| FLAC, 1,200,000-byte standalone picture block | All three fields | 3 / 8,320; avoids reading the picture block in full |
| Unusual mixed-case frame ID before later artist | Expected title and artist | 4 / 24,298; warns about frame ID |
| Legacy raw v2.4 APIC frame size | Expected title | 2 / 4,224; warns about malformed following frames |
| Four 20,000-byte APIC frames before artist | Expected title and artist | 4 / 84,298 |
| Two 20,000-byte APIC frames before artist | Expected title and artist | 4 / 44,278 |
| Malformed oversized APIC frame length | Expected title | 4 / 24,256; warns about truncated frame data |
| ID3v2.3 tag-wide unsynchronization | **Wrong title** | **Wrong title**, 2 / 4,224 |

Three compatibility fixtures were added after the prerequisite chat's initial
Claude review; two more followed its focused review of malformed artwork
lengths and multiple-cover transfer efficiency. The candidate
retains their expected text fields; that is evidence in its favor, not a reason
to assume every malformed frame is fully decoded. The legacy v2.4 case checks
only its expected title, not cover interpretation.

APIC and FLAC picture payloads are structural synthetic filler, not real image
files. M4A and MP4 are the same encoded container with different names. FFmpeg's
ADTS output drops generic text metadata; that untagged sample is intentionally
separate from the explicit ID3-prefixed AAC fixture. File/container parsing does
not establish browser codec playback support.

## Why replacement fails the acceptance criteria

1. **Existing text behavior regresses.** The repository's global-unsynchronization
   fixture decodes as `AÿáB` with jsmediatags. Candidate 12.2.3 returns
   `Aÿ\u0000á`, including a NUL and losing the final character. This reproduces
   through local Blob and bounded tokenizer parsing in Chrome and Firefox.
   Trimming or selecting only common fields does not repair it. Retaining the
   old parser as a fallback or rewriting the ID3 envelope adds complexity.
2. **`skipCovers` does not make MP3 reads sparse.** The parser buffers the entire
   ID3 payload before ignoring APIC decoding. Exact token fetching exhausts four
   requests even on ordinary tagged fixtures because trailer probes and token
   reads consume separate requests. Read-ahead helps, but introduces tuning and
   overfetch. The 4-KiB strategy needs four reads for a 256-KiB APIC fixture;
   64-KiB needs four reads and 327,907 bytes. Forward-only avoids preflight
   trailer probes but then uses different buffering paths and fails that fixture
   at four 64-KiB reads. The added forward-only 4-KiB strategy matches the
   current reader's one 4-KiB ordinary-MP3 request, but fails the 256-KiB APIC
   fixture after four requests / 196,618 bytes because internal forward views
   chunk the payload. An ordinary-file request advantage for the current
   adapter therefore depends on candidate configuration; the artwork and
   correctness differences persist. This is not a drop-in request reduction.
3. **It does not remove the difficult code.** Endpoint Range/body validation,
   abort/deadline handling, shared budgets, sparse caching, account/version
   fencing, persisted cooldowns and complete/unknown/deferred classification
   remain necessary. The custom tokenizer and sticky-error check add an adapter
   layer. Matching the corrected reader's artwork skipping would still require
   custom ID3 frame projection because the candidate buffers the whole tag.
   Parser version also participates in every stored record's freshness,
   so a replacement needs an explicit revalidation policy rather than silently
   treating old outcomes as equivalent. Trusting a filename can also make malformed audio resolve with empty
   tags; parser success must not alone become durable `no_target_tags` coverage.
4. **The browser payload grows.** With esbuild 0.27.7, browser platform, ESM,
   ES2023 and minification, the public candidate entry retaining `parseBlob` and
   `parseFromTokenizer` is **271,541 bytes / 80,726 gzip**. jsmediatags retaining
   its Reader API is **52,062 bytes / 13,882 gzip**. Nonbrowser Node/React Native
   readers are stubbed for the latter, as browser-only consumers require. This
   is about **5.8x gzip**, a whole-library comparison rather than a measured
   Next.js route delta. Next.js could split parser modules on demand; no
   candidate production build was installed solely to estimate those chunks.

Local-Blob timings for the ordinary tagged MP3 (30 warm iterations; browser wall
time, not isolated CPU cycles) were Chrome median/p95 **2.9/3.6 ms** candidate vs
**3.0/3.2 ms** existing; Firefox **1/2 ms** vs **3/4 ms**. There is no demonstrated
CPU blocker in that sample. Chrome reported no long tasks during the synthetic
run; Firefox does not expose the Long Tasks entry type, so its empty list is
not proof of no long tasks. Mobile CPU and large-art UI responsiveness remain
unmeasured. The correctness/transfer evidence is the basis for the decision.

## Failure and integration boundaries

- Changed total size in `Content-Range` is rejected; a stalled request aborts at
  its deadline; pre-aborted parsing performs zero requests. One-request and
  32-byte budget experiments stop without exceeding the allowance. The MP4
  two-request case remains a budget error after parsing, never empty success.
- These are reader experiments, not end-to-end tests of the authenticated
  same-origin POST endpoint or Google request accounting. The existing proxy
  is retained. There is no full-download fallback and no allowance increase.
- The shared 50 Drive reads / 5 MiB per 120 seconds, up to two descriptor checks,
  persisted 30-minute-to-24-hour backoff, cache parser versions, WebMCP contracts,
  filename fallback, and account/logout/reset guards are outside the candidate
  experiment. No migration changes them or invalidates existing cache records.
- No real account was opened in the disposable browser profiles. No user Drive
  files or local user data were altered. Real-account integration, different
  private tag layouts, large MP4/OGG cover payloads, fragmented MP4, corrupted
  containers beyond these fixtures, iOS/Safari and device/offline behavior are
  not established. Source review describes additional risks without claiming
  those cases passed.

## Reproduce

Run from repository root. Prerequisites: local FFmpeg with MP3/AAC/FLAC/PCM and
native Vorbis encoders, Node >=22 and a permitted browser automation runtime.
Dependencies and generated audio stay in ignored `node_modules/.cache`.

```sh
mkdir -p node_modules/.cache/music-metadata-evaluation
pnpm --dir node_modules/.cache/music-metadata-evaluation --ignore-workspace add --ignore-scripts music-metadata@12.2.3 strtok3@10.6.2 esbuild@0.27.7
node docs/research/music-metadata-evaluation/run.mjs
node docs/research/music-metadata-evaluation/baseline.mjs
EVALUATION_PLAYWRIGHT_ROOT=/absolute/node_modules EVALUATION_FIREFOX_EXECUTABLE=/absolute/test-firefox node docs/research/music-metadata-evaluation/browser.mjs
```

Read the workspace browser-launch guide before the browser command and use the
required approved launch. The command creates disposable profiles, closes only
its own browsers, and serves generated fixtures on localhost. Chrome uses the
installed `chrome` channel. Firefox's executable is optional when the runtime's
matching browser is already installed. Missing engines are recorded as
unavailable, not passing. Browser errors after a successful launch fail the run.

## Concurrent implementation and final validation

The peer chat's final reviewed patch preserves jsmediatags text decoding while walking
ordinary ID3 frame headers sparsely. The [application-adapter harness](music-metadata-evaluation/baseline.mjs)
bundles that actual source and substitutes only its Drive range transport with
the synthetic HTTP server. The initial [292607a measurements](music-metadata-evaluation/baseline-results.json)
and [patched-source measurements](music-metadata-evaluation/baseline-after-efficiency-fix.json)
are separate; the latter records the reader source SHA-256.

| MP3 fixture | Initial adapter: ranges / bytes | Patched adapter: ranges / bytes | Candidate 4-KiB random access: ranges / bytes |
| --- | --- | --- | --- |
| Ordinary ID3v2.3 text | 2 / 89 | 1 / 4,096 | 2 / 4,224 |
| 256-KiB APIC, text first | 2 / 262,243 | 1 / 4,096 | 4 / 266,467 |
| 1.2-MB APIC, text first | Deferred after 1 / 16 | 1 / 4,096 | Allocation guard after 2 / 4,224 |
| 1.2-MB APIC, text after artwork | Not in initial sample | 2 / 4,175 | Allocation guard after 2 / 4,224 |
| Global-unsynchronization text | 2 / 26, correct | 1 / 4,096, correct | 2 / 4,224, corrupted |

Chrome and Firefox also ran the patched application reader in the isolated
browser harness: all those MP3 cases returned correct text, and malformed MP3
still returned `parse_error`. These measurements exclude descriptor checks.
The peer loader now uses a complete known descriptor before the media read and
checks the descriptor afterward; a normal known MP3 therefore needs one media
range plus one final descriptor GET. Unknown descriptors can still require an
initial strengthening request.

The reviewed reader also returns the expected legacy fields: unusual frame IDs
use 2 ranges / 20,074 bytes, raw v2.4 sizes use 1 / 4,096, four artwork frames use
4 / 32,310, two artwork frames use 3 / 8,204, and a malformed oversized artwork
length uses 1 / 4,096. Its bounded full-tag fallback preserves compatibility
without exceeding the original per-track allowance; it can transfer some
artwork, so the optimization is not a promise of 4-KiB reads for every layout.
The candidate retains the expected fields in these fixtures too, but its random
4-KiB strategy uses 84,298 bytes for four artwork frames and 44,278 for two.

The patch also fixes publishing coverage during ongoing extraction, validates
failed decoding against the final descriptor before saving an outcome, and bumps
range strategy 2 to 3 so appropriate
old reading-limit outcomes can retry. Those are transport/cache/progress changes
that replacing a parser would not itself fix. The parser version remains
`jsmediatags-3.9.7-text-1`.

**Separate policy difference:** the concurrent patch raises the shared automatic
request ceiling from **50 to 120 per 120 seconds** and reduces pacing from
1,000 to 250 ms; its shared 5-MiB byte ceiling remains. That differs from the
original evaluation constraint. This research neither introduced nor depends
on that higher ceiling, and did not change or revert another chat's patch.
Candidate comparisons still enforce four media ranges / 1 MiB. The same
request/byte comparison remains favorable to retaining the patched reader at
either shared request ceiling.

The final source SHA-256 matches the application adapter measured in the saved
results. Review fixed the sparse reader's compatibility regressions and the
loader's failed-decode version validation; these corrections were incorporated
in the assessment rather than judged against the earlier incomplete patch.
They do not fix the candidate's independent unsynchronization regression or
its need to buffer MP3 artwork. Keeping the corrected implementation avoids a
parser migration and cache revalidation without losing these request savings.

Final checks performed in this chat after the review corrections:

- `pnpm test`: **741 passed in 69 files**. Includes existing cache, durable
  coverage, descriptor/version, deferred/backoff, account/logout/reset, scheduler
  and WebMCP regression coverage. The 25-fixture experiment is separate and is
  not added to that test count.
- `pnpm lint`: passed, including TypeScript. Existing Biome configuration/
  broken-symlink and oversized `logo.svg` notices remain.
- `pnpm build`: passed.
- `git diff --check` and scoped Biome checks for the research harness: passed.
- React Doctor **0.9.18**, `--scope changed --base 292607a --no-supply-chain`:
  **88/100**, zero errors, two `async-await-in-loop` warnings in
  `drive-metadata-reader.ts`. Reviewed: the first serializes sparse range reads
  to preserve per-track accounting and cancellation; the second awaits the
  compatibility fallback once and immediately returns. Parallelizing either
  would not be an appropriate fix. No configuration or suppression was added.
  The earlier 100/100 score preceded the review corrections and is superseded.
- Disposable Chrome **155** and Firefox **151**: **25 fixtures each**, local
  Blob plus bounded random-access and forward-only 4-KiB candidate readers,
  and the final application adapter for the MP3 fixtures. Text-corruption,
  large-artwork, legacy-frame and malformed-frame outcomes reproduce in both.
- The prerequisite chat separately verified the local production app in Firefox
  with synthetic account/Google responses: live and deliberately slowed coverage
  scans, cache reuse after reload, budget pause/resume, audio playback during a
  metadata pause, and 320/428/1280-pixel layouts. These are its application-flow
  measurements, not an additional real-account test performed by this research.

No real-account parser migration, deployed-host/provider test, Safari/iOS test
or cloud-data mutation was performed. The glossary and existing native-wrapper
research were preserved. This chat adds research files only; the prerequisite
chat owns the reviewed application patch and its commit/push workflow.
