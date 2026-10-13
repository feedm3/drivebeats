import { FIXTURE_AUDIO_PATHS, type FixtureTrackId } from "./fixture-tracks";

export const FIXTURE_AUDIO_CONFIG_ID = "drivebeats-fixture-audio";

/** This origin is server-injected HTML, never tool-result or model-supplied data. */
export function readHostedFixtureSources(
  config: unknown,
): Record<FixtureTrackId, string> {
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).length !== 1 ||
    !("origin" in config) ||
    typeof config.origin !== "string"
  ) {
    throw new Error("The audio configuration is invalid.");
  }
  const url = new URL(config.origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== config.origin ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error("The audio origin must be HTTPS or local HTTP.");
  }
  return {
    pulse: `${url.origin}${FIXTURE_AUDIO_PATHS.pulse}`,
    afterglow: `${url.origin}${FIXTURE_AUDIO_PATHS.afterglow}`,
  };
}

/** Hosted sources are fixed by the server; standalone preview uses static assets. */
export function getFixtureAudioSources(): Record<FixtureTrackId, string> {
  const script = document.getElementById(FIXTURE_AUDIO_CONFIG_ID);
  if (script) {
    if (
      script.tagName !== "SCRIPT" ||
      script.getAttribute("type") !== "application/json"
    ) {
      throw new Error("The test audio configuration must be a JSON script.");
    }
    return readHostedFixtureSources(JSON.parse(script.textContent ?? ""));
  }
  if (window.parent !== window) {
    throw new Error("The host did not provide its test audio configuration.");
  }
  return FIXTURE_AUDIO_PATHS;
}
