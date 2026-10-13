import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_URL } from "../site";

export const UI_MIME_TYPE = "text/html;profile=mcp-app";

export function createUiResource(html: string, resourceDomains: string[] = []) {
  const version = createHash("sha256").update(html).digest("hex");
  return {
    uri: `ui://drivebeats/fixture-player-${version}.html`,
    html,
    resourceDomains,
  };
}

export function renderUiResource(
  template: string,
  origin: string,
  mediaOrigin: string | null = null,
) {
  const url = new URL(origin);
  const isLocalHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== "https:" && !isLocalHttp)) {
    throw new Error("The fixture audio origin must be HTTPS or local HTTP.");
  }
  const placeholder = "__DRIVEBEATS_FIXTURE_ORIGIN__";
  if (!template.includes(placeholder)) {
    throw new Error("The packaged UI is missing its audio origin.");
  }
  if (mediaOrigin) {
    const mediaUrl = new URL(mediaOrigin);
    if (mediaUrl.protocol !== "https:" || mediaUrl.origin !== mediaOrigin)
      throw new Error("The media issuer must be an HTTPS origin.");
  }
  if (!template.includes("<head>"))
    throw new Error("The packaged UI is missing its head element.");
  const mediaConfig = JSON.stringify({ origin: mediaOrigin });
  const html = template
    .replaceAll(placeholder, origin)
    .replace(
      "<head>",
      `<head><script id="drivebeats-media-read" type="application/json">${mediaConfig}</script>`,
    );
  return createUiResource(html, [
    ...new Set([origin, ...(mediaOrigin ? [mediaOrigin] : [])]),
  ]);
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
