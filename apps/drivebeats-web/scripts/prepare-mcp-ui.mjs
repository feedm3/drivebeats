import { mkdir, readFile, writeFile } from "node:fs/promises";

const outputDirectory = new URL("../.mcp-ui/", import.meta.url);
const compiledUi = new URL(import.meta.resolve("@drivebeats/mcp-app/ui"));
const html = await readFile(compiledUi, "utf8");
if (!html.includes("<head>")) {
  throw new Error("The compiled MCP App must contain a head element.");
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("index.html", outputDirectory), html);
