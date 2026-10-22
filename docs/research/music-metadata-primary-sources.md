# music-metadata 12.2.3: primary-source review

Reviewed 2026-10-22. Research only; no dependency or application change. Sources
below are pinned to `v12.2.3` (`strtok3` to `v10.6.2`, its declared minimum).
This is source evidence, not a claim that real Drive files meet our transfer
budget or that any browser/device has passed integration testing.

## Assessment

`music-metadata` is suitable for a browser-side experiment and has useful wider
container support. It does **not** supply a ready-made bounded Drive reader.
Its native read strategy can consume artwork bytes even with `skipCovers`,
perform extra trailer probes, and absorb some tokenizer errors. A migration
would still need our authenticated range transport, scheduler, cache/fencing,
budget enforcement, cancellation, and outcome classification. Whether it is
simpler must therefore be decided against measured fixtures and the final
implementation from the concurrent metadata chat.

## Browser integration and limits

- The package is MIT, pure ESM, declares `sideEffects: false`, and exports
  `lib/core.js` under the default condition and `lib/index.js` under `node`.
  There are ten direct runtime dependencies, including `file-type`, `strtok3`
  and text decoding utilities. The engine declaration is Node >=22; that is
  not a browser compatibility guarantee. [Package manifest](https://github.com/Borewit/music-metadata/blob/v12.2.3/package.json)
- `parseBlob()` constructs a Blob tokenizer and closes it in `finally`.
  `parseFromTokenizer()` passes a caller-owned tokenizer to `ParserFactory`
  and does not close it. A custom reader can therefore use our existing
  same-origin authenticated range endpoint without another fetch library.
  [Browser API implementation](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/core.ts#L49-L107)
- The Blob tokenizer reads `blob.slice(...).arrayBuffer()`; it does not require
  loading the whole audio Blob into an additional complete ArrayBuffer.
  [BlobTokenizer](https://github.com/Borewit/strtok3/blob/v10.6.2/lib/BlobTokenizer.ts#L27-L67)
- `maxMemoryAllocation` defaults to 64 MiB and caps individual payloads,
  accumulated Ogg packets, and lookahead. It is neither a cumulative network
  byte allowance nor a process-memory/CPU cap. Use a suitably low explicit
  parser allocation limit and also configure the supplied tokenizer's
  `maxBufferSize`. Keep the independent four-range/1-MiB remote limit.
  [Allocation implementation](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/common/Allocation.ts)
- Options expose no title/artist/album-only read filter. `duration: false` and
  `includeChapters: false` avoid optional scans; `skipCovers: true` suppresses
  cover extraction, with container-specific download consequences below.
  [IOptions](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/type.ts#L680-L709)
- `IOptions` has no AbortSignal option. The custom tokenizer must enforce the
  caller signal, deadlines and sticky failure state itself; passing a tokenizer
  does not cause `parseFromTokenizer()` to configure these. The base tokenizer's
  default `abort()` only removes its listener. [Tokenizer lifecycle](https://github.com/Borewit/strtok3/blob/v10.6.2/lib/AbstractTokenizer.ts#L35-L60),
  [default abort](https://github.com/Borewit/strtok3/blob/v10.6.2/lib/AbstractTokenizer.ts#L240-L243)

## Container-specific sparse-read implications

| Format | Confirmed source behavior | Consequence for DriveBeats |
| --- | --- | --- |
| MP3 / ID3 | `parseId3Data` buffers the complete advertised ID3 payload before dispatching frames; `skipCovers` is applied when decoding APIC/PIC. | A large cover inside ID3 still consumes transfer bytes. An ID3 tag over 1 MiB must defer under the present cap. A sparse APIC-skipping projection would be additional custom parser machinery. [ID3 payload reading](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/ID3v2Parser.ts#L135-L216), [cover decoding](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/FrameParser.ts#L234-L279) |
| FLAC | Iterates metadata-block headers; PICTURE uses tokenizer `ignore()` when skipping covers. Vorbis comment blocks are buffered in full. | A sparse tokenizer can skip standalone pictures without fetching them. Oversized comment blocks remain bounded/deferred. ID3-prefixed FLAC inherits the ID3 limitation. [FLAC parser](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/flac/FlacParser.ts#L19-L123) |
| M4A / MP4 | Traverses atom headers and skips `mdat` when chapters are disabled. A metadata `data` atom is read before JPEG/PNG skip checks. | A trailing `moov` is reachable without downloading audio if `ignore()` only advances position, but many scattered atoms can exhaust four ranges. Large `covr` still costs bytes unless custom handling removes it. [Atom traversal](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mp4/MP4Parser.ts#L223-L251), [data atom](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mp4/MP4Parser.ts#L457-L519), [mdat](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mp4/MP4Parser.ts#L936-L950) |
| WAV | Walks RIFF chunks, skips audio `data`, handles LIST/INFO and embedded ID3 chunks. | End-of-file INFO can be reached sparsely. Fragmented chunks or large embedded ID3 can exceed the same allowances. [WAV parser](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/wav/WaveParser.ts#L61-L205) |
| OGG | Reads complete page payloads. Early stopping requires page number >12 and complete metadata, unless EOS is reached first. Vorbis comments are accumulated; picture strings are read before `skipCovers` avoids base64 picture decoding. | May read audio pages beyond the comment. Artwork in comment packets still costs bytes. An early small successful fixture does not prove a large-comment OGG fits. [Page reading and stop condition](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ogg/OggParser.ts#L43-L47), [stop loop](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ogg/OggParser.ts#L124-L149), [Vorbis buffering](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ogg/vorbis/VorbisStream.ts#L37-L101) |
| Raw AAC / ADTS | Uses the MPEG/ID3 parser, reads three ADTS frames with duration disabled, then stops. | ID3 title tags can work, but untagged ADTS has no intrinsic title/artist/album. ID3 prefix and trailing-header limitations still apply. [MPEG loader](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mpeg/MpegLoader.ts), [ADTS loop](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mpeg/MpegParser.ts#L248-L275) |

## Correctness traps to cover in experiments

1. **Trailer probes happen before format parsing.** `ParserFactory.parse()`
   unconditionally calls `scanAppendingHeaders()` for random-access tokenizers.
   That probes ID3v1, lyrics when applicable, and APE. `skipPostHeaders: true`
   does not disable this preflight. For ID3-family parsers, it only avoids the
   later ID3v1 step when `metadata.hasAny()` is true. Account for actual probes
   and cache/coalesce them rather than assuming zero tail reads.
   [Factory](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ParserFactory.ts#L97-L108),
   [scan](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/core.ts#L144-L153),
   [post-header condition](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/AbstractID3Parser.ts#L41-L51)
2. **Tag-wide ID3v2.3 unsynchronization needs an explicit fixture.** The header
   decoder records that flag, but the reviewed ID3v2 parser only removes unsync
   bytes based on per-frame flags. Do not infer v2.3 tag-wide support from
   advertised ID3 support. This is a source-based concern, not a measured failure
   in this research pass. [Header flag](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/ID3v2Token.ts),
   [per-frame handling and parse loop](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/ID3v2Parser.ts#L50-L70)
3. **A resolved parse is insufficient evidence of completeness.** The MP4 root
   loop catches any `Error` from its atom peek, records a warning, and breaks;
   ID3/OGG also tolerate genuine end-of-stream in selected paths. A custom
   tokenizer budget/abort failure must remain sticky and be checked after the
   parser resolves. Otherwise an interrupted scan could become persisted
   `no_target_tags` or misleadingly complete coverage.
   [MP4 catch](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mp4/MP4Parser.ts#L225-L243),
   [ID3 EOF](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/id3v2/AbstractID3Parser.ts#L20-L30),
   [OGG EOF](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ogg/OggParser.ts#L150-L160)

## Bundle and CPU: what remains unconfirmed

The source uses dynamic parser imports and marks the package side-effect free,
which gives the bundler useful splitting/tree-shaking opportunities. That does
not establish the final Next.js client transfer size. The public entry still
registers many parser loaders and imports shared format detection/tag mapping.
[Factory](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/ParserFactory.ts),
[example lazy loader](https://github.com/Borewit/music-metadata/blob/v12.2.3/lib/mpeg/MpegLoader.ts#L7-L9)

No browser CPU, responsiveness or bundle measurement was performed in this
source-review subtask. Measure production compressed chunks, cold parser import,
representative large-art parse time and UI responsiveness in the experiment.
Synchronous text/frame decoding and native/common tag collection still occur
even when the application retains only three common text values. No paid
service is required by the reviewed package; the package itself supplies no
Drive transport, so our transport determines request cost.
