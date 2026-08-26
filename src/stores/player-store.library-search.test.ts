import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";

const tracks: DriveFile[] = [
  { id: "one", name: "One.mp3", mimeType: "audio/mpeg" },
  { id: "two", name: "Two.mp3", mimeType: "audio/mpeg" },
];
const firstPath: FolderEntry[] = [
  { id: "root", name: "Library" },
  { id: "music", name: "Music" },
  { id: "first", name: "First" },
];
const secondPath: FolderEntry[] = [
  { id: "root", name: "Library" },
  { id: "music", name: "Music" },
  { id: "second", name: "Second" },
];

describe("Library Search playback queue context", () => {
  beforeEach(() => {
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.setState({
      initAudio: vi.fn(() => ({}) as HTMLAudioElement),
      loadTrack: vi.fn(async (_fileId, _autoplay, beforeApply) => {
        beforeApply?.();
        return true;
      }),
    });
  });

  it("updates folder context as next and previous move across search results", async () => {
    await usePlayerStore
      .getState()
      .playTrack(tracks[0], tracks, firstPath, undefined, [
        firstPath,
        secondPath,
      ]);
    expect(usePlayerStore.getState().playingFolderStack).toEqual(firstPath);

    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTrack?.id).toBe("two");
    expect(usePlayerStore.getState().playingFolderStack).toEqual(secondPath);

    await usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().currentTrack?.id).toBe("one");
    expect(usePlayerStore.getState().playingFolderStack).toEqual(firstPath);
  });

  it("keeps one shared path for an ordinary Current Folder queue", async () => {
    await usePlayerStore.getState().playTrack(tracks[0], tracks, firstPath);
    await usePlayerStore.getState().next();

    expect(usePlayerStore.getState().playingFolderStack).toEqual(firstPath);
    expect(usePlayerStore.getState().playlistFolderStacks).toBeNull();
  });
});
