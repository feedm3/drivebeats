import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManageFoldersDialog } from "@/components/manage-folders-dialog";
import { type DriveFile, FOLDER_MIME } from "@/types";

const fixture = vi.hoisted(() => ({
  rootFolders: [] as DriveFile[],
  rootFiles: [] as DriveFile[],
  removeRootFolder: vi.fn(),
  removeRootFile: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: (selector: (state: typeof fixture) => unknown) =>
    selector(fixture),
}));
vi.mock("@/stores/folder-cache-store", () => ({
  useFolderCacheStore: { getState: () => ({ invalidate: fixture.invalidate }) },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogClose: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.rootFolders = [];
  fixture.rootFiles = [];
});
afterEach(cleanup);
it("makes Standalone Track removal reachable and preserves folder caches and music", () => {
  fixture.rootFiles = [
    { id: "standalone", name: "Single.mp3", mimeType: "audio/mpeg" },
  ];
  render(<ManageFoldersDialog open onOpenChange={vi.fn()} />);
  expect(
    screen.getByText(/Library choice on every device/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/music files and existing downloads stay unchanged/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Single.mp3" }));
  expect(fixture.removeRootFile).toHaveBeenCalledWith("standalone");
  expect(fixture.removeRootFolder).not.toHaveBeenCalled();
  expect(fixture.invalidate).not.toHaveBeenCalled();
});
it("removes Imported Folders through the existing folder action and invalidates only that folder listing", () => {
  fixture.rootFolders = [
    { id: "folder", name: "Music", mimeType: FOLDER_MIME },
  ];
  render(<ManageFoldersDialog open onOpenChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Music" }));
  expect(fixture.removeRootFolder).toHaveBeenCalledWith("folder");
  expect(fixture.invalidate).toHaveBeenCalledWith("folder");
  expect(fixture.removeRootFile).not.toHaveBeenCalled();
});
