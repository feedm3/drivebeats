export const FIXTURE_TOOL_NAME = "drivebeats_list_fixture_tracks";

export const FIXTURE_TRACKS = [
  {
    id: "pulse",
    title: "Pulse",
    artist: "DriveBeats Studio",
    durationSeconds: 6,
  },
  {
    id: "afterglow",
    title: "Afterglow",
    artist: "DriveBeats Studio",
    durationSeconds: 6,
  },
] as const;

export type FixtureTrack = (typeof FIXTURE_TRACKS)[number];
export type FixtureTrackId = FixtureTrack["id"];

/** Original six-second instrumental samples, encoded once with FFmpeg 9.0.2. */
export const FIXTURE_AUDIO_PATHS = {
  pulse:
    "/mcp-fixtures/pulse-f89bcbf1643fcc92fb555fc9fea9bb8a20941b2284b0fa429fd80f81d17d8d0c.mp3",
  afterglow:
    "/mcp-fixtures/afterglow-ff148ac02d77e2e75fc57eb9122d24382b50ea50d56421a07bad5d3b3e017433.mp3",
} as const satisfies Record<FixtureTrackId, string>;

/** Only fixture metadata may enter this anonymous prototype. No media URLs. */
export function readFixtureResult(result: unknown): readonly FixtureTrack[] {
  if (!result || typeof result !== "object") {
    throw new Error("The fixture tool returned an invalid result. Try again.");
  }
  if ("isError" in result && result.isError === true) {
    throw new Error(
      "The fixture tool failed. Try loading the test tracks again.",
    );
  }
  const structured = "structuredContent" in result && result.structuredContent;
  if (
    !structured ||
    typeof structured !== "object" ||
    !("tracks" in structured)
  ) {
    throw new Error("The fixture tool returned no track list. Try again.");
  }
  const tracks = structured.tracks;
  if (
    !Array.isArray(tracks) ||
    tracks.length !== FIXTURE_TRACKS.length ||
    FIXTURE_TRACKS.some(
      (fixture) =>
        !tracks.some(
          (track) =>
            track?.id === fixture.id &&
            track.title === fixture.title &&
            track.artist === fixture.artist &&
            track.durationSeconds === fixture.durationSeconds,
        ),
    )
  ) {
    throw new Error("This player accepts only its two sample tracks.");
  }
  return FIXTURE_TRACKS;
}
