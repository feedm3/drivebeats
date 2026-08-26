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

describe("Drive Library Search acquisition", () => {
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
