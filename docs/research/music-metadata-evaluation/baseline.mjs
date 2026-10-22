// Runs the CURRENT application range adapter against synthetic HTTP responses.
// Only its Google transport import is substituted. Never contacts Google.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const work = resolve(root, "node_modules/.cache/music-metadata-evaluation");
const deps = createRequire(join(work, "package.json"));
const appReader = resolve(
  root,
  "apps/drivebeats-web/src/lib/drive-metadata-reader.ts",
);
const { build } = deps("esbuild");
const output = join(work, "application-reader.mjs");
await build({
  entryPoints: [appReader],
  outfile: output,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
  plugins: [
    {
      name: "synthetic-range-only",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/google-api$/ }, () => ({
          path: "range",
          namespace: "synthetic",
        }));
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
          contents:
            "export const readGoogleDriveFileRange=(id,token,start,end,signal)=>(globalThis.evaluationRanges?.push([start,end]),fetch(globalThis.evaluationOrigin+'/'+id,{headers:{Range:'bytes='+start+'-'+end},signal}));",
          loader: "js",
        }));
        b.onResolve(
          { filter: /\/(NodeFileReader|ReactNativeFileReader)$/ },
          (a) => ({ path: a.path, namespace: "empty" }),
        );
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents:
            "module.exports = class {static canReadFile(){return false}};",
          loader: "js",
        }));
      },
    },
  ],
});
const { readDriveTrackMetadata } = await import(pathToFileURL(output));
const source = JSON.parse(readFileSync(join(work, "results.json"), "utf8"));
let active;
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (!source.results.some((r) => r.name === name)) {
    res.writeHead(404).end();
    return;
  }
  const bytes = readFileSync(join(work, "fixtures", name));
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
  if (!match) {
    res.writeHead(400).end();
    return;
  }
  const start = Number(match[1]),
    end = Number(match[2]);
  active.requests.push([start, end]);
  active.bytes += end - start + 1;
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    "Content-Length": end - start + 1,
  });
  res.end(bytes.subarray(start, end + 1));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
globalThis.evaluationOrigin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const fixture of source.results.filter((r) => r.name.endsWith(".mp3"))) {
    active = { requests: [], bytes: 0 };
    let outcome;
    try {
      outcome = await readDriveTrackMetadata({
        fileId: fixture.name,
        size: fixture.size,
        accessToken: "synthetic",
        signal: AbortSignal.timeout(3000),
        requestOptions: {},
        assertCurrent() {},
      });
    } catch (e) {
      outcome = { error: e.code ?? e.message };
    }
    results.push({ name: fixture.name, ...active, outcome });
  }
  writeFileSync(
    join(work, "baseline-results.json"),
    `${JSON.stringify({ sourceFile: "apps/drivebeats-web/src/lib/drive-metadata-reader.ts", sourceSha256: createHash("sha256").update(readFileSync(appReader)).digest("hex"), results }, null, 2)}\n`,
  );
  console.log(JSON.stringify(results));
} finally {
  server.closeAllConnections();
  server.close();
}
