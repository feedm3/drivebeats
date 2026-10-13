// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaylistWithTracksRecord } from "./cloud-library-service";
import {
  PLAYLIST_COUNT_LIMIT_CODE,
  PlaylistLimitError,
} from "./playlist-limits";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  getSql: () => ({ query: mocks.query, transaction: mocks.transaction }),
}));
vi.mock("@/db/users", () => ({ upsertUser: mocks.user }));

beforeEach(() => {
  vi.resetAllMocks();
  // Like Neon query objects, these statements remain lazy until the transaction.
  mocks.query.mockImplementation((text, parameters) => ({ text, parameters }));
  mocks.transaction.mockResolvedValue([[], []]);
});

describe("atomic Playlist creation", () => {
  const user = {
    id: "verified-account",
    email: "account@example.com",
    name: "Account",
    picture: "",
  };
  it("submits the new Playlist and ordered unique tracks in a single transaction", async () => {
    await expect(
      createPlaylistWithTracksRecord(
        user,
        { id: "new-playlist", name: "Saved" },
        [
          { fileId: "second", fileName: "second.mp3" },
          { fileId: "first", fileName: "first.mp3" },
          { fileId: "second", fileName: "second.mp3" },
        ],
      ),
    ).resolves.toEqual({ trackCount: 2 });
    expect(mocks.user).toHaveBeenCalledWith(user);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const [statements] = mocks.transaction.mock.calls[0];
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toContain("INSERT INTO playlists");
    expect(statements[0].text).not.toContain("ON CONFLICT");
    expect(statements[0].parameters).toEqual([
      "new-playlist",
      "verified-account",
      "Saved",
    ]);
    expect(statements[1].text).toContain("INSERT INTO playlist_tracks");
    expect(statements[1].parameters.slice(0, 4)).toEqual([
      "new-playlist",
      0,
      "second",
      "second.mp3",
    ]);
    expect(statements[1].parameters.slice(9, 13)).toEqual([
      "new-playlist",
      1,
      "first",
      "first.mp3",
    ]);
  });
  it("does not issue separate writes or a second transaction when insertion fails", async () => {
    const databaseFailure = Object.assign(new Error("limit"), {
      detail: PLAYLIST_COUNT_LIMIT_CODE,
    });
    mocks.transaction.mockRejectedValueOnce(databaseFailure);
    await expect(
      createPlaylistWithTracksRecord(
        user,
        { id: "new-playlist", name: "Saved" },
        [{ fileId: "track", fileName: "track.mp3" }],
      ),
    ).rejects.toMatchObject({ code: PLAYLIST_COUNT_LIMIT_CODE });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it("rejects a track-limit violation before creating the user or Playlist", async () => {
    const tracks = Array.from({ length: 501 }, (_, i) => ({
      fileId: String(i),
      fileName: `${i}.mp3`,
    }));
    await expect(
      createPlaylistWithTracksRecord(
        user,
        { id: "new-playlist", name: "Saved" },
        tracks,
      ),
    ).rejects.toBeInstanceOf(PlaylistLimitError);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
