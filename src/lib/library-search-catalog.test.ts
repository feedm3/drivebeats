import { describe, expect, it } from "vitest";
import {
  buildLibrarySearchCatalog,
  filterLibraryCatalogToCurrentImports,
  searchLibraryCatalog,
} from "@/lib/library-search-catalog";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

function folder(id: string, name: string, parent?: string): DriveFile {
  return {
    id,
    name,
    mimeType: FOLDER_MIME,
    parents: parent ? [parent] : [],
  };
}

function track(id: string, name: string, parent?: string): DriveFile {
  return {
    id,
    name,
    mimeType: "audio/mpeg",
    parents: parent ? [parent] : [],
  };
}

describe("Library Search catalog", () => {
  it("uses the closest Imported Folder and deduplicates tracks by Drive ID", () => {
    const music = folder("music", "Music", "root");
    const live = folder("live", "Live", "music");
    const year = folder("year", "2026", "live");
    const show = track("show", "Live Show.mp3", "year");

    const catalog = buildLibrarySearchCatalog({
      audioFiles: [show, show],
      folders: [music, live, year],
      importedFolders: [music, live],
      standaloneTracks: [],
    });

    expect(catalog).toEqual([
      expect.objectContaining({
        id: "show",
        importedRootId: "live",
        relativePath: "2026",
        contextLabel: "2026",
        folderStack: [
          { id: "root", name: "Library" },
          { id: "live", name: "Live" },
          { id: "year", name: "2026" },
        ],
      }),
    ]);
  });

  it("rebases a track to an imported ancestor when its closest import is removed", () => {
    const music = folder("music", "Music", "root");
    const live = folder("live", "Live", "music");
    const year = folder("year", "2026", "live");
    const show = track("show", "Live Show.mp3", "year");

    const catalog = buildLibrarySearchCatalog({
      audioFiles: [show],
      folders: [music, live, year],
      importedFolders: [music, live],
      standaloneTracks: [],
    });
    const visible = filterLibraryCatalogToCurrentImports(catalog, [music], []);

    expect(visible).toEqual([
      expect.objectContaining({
        id: "show",
        importedRootId: "music",
        relativePath: "Live/2026",
        contextLabel: "Live/2026",
        folderStack: [
          { id: "root", name: "Library" },
          { id: "music", name: "Music" },
          { id: "live", name: "Live" },
          { id: "year", name: "2026" },
        ],
      }),
    ]);
  });

  it("labels a Standalone Track imported outside every Imported Folder", () => {
    const standalone = track("single", "One More Time.mp3", "elsewhere");

    const catalog = buildLibrarySearchCatalog({
      audioFiles: [standalone],
      folders: [],
      importedFolders: [],
      standaloneTracks: [standalone],
    });

    expect(catalog).toEqual([
      expect.objectContaining({
        id: "single",
        importedRootId: null,
        relativePath: "",
        contextLabel: "Imported individually",
        folderStack: [{ id: "root", name: "Library" }],
      }),
    ]);
  });

  it("ignores an audio item whose ancestry cannot connect to an Imported Folder", () => {
    const music = folder("music", "Music", "root");
    const unresolved = track("lost", "Lost.mp3", "missing-parent");

    expect(
      buildLibrarySearchCatalog({
        audioFiles: [unresolved],
        folders: [music],
        importedFolders: [music],
        standaloneTracks: [],
      }),
    ).toEqual([]);
  });

  it("ignores a known folder chain that cannot connect to an Imported Folder", () => {
    const music = folder("music", "Music", "root");
    const knownParent = folder("known", "Known", "missing-parent");
    const unresolved = track("lost", "Lost.mp3", "known");

    expect(
      buildLibrarySearchCatalog({
        audioFiles: [unresolved],
        folders: [music, knownParent],
        importedFolders: [music],
        standaloneTracks: [],
      }),
    ).toEqual([]);
  });

  it("matches filename substrings case-insensitively with AND token semantics", () => {
    const catalog = buildLibrarySearchCatalog({
      audioFiles: [
        track("one", "Midnight LIVE Session.mp3", "music"),
        track("two", "Midnight Studio Session.mp3", "music"),
      ],
      folders: [folder("music", "Music", "root")],
      importedFolders: [folder("music", "Music", "root")],
      standaloneTracks: [],
    });

    expect(
      searchLibraryCatalog(catalog, "night live").map((item) => item.id),
    ).toEqual(["one"]);
  });
});
