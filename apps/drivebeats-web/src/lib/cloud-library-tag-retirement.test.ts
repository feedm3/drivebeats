// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCloudLibrarySyncPayload,
  seedCloudLibraryData,
} from "@/lib/cloud-library-service";
import { parseBootstrapPayload } from "@/lib/cloud-library-validation";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  user: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  getSql: () => {
    mocks.sql();
    throw new Error("Retired table may no longer exist");
  },
}));
vi.mock("@/db/users", () => ({
  upsertUser: mocks.user,
  recordUserVisit: vi.fn(),
}));
vi.mock("@/db/playlists", () => ({
  listPlaylistsByUser: async () => [{ id: "playlist", name: "Saved" }],
  listOwnedPlaylistIdsByUser: async () => [],
}));
vi.mock("@/db/playlist-tracks", () => ({
  listTracksByPlaylistIds: async () => [
    {
      playlist_id: "playlist",
      file_id: "track",
      file_name: "track.mp3",
      mime_type: "audio/mpeg",
      size: "100",
      modified_time: "2026-10-22",
      parents: ["music"],
      parent_folder_name: "Music",
    },
  ],
}));
vi.mock("@/db/favorite-tracks", () => ({
  listFavoriteTracksByUser: async () => [],
  deleteAllNonFavoriteTracks: mocks.cleanup,
}));

const user = { id: "account", email: "a@example.com", name: "A", picture: "" };
beforeEach(() => vi.clearAllMocks());

describe("collection sync after extracted-tag retirement", () => {
  it("still returns Playlist descriptors without querying or returning extracted tags", async () => {
    const result = await getCloudLibrarySyncPayload(user);
    expect(result.playlists[0].tracks[0]).toEqual({
      fileId: "track",
      fileName: "track.mp3",
      mimeType: "audio/mpeg",
      size: "100",
      modifiedTime: "2026-10-22",
      parents: ["music"],
      parentFolderName: "Music",
    });
    expect(Object.keys(result)).toEqual(["playlists", "favorites"]);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("accepts old Bootstrap payloads and discards tags before service execution", async () => {
    const oldPayload = {
      playlists: [],
      favorites: [],
      trackMetadata: { private: { title: "Do not store", album: "Private" } },
    };
    const parsed = parseBootstrapPayload(oldPayload);
    expect(parsed).toEqual({ playlists: [], favorites: [] });
    if (!parsed)
      throw new Error("Legacy client collection payload was rejected");
    await seedCloudLibraryData(user, parsed);
    expect(mocks.user).toHaveBeenCalledWith(user);
    expect(mocks.cleanup).toHaveBeenCalledWith(user.id);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
