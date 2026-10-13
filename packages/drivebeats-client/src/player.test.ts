import { expect, it } from "vitest";
import { createPlayer } from "./player";

class AudioStub extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 100;
  volume = 1;
  error = null;
  play = async () => {
    this.dispatchEvent(new Event("play"));
  };
  pause() {
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}
const track = (id: string) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
});
it("keeps audio stable, rejects stale access after pause and reports gesture errors", async () => {
  const audio = new AudioStub();
  let resolve!: (url: string) => void;
  const player = createPlayer(audio as unknown as HTMLAudioElement, {
    prepare: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = player.play(track("one"), [track("one")]);
  player.pause();
  resolve("https://example.test/one");
  expect(await pending).toBe(false);
  expect(audio.src).toBe("");
  player.dispose();
  const blockedAudio = new AudioStub();
  blockedAudio.play = async () => {
    throw new Error("gesture");
  };
  const blocked = createPlayer(blockedAudio as unknown as HTMLAudioElement, {
    prepare: async () => "https://example.test/one",
  });
  expect(await blocked.play(track("one"))).toBe(false);
  expect(blocked.getSnapshot().error).toContain("tap");
  blocked.dispose();
});
it("shuffle visits each track once before repeat-all and manual choices invalidate prepared DJ tracks", async () => {
  const audio = new AudioStub();
  const player = createPlayer(audio as unknown as HTMLAudioElement, {
    prepare: async (id) => `https://example.test/${id}`,
  });
  const queue = [track("one"), track("two"), track("three")];
  await player.play(queue[0], queue);
  player.setShuffle(true);
  const seen = [player.getSnapshot().track?.id];
  await player.next();
  seen.push(player.getSnapshot().track?.id);
  await player.next();
  seen.push(player.getSnapshot().track?.id);
  expect(new Set(seen).size).toBe(3);
  expect(await player.next()).toBe(false);
  player.setRepeat("all");
  expect(await player.next()).toBe(true);
  const revision = player.getManualRevision();
  player.setUpcoming([track("dj")], revision);
  player.queue([track("manual")], "append");
  player.setUpcoming([track("late")], revision);
  expect(player.getUpcoming()).toEqual([]);
  player.dispose();
});
it("reconciles shuffle across collection changes and preserves played tracks while appending", async () => {
  const audio = new AudioStub();
  const player = createPlayer(audio as unknown as HTMLAudioElement, {
    prepare: async (id) => `https://example.test/${id}`,
  });
  await player.play(track("a"), [track("a"), track("b")]);
  player.setShuffle(true);
  await player.next();
  player.queue([track("b"), track("c"), track("c")], "append");
  expect(player.getSnapshot().queue.map((file) => file.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  await player.next();
  expect(player.getSnapshot().track?.id).toBe("c");
  expect(await player.next()).toBe(false);
  await player.play(track("x"), [track("x"), track("y")]);
  expect(await player.next()).toBe(true);
  expect(player.getSnapshot().track?.id).toBe("y");
  player.dispose();
});
