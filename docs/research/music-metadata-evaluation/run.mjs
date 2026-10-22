// Isolated evaluation only; no application imports, credentials, or real Drive data.
// See ../music-metadata-evaluation.md for setup and interpretation.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const work = resolve(root, "node_modules/.cache/music-metadata-evaluation");
const deps = createRequire(join(work, "package.json"));
const mmPath = resolve(deps.resolve("music-metadata"), "../core.js");
const mm = await import(pathToFileURL(mmPath));
const { AbstractTokenizer, EndOfStreamError } = await import(
  pathToFileURL(deps.resolve("strtok3/core"))
);
const oldRequire = createRequire(
  join(root, "apps/drivebeats-web/package.json"),
);
const old = oldRequire("jsmediatags");
const fixturesDir = join(work, "fixtures");
mkdirSync(fixturesDir, { recursive: true });
const target = {
  title: "Synthetic title",
  artist: "Synthetic artist",
  album: "Synthetic album",
};
const fields = (m) =>
  Object.fromEntries(
    Object.keys(target)
      .filter((k) => typeof m[k] === "string" && m[k].trim())
      .map((k) => [k, m[k].trim()]),
  );
const syncsafe = (n) => [
  (n >>> 21) & 127,
  (n >>> 14) & 127,
  (n >>> 7) & 127,
  n & 127,
];
const be32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
function id3(version, art = 0) {
  const frame = (id, value) => {
    const data =
      typeof value === "number"
        ? Buffer.alloc(value, 1)
        : Buffer.from(`\0${value}`, "latin1");
    const h = Buffer.alloc(version === 2 ? 6 : 10);
    h.write(id);
    if (version === 2) h.writeUIntBE(data.length, 3, 3);
    else if (version === 4) Buffer.from(syncsafe(data.length)).copy(h, 4);
    else h.writeUInt32BE(data.length, 4);
    return Buffer.concat([h, data]);
  };
  const body = Buffer.concat([
    frame(version === 2 ? "TT2" : "TIT2", target.title),
    frame(version === 2 ? "TP1" : "TPE1", target.artist),
    frame(version === 2 ? "TAL" : "TALB", target.album),
    ...(art ? [frame(version === 2 ? "PIC" : "APIC", art)] : []),
  ]);
  return Buffer.concat([
    Buffer.from([73, 68, 51, version, 0, 0, ...syncsafe(body.length)]),
    body,
  ]);
}
const files = new Map();
for (const [ext, codec, format] of [
  ["mp3", "libmp3lame", "mp3"],
  ["flac", "flac", "flac"],
  ["m4a", "aac", "mp4"],
  ["wav", "pcm_s16le", "wav"],
  ["aac", "aac", "adts"],
  ["ogg", "vorbis", "ogg"],
]) {
  const path = join(fixturesDir, `tagged.${ext}`);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "20",
    "-ac",
    "2",
    "-c:a",
    codec,
    "-strict",
    "experimental",
    ...Object.entries(target).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]),
    "-f",
    format,
    path,
  ]);
  files.set(`tagged.${ext}`, readFileSync(path));
}
const mp3 = files.get("tagged.mp3");
const audioStart =
  10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]);
const audio = mp3.subarray(audioStart);
for (const ver of [2, 3, 4])
  files.set(`id3v2${ver}.mp3`, Buffer.concat([id3(ver), audio]));
for (const art of [262144, 1200000])
  files.set(`art-${art}.mp3`, Buffer.concat([id3(3, art), audio]));
const artFirst = id3(3, 1200000);
files.set(
  "art-first.mp3",
  Buffer.concat([
    artFirst.subarray(0, 10),
    artFirst.subarray(89),
    artFirst.subarray(10, 89),
    audio,
  ]),
);
for (const kind of [
  "unusual-id",
  "raw-v24-size",
  "several-artworks",
  "two-artworks",
  "malformed-art-length",
]) {
  const frame = (id, value) => {
    const payload =
      typeof value === "number"
        ? Buffer.alloc(value, 1)
        : Buffer.from(`\0${value}`, "latin1");
    return Buffer.concat([
      Buffer.from(id),
      be32(
        kind === "malformed-art-length" && id === "APIC"
          ? 100000
          : payload.length,
      ),
      Buffer.alloc(2),
      payload,
    ]);
  };
  const body = Buffer.concat([
    frame("TIT2", "T"),
    ...(kind === "unusual-id" ? [frame("Xyz1", 20)] : []),
    ...Array.from(
      {
        length:
          kind === "several-artworks" ? 4 : kind === "two-artworks" ? 2 : 1,
      },
      () => frame("APIC", kind === "raw-v24-size" ? 200 : 20000),
    ),
    ...(["raw-v24-size", "malformed-art-length"].includes(kind)
      ? []
      : [frame("TPE1", "A")]),
  ]);
  files.set(
    `${kind}.mp3`,
    Buffer.concat([
      Buffer.from([
        73,
        68,
        51,
        kind === "raw-v24-size" ? 4 : 3,
        0,
        0,
        ...syncsafe(body.length),
      ]),
      body,
      audio,
    ]),
  );
}
const v1 = Buffer.alloc(128);
v1.write("TAG");
v1.write(target.title, 3);
v1.write(target.artist, 33);
v1.write(target.album, 63);
files.set("tail-v1.mp3", Buffer.concat([audio, v1]));
files.set("tagless.mp3", audio);
files.set("tagged.mp4", files.get("tagged.m4a"));
files.set("id3.aac", Buffer.concat([id3(3), files.get("tagged.aac")]));
files.set("malformed.mp3", Buffer.alloc(65536));
const uh = Buffer.concat([Buffer.from("TIT2"), be32(5), Buffer.alloc(2)]);
const ub = Buffer.concat([uh, Buffer.from([0, 65, 255, 0, 225, 66])]);
files.set(
  "global-unsync.mp3",
  Buffer.concat([
    Buffer.from([73, 68, 51, 3, 0, 128, ...syncsafe(ub.length)]),
    ub,
    audio,
  ]),
);
const flac = files.get("tagged.flac");
const picture = Buffer.concat([
  Buffer.from([6, 0x12, 0x4f, 0x80]),
  Buffer.alloc(1200000),
]);
files.set(
  "flac-art.flac",
  Buffer.concat([flac.subarray(0, 42), picture, flac.subarray(42)]),
);
const wav = files.get("tagged.wav");
const listStart = wav.indexOf(Buffer.from("LIST"));
if (listStart >= 0) {
  const listEnd = listStart + 8 + wav.readUInt32LE(listStart + 4);
  files.set(
    "tail-info.wav",
    Buffer.concat([
      wav.subarray(0, listStart),
      wav.subarray(listEnd),
      wav.subarray(listStart, listEnd),
    ]),
  );
}
for (const [name, bytes] of files)
  writeFileSync(join(fixturesDir, name), bytes);
let active;
const server = createServer((req, res) => {
  const data = files.get(decodeURIComponent(req.url.slice(1)));
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
  if (!data || !match) {
    res.writeHead(400).end();
    return;
  }
  const start = Number(match[1]),
    end = Number(match[2]);
  active.requests.push([start, end]);
  if (active.mode === "stall") return;
  active.bytes += end - start + 1;
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${active.mode === "version" ? data.length + 1 : data.length}`,
    "Content-Length": end - start + 1,
  });
  res.end(data.subarray(start, end + 1));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
class SparseTokenizer extends AbstractTokenizer {
  constructor(
    name,
    readAhead,
    random,
    signal,
    maxBytes = 1048576,
    maxRequests = 4,
  ) {
    super({ maxBufferSize: 1048576 });
    this.fileInfo = { path: name, size: files.get(name).length };
    Object.assign(this, {
      name,
      readAhead,
      random,
      signal,
      maxBytes,
      maxRequests,
      chunks: [],
      requests: 0,
      bytes: 0,
    });
  }
  supportsRandomAccess() {
    return this.random;
  }
  setPosition(p) {
    this.signal.throwIfAborted();
    this.position = p;
  }
  async readBuffer(dst, opts) {
    const p = opts?.position ?? this.position;
    const n = await this.peekBuffer(dst, opts);
    this.position = p + n;
    return n;
  }
  async peekBuffer(dst, opts) {
    try {
      return await this.readSparse(dst, opts);
    } catch (e) {
      this.failure = e;
      throw e;
    }
  }
  async readSparse(dst, opts) {
    this.signal.throwIfAborted();
    const o = this.normalizeOptions(dst, opts);
    const length = Math.min(o.length, this.fileInfo.size - o.position);
    if (length < o.length && !o.mayBeLess) throw new EndOfStreamError();
    let cursor = o.position;
    while (cursor < o.position + length) {
      let c = this.chunks.find(
        (c) => cursor >= c.start && cursor < c.start + c.bytes.length,
      );
      if (!c) {
        const next = this.chunks
          .filter((c) => c.start > cursor)
          .sort((a, b) => a.start - b.start)[0];
        const count = Math.min(
          this.fileInfo.size - cursor,
          next ? next.start - cursor : Infinity,
          Math.max(o.position + length - cursor, this.readAhead),
        );
        if (
          this.requests >= this.maxRequests ||
          this.bytes + count > this.maxBytes
        )
          throw new Error("budget_exceeded");
        this.requests++;
        const response = await fetch(`${origin}/${this.name}`, {
          headers: { Range: `bytes=${cursor}-${cursor + count - 1}` },
          signal: this.signal,
        });
        if (
          response.status !== 206 ||
          response.headers.get("Content-Range") !==
            `bytes ${cursor}-${cursor + count - 1}/${this.fileInfo.size}`
        ) {
          await response.body.cancel();
          throw new Error("version_changed");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        this.signal.throwIfAborted();
        if (bytes.length !== count) throw new Error("truncated_range");
        this.bytes += bytes.length;
        c = { start: cursor, bytes };
        this.chunks.push(c);
      }
      const n = Math.min(
        c.start + c.bytes.length - cursor,
        o.position + length - cursor,
      );
      dst.set(
        c.bytes.subarray(cursor - c.start, cursor - c.start + n),
        cursor - o.position,
      );
      cursor += n;
    }
    return length;
  }
}
async function remote(name, readAhead, random, mode, limits = {}) {
  active = { requests: [], bytes: 0, mode };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Deadline", "TimeoutError")),
    mode === "stall" ? 30 : 3000,
  );
  const t = new SparseTokenizer(
    name,
    readAhead,
    random,
    controller.signal,
    limits.bytes,
    limits.requests,
  );
  const start = performance.now();
  let result;
  try {
    const m = await mm.parseFromTokenizer(t, {
      skipCovers: true,
      duration: false,
      skipPostHeaders: true,
      maxMemoryAllocation: 1048576,
    });
    controller.signal.throwIfAborted();
    if (t.failure) throw t.failure;
    result = {
      tags: fields(m.common),
      warnings: m.quality.warnings.map((w) => w.message),
    };
  } catch (e) {
    result = { error: e.message };
  } finally {
    clearTimeout(timer);
  }
  return {
    ...result,
    requests: active.requests,
    bytes: active.bytes,
    ms: +(performance.now() - start).toFixed(2),
  };
}
const results = [];
try {
  for (const [name, bytes] of files) {
    const localStart = performance.now();
    let local;
    try {
      local = {
        tags: fields(
          (
            await mm.parseBlob(new Blob([bytes]), {
              skipCovers: true,
              duration: false,
              maxMemoryAllocation: 1048576,
            })
          ).common,
        ),
      };
    } catch (e) {
      local = { error: e.message };
    }
    local.ms = +(performance.now() - localStart).toFixed(2);
    const previous = await new Promise((resolve) =>
      new old.Reader([...bytes])
        .setTagsToRead(["title", "artist", "album"])
        .read({
          onSuccess: (r) => resolve({ tags: fields(r.tags) }),
          onError: (e) => resolve({ error: e.type }),
        }),
    );
    const random4k = await remote(name, 4096, true);
    const exact = await remote(name, 0, true);
    const random64k = await remote(name, 65536, true);
    const forward4k = await remote(name, 4096, false);
    const forward64k = await remote(name, 65536, false);
    results.push({
      name,
      size: bytes.length,
      local,
      previous,
      exact,
      random4k,
      random64k,
      forward4k,
      forward64k,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  for (const r of results) {
    for (const strategy of [
      "exact",
      "random4k",
      "random64k",
      "forward4k",
      "forward64k",
    ]) {
      assert.ok(r[strategy].requests.length <= 4);
      assert.ok(r[strategy].bytes <= 1048576);
    }
    if (
      [
        "tagged.mp3",
        "tagged.flac",
        "tagged.m4a",
        "tagged.mp4",
        "tagged.wav",
        "tagged.ogg",
        "id3v22.mp3",
        "id3v23.mp3",
        "id3v24.mp3",
        "tail-v1.mp3",
        "flac-art.flac",
        "tail-info.wav",
        "id3.aac",
      ].includes(r.name)
    )
      assert.deepEqual(r.local.tags, target);
  }
  assert.equal(
    results.find((r) => r.name === "global-unsync.mp3").previous.tags.title,
    "AÿáB",
  );
  assert.notEqual(
    results.find((r) => r.name === "global-unsync.mp3").local.tags.title,
    "AÿáB",
  );
  const faultChecks = {};
  for (const mode of ["version", "stall"])
    faultChecks[mode] = await remote("id3v23.mp3", 65536, true, mode);
  faultChecks.requestBudget = await remote(
    "id3v23.mp3",
    65536,
    true,
    undefined,
    { requests: 1 },
  );
  faultChecks.mp4Budget = await remote("tagged.m4a", 65536, true, undefined, {
    requests: 2,
  });
  faultChecks.byteBudget = await remote("id3v23.mp3", 65536, true, undefined, {
    bytes: 32,
  });
  assert.equal(faultChecks.version.error, "version_changed");
  assert.equal(faultChecks.byteBudget.bytes, 0);
  assert.equal(faultChecks.requestBudget.requests.length, 1);
  assert.equal(faultChecks.stall.error, "Deadline");
  const aborted = new AbortController();
  aborted.abort(new DOMException("Cancelled", "AbortError"));
  active = { requests: [], bytes: 0 };
  try {
    await mm.parseFromTokenizer(
      new SparseTokenizer("id3v23.mp3", 65536, true, aborted.signal),
      { skipCovers: true },
    );
  } catch (e) {
    faultChecks.preAborted = {
      error: e.message,
      requests: active.requests,
      bytes: active.bytes,
    };
  }
  assert.equal(faultChecks.preAborted.bytes, 0);
  const esbuild = deps("esbuild");
  const browserSource = `import{AbstractTokenizer,EndOfStreamError}from 'strtok3/core';export{parseBlob,parseFromTokenizer}from 'music-metadata';const origin=location.origin;export ${SparseTokenizer.toString().replace("files.get(name).length", "globalThis.fixtureSizes[name]")}`;
  const browserTokenizer = await esbuild.build({
    stdin: { contents: browserSource, resolveDir: work },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2023",
    minify: true,
    write: false,
  });
  writeFileSync(
    join(work, "candidate-tokenizer-browser.mjs"),
    browserTokenizer.outputFiles[0].contents,
  );
  const bundles = {};
  for (const [name, source] of [
    [
      "candidate",
      `export {parseFromTokenizer,parseBlob} from 'music-metadata'`,
    ],
    [
      "previous",
      `import tags from ${JSON.stringify(oldRequire.resolve("jsmediatags"))};export default tags`,
    ],
  ]) {
    const bundle = await esbuild.build({
      stdin: { contents: source, resolveDir: work, sourcefile: `${name}.mjs` },
      plugins: [
        {
          name: "omit-non-browser-readers",
          setup(build) {
            build.onResolve(
              { filter: /\/(NodeFileReader|ReactNativeFileReader)$/ },
              (args) => ({ path: args.path, namespace: "empty-reader" }),
            );
            build.onLoad({ filter: /.*/, namespace: "empty-reader" }, () => ({
              contents:
                "module.exports = class { static canReadFile() { return false; } };",
              loader: "js",
            }));
          },
        },
      ],
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2023",
      minify: true,
      write: false,
    });
    const bytes = bundle.outputFiles[0].contents;
    bundles[name] = { bytes: bytes.length, gzip: gzipSync(bytes).length };
    writeFileSync(join(work, `${name}-browser.mjs`), bytes);
  }
  const report = {
    versions: {
      musicMetadata: "12.2.3",
      strtok3: "10.6.2",
      jsmediatags: "3.9.7",
      node: process.version,
    },
    policy: {
      maxBytes: 1048576,
      maxMediaRequests: 4,
      readAhead: 65536,
      skipCovers: true,
      skipPostHeaders: true,
      duration: false,
    },
    results,
    faultChecks,
    bundles,
  };
  writeFileSync(
    join(work, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({ faultChecks, bundles }));
} finally {
  server.closeAllConnections();
  server.close();
}
