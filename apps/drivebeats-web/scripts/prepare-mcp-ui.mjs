import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FIXTURE_AUDIO_PATHS } from "@drivebeats/mcp-app/fixtures";

const outputDirectory = new URL("../.mcp-ui/", import.meta.url);
const publicDirectory = new URL("../public/mcp-fixtures/", import.meta.url);
const compiledUi = new URL(import.meta.resolve("@drivebeats/mcp-app/ui"));
await mkdir(publicDirectory, { recursive: true });
for (const [id, path] of Object.entries(FIXTURE_AUDIO_PATHS)) {
  const source = new URL(`../public${path}`, compiledUi);
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (path !== `/mcp-fixtures/${id}-${hash}.mp3`) {
    throw new Error(
      `The ${id} sample does not match its immutable audio path.`,
    );
  }
  await copyFile(
    fileURLToPath(source),
    new URL(`${id}-${hash}.mp3`, publicDirectory),
  );
}
const html = await readFile(compiledUi, "utf8");
if (!html.includes("<head>")) {
  throw new Error("The compiled MCP App must contain a head element.");
}
const config = JSON.stringify({ origin: "__DRIVEBEATS_FIXTURE_ORIGIN__" });
const template = html.replace(
  "<head>",
  `<head><script id="drivebeats-fixture-audio" type="application/json">${config}</script>`,
);
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("index.html", outputDirectory), template);
