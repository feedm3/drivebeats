import { describe, expect, it, vi } from "vitest";
import type { GoogleDriveFilesListResponse } from "@/lib/google-api";
import { buildLibrarySearchCatalogFromDrive } from "@/lib/library-search-drive";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

const importedFolder: DriveFile = {
  id: "music",
  name: "Music",
  mimeType: FOLDER_MIME,
  parents: ["root"],
};

function response(body: GoogleDriveFilesListResponse) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("Drive Library Search acquisition", () => {
  it("finishes every audio page before starting folders and waits for folders before publishing", async () => {
    const firstAudioPage = deferred<Response>();
    const lastAudioBody = deferred<GoogleDriveFilesListResponse>();
    const folderPage = deferred<Response>();
    const listFiles = vi.fn(async (_token: string, params: URLSearchParams) => {
      if (params.get("q")?.includes(FOLDER_MIME)) {
        return folderPage.promise;
      }
      if (!params.has("pageToken")) return firstAudioPage.promise;
      const lastPage = response({});
      vi.spyOn(lastPage, "json").mockReturnValue(lastAudioBody.promise);
      return lastPage;
    });
    let settled = false;
    const pending = buildLibrarySearchCatalogFromDrive({
      accessToken: "token",
      importedFolders: [importedFolder],
      standaloneTracks: [],
      listFiles,
    });
    void pending.then(() => {
      settled = true;
    });

    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(listFiles.mock.calls[0][1].get("q")).not.toContain(FOLDER_MIME);
    firstAudioPage.resolve(response({ nextPageToken: "audio-2", files: [] }));
    await vi.waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
    expect(listFiles.mock.calls[1][1].get("pageToken")).toBe("audio-2");
    expect(listFiles.mock.calls[1][1].get("q")).not.toContain(FOLDER_MIME);
    expect(settled).toBe(false);

    lastAudioBody.resolve({
      files: [
        {
          id: "track",
          name: "Track.mp3",
          mimeType: "audio/mpeg",
          parents: ["music"],
        },
      ],
      incompleteSearch: false,
    });
    await vi.waitFor(() => expect(listFiles).toHaveBeenCalledTimes(3));
    expect(listFiles.mock.calls[2][1].get("q")).toContain(FOLDER_MIME);
    expect(settled).toBe(false);
    folderPage.resolve(
      response({ files: [importedFolder], incompleteSearch: false }),
    );

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ id: "track" }),
    ]);
  });

  it("paginates complete audio and folder listings before building the catalog", async () => {
    const listFiles = vi.fn(
      async (_token: string, params: URLSearchParams, signal?: AbortSignal) => {
        expect(signal?.aborted).toBe(false);
        expect(params.get("pageSize")).toBe("1000");
        expect(params.get("supportsAllDrives")).toBe("true");
        expect(params.get("includeItemsFromAllDrives")).toBe("true");
        expect(params.get("fields")).toContain("incompleteSearch");

        const isFolderListing = params.get("q")?.includes(FOLDER_MIME);
        const pageToken = params.get("pageToken");
        if (isFolderListing) {
          return response({
            files: [
              {
                id: "album",
                name: "Album",
                mimeType: FOLDER_MIME,
                parents: ["music"],
              },
            ],
            incompleteSearch: false,
          });
        }

        if (!pageToken) {
          return response({
            files: [
              {
                id: "one",
                name: "One.mp3",
                mimeType: "audio/mpeg",
                parents: ["album"],
              },
            ],
            nextPageToken: "audio-2",
            incompleteSearch: false,
          });
        }

        return response({
          files: [
            {
              id: "two",
              name: "Two.mp3",
              mimeType: "audio/mpeg",
              parents: ["music"],
            },
          ],
          incompleteSearch: false,
        });
      },
    );

    const catalog = await buildLibrarySearchCatalogFromDrive({
      accessToken: "token",
      importedFolders: [importedFolder],
      standaloneTracks: [],
      listFiles,
      signal: new AbortController().signal,
    });

    expect(listFiles).toHaveBeenCalledTimes(3);
    expect(catalog.map((track) => track.id)).toEqual(["one", "two"]);
  });

  it("rejects an incomplete Drive listing", async () => {
    const listFiles = vi.fn(async () =>
      response({ files: [], incompleteSearch: true }),
    );

    await expect(
      buildLibrarySearchCatalogFromDrive({
        accessToken: "token",
        importedFolders: [importedFolder],
        standaloneTracks: [],
        listFiles,
      }),
    ).rejects.toThrow("incomplete");
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("does not start folders or publish a partial catalog after an audio request fails", async () => {
    const listFiles = vi.fn(
      async () => new Response("Drive unavailable", { status: 503 }),
    );

    await expect(
      buildLibrarySearchCatalogFromDrive({
        accessToken: "token",
        importedFolders: [importedFolder],
        standaloneTracks: [],
        listFiles,
      }),
    ).rejects.toThrow("503");
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("does not start folders or publish a result when an in-flight audio read is cancelled", async () => {
    const controller = new AbortController();
    const audioPage = deferred<Response>();
    const listFiles = vi.fn(async () => audioPage.promise);
    const pending = buildLibrarySearchCatalogFromDrive({
      accessToken: "token",
      importedFolders: [importedFolder],
      standaloneTracks: [],
      listFiles,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();
    audioPage.resolve(response({ files: [], incompleteSearch: false }));

    await rejected;
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation before publishing a result", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildLibrarySearchCatalogFromDrive({
        accessToken: "token",
        importedFolders: [importedFolder],
        standaloneTracks: [],
        listFiles: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("publishes valid Library tracks when a complete listing also contains unrelated audio with hidden ancestry", async () => {
    const listFiles = vi.fn(async (_token: string, params: URLSearchParams) => {
      const isFolderListing = params.get("q")?.includes(FOLDER_MIME);
      return response(
        isFolderListing
          ? { files: [importedFolder], incompleteSearch: false }
          : {
              files: [
                {
                  id: "library-track",
                  name: "Library.mp3",
                  mimeType: "audio/mpeg",
                  parents: ["music"],
                },
                {
                  id: "unrelated-track",
                  name: "Unrelated.mp3",
                  mimeType: "audio/mpeg",
                  parents: ["hidden-parent"],
                },
              ],
              incompleteSearch: false,
            },
      );
    });

    await expect(
      buildLibrarySearchCatalogFromDrive({
        accessToken: "token",
        importedFolders: [importedFolder],
        standaloneTracks: [],
        listFiles,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "library-track" })]);
  });
});
