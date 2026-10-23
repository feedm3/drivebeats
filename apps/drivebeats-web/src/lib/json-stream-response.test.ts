// @vitest-environment node
import { expect, it } from "vitest";
import { jsonStreamResponse } from "./json-stream-response";

it("streams a collection larger than 4.5MB without corrupting names at chunk boundaries", async () => {
  const collection = {
    favorites: Array.from({ length: 10_000 }, (_, index) => ({
      fileId: `track-${index}`,
      fileName: `${"🎵Ä".repeat(180)}.mp3`,
    })),
    playlists: [],
  };
  const response = jsonStreamResponse(collection);
  expect(response.headers.get("Content-Length")).toBeNull();
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing streaming response");
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    expect(next.value.byteLength).toBeLessThanOrEqual(64 * 1024);
    chunks.push(next.value);
  }
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  expect(size).toBeGreaterThan(4.5 * 1024 * 1024);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const restored = await new Response(joined.buffer).json();
  expect(restored).toEqual(collection);
});
