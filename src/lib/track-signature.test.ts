import { describe, expect, it } from "vitest";
import {
  getFavoritesSignature,
  getPlaylistsSignature,
  getTrackSignature,
} from "@/lib/track-signature";
import type { PlaylistTrack } from "@/types";

function track(overrides: Partial<PlaylistTrack> = {}): PlaylistTrack {
  return {
    fileId: "file-1",
    fileName: "Song.mp3",
    mimeType: "audio/mpeg",
    size: "1000",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    parentFolderName: "Album",
    ...overrides,
  };
}

describe("getTrackSignature", () => {
  it("changes when the underlying Drive file changed", () => {
    const base = getTrackSignature([track()]);

    expect(getTrackSignature([track({ modifiedTime: "2026-02-01" })])).not.toBe(
      base,
    );
    expect(getTrackSignature([track({ size: "2000" })])).not.toBe(base);
  });

  it("ignores fields that do not affect the downloaded blob", () => {
    expect(getTrackSignature([track({ fileName: "Renamed.mp3" })])).toBe(
      getTrackSignature([track()]),
    );
  });

  it("cannot be forged by names containing delimiter-like characters", () => {
    expect(getTrackSignature([track({ fileId: "a:b" }), track()])).not.toBe(
      getTrackSignature([track({ fileId: "a" }), track({ fileId: "b" })]),
    );
  });

  it("ignores a move to another folder, which leaves the blob untouched", () => {
    expect(getTrackSignature([track({ parents: ["new-folder"] })])).toBe(
      getTrackSignature([track({ parents: ["old-folder"] })]),
    );
  });
});

describe("getPlaylistsSignature", () => {
  it("is order sensitive for playlists and for tracks", () => {
    const a = { id: "p1", name: "A", tracks: [track({ fileId: "1" })] };
    const b = { id: "p2", name: "B", tracks: [track({ fileId: "2" })] };

    expect(getPlaylistsSignature([a, b])).not.toBe(
      getPlaylistsSignature([b, a]),
    );

    const ordered = {
      id: "p1",
      name: "A",
      tracks: [track({ fileId: "1" }), track({ fileId: "2" })],
    };
    const reordered = { ...ordered, tracks: [...ordered.tracks].reverse() };

    expect(getPlaylistsSignature([ordered])).not.toBe(
      getPlaylistsSignature([reordered]),
    );
  });

  it("is stable for structurally equal playlists", () => {
    expect(
      getPlaylistsSignature([{ id: "p1", name: "A", tracks: [track()] }]),
    ).toBe(getPlaylistsSignature([{ id: "p1", name: "A", tracks: [track()] }]));
  });

  it("changes when a track moved to another Drive folder", () => {
    const playlist = (parents: string[]) => [
      { id: "p1", name: "A", tracks: [track({ parents })] },
    ];

    expect(getPlaylistsSignature(playlist(["folder-b"]))).not.toBe(
      getPlaylistsSignature(playlist(["folder-a"])),
    );
  });
});

describe("parents in the content signature", () => {
  const withParents = (parents: string[] | undefined) =>
    getFavoritesSignature([track({ parents })]);

  it("is order sensitive, because consumers navigate to parents[0]", () => {
    expect(withParents(["a", "b"])).not.toBe(withParents(["b", "a"]));
  });

  it("treats an omitted list and an empty list as the same absent parent", () => {
    expect(withParents(undefined)).toBe(withParents([]));
  });

  it("detects a parent list that gained or lost an entry", () => {
    expect(withParents(["a"])).not.toBe(withParents(["a", "b"]));
    expect(withParents(["a"])).not.toBe(withParents([]));
  });

  it("cannot be forged across the parents and parentFolderName fields", () => {
    expect(
      getFavoritesSignature([
        track({ parents: ["a", "b"], parentFolderName: "" }),
      ]),
    ).not.toBe(
      getFavoritesSignature([track({ parents: ["a"], parentFolderName: "b" })]),
    );
  });
});

describe("getFavoritesSignature", () => {
  it("ignores the order the cloud returns favorites in", () => {
    expect(
      getFavoritesSignature([track({ fileId: "b" }), track({ fileId: "a" })]),
    ).toBe(
      getFavoritesSignature([track({ fileId: "a" }), track({ fileId: "b" })]),
    );
  });

  it("changes when a rendered field changed", () => {
    expect(getFavoritesSignature([track({ fileName: "New.mp3" })])).not.toBe(
      getFavoritesSignature([track()]),
    );
  });
});

describe("playlist name encoding", () => {
  // Playlist names are user-authored and validation accepts control
  // characters, so the delimiters cannot be assumed absent from them.
  const GROUP_SEPARATOR = "\u0003";

  it("cannot be forged by a name containing a delimiter", () => {
    const forged = getPlaylistsSignature([
      { id: "p1", name: `a${GROUP_SEPARATOR}p2`, tracks: [] },
      { id: "p2", name: "", tracks: [] },
    ]);
    const plain = getPlaylistsSignature([
      { id: "p1", name: "a", tracks: [] },
      { id: "p2", name: "", tracks: [] },
    ]);

    expect(forged).not.toBe(plain);
  });

  it("still detects a plain rename", () => {
    expect(
      getPlaylistsSignature([{ id: "p1", name: "Road trip", tracks: [] }]),
    ).not.toBe(
      getPlaylistsSignature([{ id: "p1", name: "Road trip 2", tracks: [] }]),
    );
  });
});
