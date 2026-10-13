import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_URL } from "../site";

export const UI_MIME_TYPE = "text/html;profile=mcp-app";

export function createUiResource(html: string, resourceDomains: string[] = []) {
  const version = createHash("sha256").update(html).digest("hex");
  return {
    uri: `ui://drivebeats/player-${version}.html`,
    html,
    resourceDomains,
  };
}

function validateOrigin(origin: string, allowLocal = false) {
  const url = new URL(origin);
  const local =
    allowLocal &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== "https:" && !local)) {
    throw new Error("The player origin must be HTTPS or permitted local HTTP.");
  }
  return origin;
}

export function renderUiResource(
  template: string,
  origin: string,
  mediaOrigin: string | null = null,
  websiteOrigin = SITE_URL,
) {
  validateOrigin(origin, true);
  if (mediaOrigin) validateOrigin(mediaOrigin);
  validateOrigin(websiteOrigin, true);
  if (!template.includes("<head>"))
    throw new Error("The packaged UI is missing its head element.");
  const config = (value: unknown) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  const html = template.replace(
    "<head>",
    `<head><script id="drivebeats-media-read" type="application/json">${config({ origin: mediaOrigin })}</script><script id="drivebeats-import-selection" type="application/json">${config({ origin: websiteOrigin })}</script>`,
  );
  return createUiResource(html, mediaOrigin ? [mediaOrigin] : []);
}

export async function readUiResource(request?: Request) {
  const html = await readFile(
    join(process.cwd(), ".mcp-ui", "index.html"),
    "utf8",
  );
  const origin = process.env.VERCEL_URL
    ? new URL(`https://${process.env.VERCEL_URL}`).origin
    : new URL(request?.url ?? SITE_URL).origin;
  return renderUiResource(html, origin, process.env.MCP_AUTH_ISSUER || null);
}
