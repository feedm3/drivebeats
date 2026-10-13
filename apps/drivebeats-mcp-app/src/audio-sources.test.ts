import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_AUDIO_CONFIG_ID,
  getFixtureAudioSources,
  readHostedFixtureSources,
} from "./audio-sources";
import { FIXTURE_AUDIO_PATHS } from "./fixture-tracks";

afterEach(() => document.getElementById(FIXTURE_AUDIO_CONFIG_ID)?.remove());

describe("sample audio sources", () => {
  it("uses checked-in public assets in standalone preview", () => {
    const sources = getFixtureAudioSources();
    expect(sources.pulse).toMatch(/^\/mcp-fixtures\/pulse-[a-f0-9]{64}\.mp3$/);
    expect(sources.afterglow).toMatch(
      /^\/mcp-fixtures\/afterglow-[a-f0-9]{64}\.mp3$/,
    );
  });
  it("constructs only the fixed sample URLs from a canonical server origin", () => {
    const sources = readHostedFixtureSources({
      origin: "https://drivebeats.example",
    });
    expect(sources).toEqual({
      pulse: `https://drivebeats.example${FIXTURE_AUDIO_PATHS.pulse}`,
      afterglow: `https://drivebeats.example${FIXTURE_AUDIO_PATHS.afterglow}`,
    });
    expect(
      readHostedFixtureSources({ origin: "http://127.0.0.1:3101" }).pulse,
    ).toBe(`http://127.0.0.1:3101${FIXTURE_AUDIO_PATHS.pulse}`);
  });
  it.each([
    "http://remote.example",
    "http://localhost.attacker.example",
    "https://user:password@drivebeats.example",
    "https://drivebeats.example/path",
    "https://drivebeats.example/",
    "https://drivebeats.example?token=private",
    "https://drivebeats.example#fragment",
    "data:audio/mpeg;base64,unexpected",
    "/relative",
  ])("rejects a noncanonical or unsafe origin: %s", (origin) => {
    expect(() => readHostedFixtureSources({ origin })).toThrow();
  });
  it("rejects model-supplied sources or unexpected configuration fields", () => {
    expect(() =>
      readHostedFixtureSources({
        origin: "https://drivebeats.example",
        sources: { pulse: "https://attacker.example/audio.mp3" },
      }),
    ).toThrow();
    expect(() => readHostedFixtureSources({ sources: {} })).toThrow();
  });
  it("reads hosted JSON configuration and fails malformed configuration without fallback", () => {
    const script = document.createElement("script");
    script.id = FIXTURE_AUDIO_CONFIG_ID;
    script.type = "application/json";
    script.textContent = JSON.stringify({
      origin: "https://drivebeats.example",
    });
    document.head.append(script);
    expect(getFixtureAudioSources().pulse).toBe(
      `https://drivebeats.example${FIXTURE_AUDIO_PATHS.pulse}`,
    );
    script.textContent = "invalid JSON";
    expect(() => getFixtureAudioSources()).toThrow();
    script.type = "text/javascript";
    expect(() => getFixtureAudioSources()).toThrow("JSON script");
  });
});
