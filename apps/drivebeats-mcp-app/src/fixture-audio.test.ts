import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_AUDIO_PATHS, FIXTURE_TRACKS } from "./fixture-tracks";

describe("checked-in MP3 samples", () => {
  for (const track of FIXTURE_TRACKS) {
    it(`${track.id} matches its immutable path and contains MPEG Layer III audio`, async () => {
      const path = FIXTURE_AUDIO_PATHS[track.id];
      const audio = await readFile(
        resolve(process.cwd(), "public", path.slice(1)),
      );
      const hash = createHash("sha256").update(audio).digest("hex");
      expect(path).toBe(`/mcp-fixtures/${track.id}-${hash}.mp3`);
      expect(audio.length).toBeGreaterThan(10_000);
      expect(audio.length).toBeLessThan(100_000);
      // Skip the optional ID3v2 tag before checking the first MPEG frame.
      let offset = 0;
      if (audio.toString("ascii", 0, 3) === "ID3") {
        const tagSize =
          (audio[6] << 21) | (audio[7] << 14) | (audio[8] << 7) | audio[9];
        offset = 10 + tagSize;
      }
      const header = audio.readUInt32BE(offset);
      expect(header >>> 21).toBe(0x7ff);
      expect((header >>> 19) & 3).toBe(3); // MPEG-1
      expect((header >>> 17) & 3).toBe(1); // Layer III
      expect((header >>> 10) & 3).toBe(0); // 44.1 kHz
      expect((header >>> 6) & 3).toBe(3); // Mono
    });
  }
});
