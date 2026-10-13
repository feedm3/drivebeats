export const MEDIA_CONFIG_ID = "drivebeats-media-read";

/** Canonical authorization origin is injected by the server, never a tool result. */
export function getMcpMediaOrigin(): string | null {
  const script = document.getElementById(MEDIA_CONFIG_ID);
  if (!script) return null;
  if (
    script.tagName !== "SCRIPT" ||
    script.getAttribute("type") !== "application/json"
  )
    throw new Error("The media configuration is invalid.");
  const config: unknown = JSON.parse(script.textContent ?? "");
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).length !== 1 ||
    !("origin" in config)
  )
    throw new Error("The media configuration is invalid.");
  if (config.origin === null) return null;
  if (typeof config.origin !== "string")
    throw new Error("The media origin is invalid.");
  const url = new URL(config.origin);
  if (url.protocol !== "https:" || url.origin !== config.origin)
    throw new Error("The media origin must be a canonical HTTPS origin.");
  return url.origin;
}
