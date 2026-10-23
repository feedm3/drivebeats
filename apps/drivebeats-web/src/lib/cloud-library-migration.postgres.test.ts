// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { bootstrapAppData } from "./cloud-library-service";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  saved: false,
  append: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getSql: () => ({ query: mocks.query }) }));
vi.mock("@/db/appdata-control", () => ({
  appDataControl: {},
  claimAppDataMigration: vi.fn(),
  isAppDataLegacySourceAvailable: async () => true,
}));
vi.mock("@/lib/appdata-context", () => ({
  getAppDataContext: async () => ({
    identity: { accountId: "account", generation: "generation" },
    service: {
      readCollections: async () => ({
        source: mocks.saved ? "drive" : "neon",
        generation: "generation",
        revision: mocks.saved ? 1 : 0,
        migrationVersion: mocks.saved ? 1 : 0,
        pendingOperations: [],
        envelopes: mocks.saved
          ? [
              {
                kind: "migration",
                revision: 1,
                operationId: "migration-legacy",
                payload: mocks.append.mock.calls[0][1].payload,
              },
            ]
          : [],
      }),
      append: mocks.append,
    },
  }),
}));

let database: PGlite;
beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE playlists(id text, name text, user_google_id text, created_at timestamptz);
    CREATE TABLE playlist_tracks(playlist_id text, file_id text, file_name text, mime_type text, size text, modified_time text, parents text[], parent_folder_name text, position int);
    CREATE TABLE favorite_tracks(user_google_id text, file_id text, file_name text, mime_type text, size text, modified_time text, parents text[], parent_folder_name text, is_favorite boolean);
    INSERT INTO playlists VALUES ('newer','Newer','account','2026-10-02'), ('older','Older','account','2026-10-01'), ('other','Private','other','2026-01-01');
    INSERT INTO playlist_tracks(playlist_id,file_id,file_name,position) VALUES ('older','second','Second.mp3',1),('older','first','First.mp3',0);
    INSERT INTO favorite_tracks(user_google_id,file_id,file_name,is_favorite) VALUES ('account','z','Zulu.mp3',true),('account','a','alpha.mp3',true),('other','other','Private.mp3',true),('account','removed','AAA.mp3',false);
  `);
  mocks.query.mockImplementation(
    async (sql, values) => (await database.query(sql, values)).rows,
  );
  mocks.append.mockImplementation(async () => {
    mocks.saved = true;
  });
}, 30_000);
afterAll(async () => {
  await database?.close();
});

it("migrates legacy playlist, track and favorite order without another account's data", async () => {
  await bootstrapAppData({
    id: "account",
    email: "a@example.com",
    name: null,
    picture: null,
  });
  const payload = mocks.append.mock.calls[0][1].payload;
  expect(
    payload.playlists.map((playlist: { id: string }) => playlist.id),
  ).toEqual(["older", "newer"]);
  expect(
    payload.playlists[0].tracks.map(
      (track: { fileId: string }) => track.fileId,
    ),
  ).toEqual(["first", "second"]);
  expect(
    payload.favorites.map((track: { fileId: string }) => track.fileId),
  ).toEqual(["a", "z"]);
});
