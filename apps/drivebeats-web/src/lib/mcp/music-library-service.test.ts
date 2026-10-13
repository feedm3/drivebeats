// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpPrincipal } from "./auth";
import {
  readMcpLibraryFolder,
  readMcpLibraryItem,
  validateImportedTrack,
  validateImportedTracks,
} from "./music-library-service";

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  session: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./auth", async (load) => ({
  ...(await load<object>()),
  getMcpGoogleAccessToken: mocks.token,
}));
vi.mock("./music-session-service", () => ({
  getMcpMusicSession: mocks.session,
}));

const principal = {
  googleUserId: "account",
  grantId: "grant",
  profile: { id: "account", email: "account@example.com" },
  scopes: ["library:read", "media:read"],
} as McpPrincipal;
const folder = (id: string, parents: string[] = []) => ({
  id,
  name: id,
  mimeType: "application/vnd.google-apps.folder",
  parents,
});
const track = (id: string, parents: string[] = []) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
  parents,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue("server-only-token");
  mocks.session.mockResolvedValue({
    importedFolderIds: ["imported"],
    standaloneTrackIds: ["standalone"],
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("MCP imported Library provider boundary", () => {
  it("validates a batch with one credential refresh and shared provider ancestry", async () => {
    mocks.fetch.mockImplementation(async (url: URL) => {
      const id = url.pathname.split("/").pop();
      return Response.json(
        id === "nested"
          ? folder("nested", ["imported"])
          : track(id ?? "", ["nested"]),
      );
    });
    const result = await validateImportedTracks(principal, "session", [
      "second",
      "first",
      "second",
    ]);
    expect(result.map((track) => track.fileId)).toEqual(["second", "first"]);
    expect(mocks.token).toHaveBeenCalledTimes(1);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("validates ancestry using provider parents, including unsaved tracks", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(track("unsaved", ["nested"])))
      .mockResolvedValueOnce(Response.json(folder("nested", ["imported"])));
    await expect(
      validateImportedTrack(principal, "session", "unsaved"),
    ).resolves.toMatchObject({ fileId: "unsaved", fileName: "unsaved.mp3" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(options.method).toBeUndefined();
      expect(options.headers).toEqual({
        Authorization: "Bearer server-only-token",
      });
      expect(options.redirect).toBe("error");
    }
  });
  it("rejects accessible files outside deliberately imported roots", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(track("unrelated", ["other"])))
      .mockResolvedValueOnce(Response.json(folder("other")));
    await expect(
      validateImportedTrack(principal, "session", "unrelated"),
    ).rejects.toThrow("outside");
  });
  it("allows a Standalone Track without approving its siblings", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(track("standalone", ["unimported"])))
      .mockResolvedValueOnce(Response.json(track("sibling", ["unimported"])))
      .mockResolvedValueOnce(Response.json(folder("unimported")));
    await expect(
      validateImportedTrack(principal, "session", "standalone"),
    ).resolves.toMatchObject({ fileId: "standalone" });
    await expect(
      validateImportedTrack(principal, "session", "sibling"),
    ).rejects.toThrow("outside");
  });
  it("bounds cyclic ancestry and rejects trashed, unsupported or mismatched items", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(track("cycle", ["a"])))
      .mockResolvedValueOnce(Response.json(folder("a", ["b"])))
      .mockResolvedValueOnce(Response.json(folder("b", ["a"])));
    await expect(
      readMcpLibraryItem(principal, "session", "cycle"),
    ).rejects.toThrow("outside");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ ...track("standalone"), trashed: true }),
    );
    await expect(
      readMcpLibraryItem(principal, "session", "standalone"),
    ).rejects.toThrow("unavailable");
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        ...track("standalone"),
        name: "document.txt",
        mimeType: "text/plain",
      }),
    );
    await expect(
      validateImportedTrack(principal, "session", "standalone"),
    ).rejects.toThrow("supported");
    mocks.fetch.mockResolvedValueOnce(Response.json(track("different")));
    await expect(
      readMcpLibraryItem(principal, "session", "standalone"),
    ).rejects.toThrow("unavailable");
  });
  it("rejects query injection before accessing Google", async () => {
    await expect(
      readMcpLibraryFolder(principal, "session", "x' or trashed = false"),
    ).rejects.toThrow("Invalid");
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("lists paginated descendants while filtering nonmusic and unrelated response entries", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(folder("imported")))
      .mockResolvedValueOnce(
        Response.json({
          files: [
            track("song", ["imported"]),
            folder("child", ["imported"]),
            {
              ...track("document", ["imported"]),
              name: "document.pdf",
              mimeType: "application/pdf",
            },
            track("unrelated", ["elsewhere"]),
          ],
          nextPageToken: "next",
        }),
      );
    const result = await readMcpLibraryFolder(
      principal,
      "session",
      "imported",
      "page",
    );
    expect(result.files.map((file) => file.id)).toEqual(["song", "child"]);
    expect(result.nextPageToken).toBe("next");
    const url = mocks.fetch.mock.calls[1][0] as URL;
    expect(url.searchParams.get("q")).toBe(
      "'imported' in parents and trashed = false",
    );
    expect(url.searchParams.get("pageToken")).toBe("page");
    expect(url.searchParams.get("pageSize")).toBe("200");
  });
  it("does not publish incomplete provider listings or read closed sessions", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(folder("imported")))
      .mockResolvedValueOnce(
        Response.json({ files: [], incompleteSearch: true }),
      );
    await expect(
      readMcpLibraryFolder(principal, "session", "imported"),
    ).rejects.toThrow("incomplete");
    mocks.fetch.mockClear();
    mocks.session.mockRejectedValue(new Error("expired"));
    await expect(
      readMcpLibraryItem(principal, "session", "standalone"),
    ).rejects.toThrow("expired");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
