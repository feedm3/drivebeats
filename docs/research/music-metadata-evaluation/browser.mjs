// Synthetic browser experiment. Does not open the application or use account data.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = process.cwd();
const work = resolve(root, "node_modules/.cache/music-metadata-evaluation");
const runtime = process.env.EVALUATION_PLAYWRIGHT_ROOT;
if (!runtime)
  throw new Error(
    "Set EVALUATION_PLAYWRIGHT_ROOT to a package directory containing playwright",
  );
const { chromium, firefox } = createRequire(join(runtime, "package.json"))(
  "playwright",
);
const report = JSON.parse(readFileSync(join(work, "results.json"), "utf8"));
const fixtureSizes = Object.fromEntries(
  report.results.map((r) => [r.name, r.size]),
);
const wire = [];
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Isolated parser evaluation</title>");
    return;
  }
  const name = decodeURIComponent(req.url.slice(1));
  if (
    ![
      "application-reader.mjs",
      "candidate-browser.mjs",
      "candidate-tokenizer-browser.mjs",
      "previous-browser.mjs",
      ...Object.keys(fixtureSizes),
    ].includes(name)
  ) {
    res.writeHead(404).end();
    return;
  }
  const bytes = readFileSync(
    join(work, name.endsWith(".mjs") ? name : `fixtures/${name}`),
  );
  if (name.endsWith(".mjs"))
    res.setHeader("Content-Type", "application/javascript");
  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
  if (m) {
    const start = Number(m[1]),
      end = Number(m[2]);
    wire.push({ name, start, end, bytes: end - start + 1 });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Content-Length": end - start + 1,
    });
    res.end(bytes.subarray(start, end + 1));
  } else res.end(bytes);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const results = {};
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["firefox", firefox],
  ]) {
    let browser;
    try {
      browser = await engine.launch({
        headless: true,
        ...(name === "chromium"
          ? { channel: "chrome" }
          : { executablePath: process.env.EVALUATION_FIREFOX_EXECUTABLE }),
      });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      results[name] = await page.evaluate(
        async ({ fixtureSizes }) => {
          globalThis.fixtureSizes = fixtureSizes;
          globalThis.evaluationOrigin = location.origin;
          const { readDriveTrackMetadata } = await import(
            "/application-reader.mjs"
          );
          const { parseBlob, parseFromTokenizer, SparseTokenizer } =
            await import("/candidate-tokenizer-browser.mjs");
          const previous = (await import("/previous-browser.mjs")).default;
          const fields = (m) =>
            Object.fromEntries(
              ["title", "artist", "album"]
                .filter((k) => typeof m[k] === "string")
                .map((k) => [k, m[k].trim()]),
            );
          const samples = [];
          const longTasks = [];
          const observer =
            typeof PerformanceObserver !== "undefined" &&
            PerformanceObserver.supportedEntryTypes.includes("longtask")
              ? new PerformanceObserver((l) =>
                  longTasks.push(...l.getEntries().map((e) => e.duration)),
                )
              : null;
          observer?.observe({ type: "longtask" });
          for (const file of Object.keys(fixtureSizes)) {
            const blob = await (await fetch(`/${file}`)).blob();
            let local;
            try {
              local = {
                tags: fields(
                  (
                    await parseBlob(blob, {
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
            const old = await new Promise((resolve) =>
              new previous.Reader(blob)
                .setTagsToRead(["title", "artist", "album"])
                .read({
                  onSuccess: (r) => resolve({ tags: fields(r.tags) }),
                  onError: (e) => resolve({ error: e.type }),
                }),
            );
            const tokenizer = new SparseTokenizer(
              file,
              4096,
              true,
              new AbortController().signal,
            );
            let remote;
            try {
              const m = await parseFromTokenizer(tokenizer, {
                skipCovers: true,
                duration: false,
                skipPostHeaders: true,
                maxMemoryAllocation: 1048576,
              });
              if (tokenizer.failure) throw tokenizer.failure;
              remote = { tags: fields(m.common) };
            } catch (e) {
              remote = { error: e.message };
            }
            const forward = new SparseTokenizer(
              file,
              4096,
              false,
              new AbortController().signal,
            );
            let remoteForward4k;
            try {
              const m = await parseFromTokenizer(forward, {
                skipCovers: true,
                duration: false,
                skipPostHeaders: true,
                maxMemoryAllocation: 1048576,
              });
              if (forward.failure) throw forward.failure;
              remoteForward4k = { tags: fields(m.common) };
            } catch (e) {
              remoteForward4k = { error: e.message };
            }
            remoteForward4k.requests = forward.requests;
            remoteForward4k.bytes = forward.bytes;
            let application;
            if (file.endsWith(".mp3")) {
              globalThis.evaluationRanges = [];
              try {
                application = {
                  outcome: await readDriveTrackMetadata({
                    fileId: file,
                    size: fixtureSizes[file],
                    accessToken: "synthetic",
                    signal: AbortSignal.timeout(3000),
                    requestOptions: {},
                    assertCurrent() {},
                  }),
                };
              } catch (e) {
                application = { error: e.code ?? e.message };
              }
              application.ranges = globalThis.evaluationRanges;
            }
            samples.push({
              application,
              remoteForward4k,
              file,
              local,
              old,
              remote: {
                ...remote,
                requests: tokenizer.requests,
                bytes: tokenizer.bytes,
              },
            });
          }
          const blob = await (await fetch("/tagged.mp3")).blob();
          const timings = {};
          for (const parser of ["candidate", "previous"]) {
            const samples = [];
            for (let i = 0; i < 30; i++) {
              const start = performance.now();
              if (parser === "candidate")
                await parseBlob(blob, { skipCovers: true, duration: false });
              else
                await new Promise((resolve) =>
                  new previous.Reader(blob)
                    .setTagsToRead(["title", "artist", "album"])
                    .read({ onSuccess: resolve, onError: resolve }),
                );
              samples.push(performance.now() - start);
              await new Promise((r) => setTimeout(r, 0));
            }
            samples.sort((a, b) => a - b);
            timings[parser] = {
              median: samples[15],
              p95: samples[28],
              max: samples[29],
            };
          }
          observer?.disconnect();
          return {
            userAgent: navigator.userAgent,
            samples,
            timings,
            longTasks,
          };
        },
        { fixtureSizes },
      );
      const unsync = results[name].samples.find(
        (s) => s.file === "global-unsync.mp3",
      );
      assert.equal(unsync.old.tags.title, "AÿáB");
      assert.equal(unsync.application.outcome.tags.title, "AÿáB");
      for (const file of [
        "tagged.mp3",
        "art-262144.mp3",
        "art-1200000.mp3",
        "art-first.mp3",
      ]) {
        const sample = results[name].samples.find((s) => s.file === file);
        assert.equal(sample.application.outcome.tags.title, "Synthetic title");
        assert.ok(sample.application.ranges.length <= 4);
      }
      assert.notEqual(unsync.local.tags.title, unsync.old.tags.title);
      for (const file of [
        "unusual-id.mp3",
        "raw-v24-size.mp3",
        "several-artworks.mp3",
        "two-artworks.mp3",
        "malformed-art-length.mp3",
      ]) {
        const sample = results[name].samples.find((s) => s.file === file);
        assert.equal(sample.application.outcome.tags.title, "T");
        if (!["raw-v24-size.mp3", "malformed-art-length.mp3"].includes(file))
          assert.equal(sample.application.outcome.tags.artist, "A");
      }
      console.log(
        JSON.stringify({
          browser: name,
          timings: results[name].timings,
          unsync,
          longTasks: results[name].longTasks,
        }),
      );
    } catch (e) {
      if (!browser) results[name] = { unavailable: e.message };
      else throw e;
    } finally {
      await browser?.close();
    }
  }
  writeFileSync(
    join(work, "browser-results.json"),
    `${JSON.stringify({ results, wire }, null, 2)}\n`,
  );
} finally {
  server.closeAllConnections();
  server.close();
}
