import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageDialog } from "@/components/storage-dialog";
import type { StoragePersistenceStatus } from "@/stores/offline-store";
import { useOfflineStore } from "@/stores/offline-store";

const manager = vi.hoisted(() => ({
  start: vi.fn(),
  ensureCollectionAvailableOffline: vi.fn().mockResolvedValue(undefined),
  retryDownloads: vi.fn().mockResolvedValue(undefined),
  removeCollectionDownloads: vi.fn().mockResolvedValue(undefined),
  removeAllDownloads: vi.fn().mockResolvedValue(undefined),
}));

const metadata = vi.hoisted(() => ({
  accountId: "synthetic-account" as string | null,
  generation: 1,
  hydrated: true,
  usage: vi.fn().mockResolvedValue({ recordCount: 0, approximateBytes: 0 }),
}));

const offlineDb = vi.hoisted(() => ({
  getAllTrackSizes: vi.fn().mockResolvedValue([]),
  getTrackCount: vi.fn().mockResolvedValue(0),
}));

const librarySearch = vi.hoisted(() => ({
  clear: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/offline-download-manager", () => ({
  offlineDownloadManager: manager,
}));

vi.mock("@/lib/metadata-cache-usage", () => ({
  getMetadataCacheUsage: metadata.usage,
}));

vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: Object.assign(
    (selector: (state: typeof metadata) => unknown) => selector(metadata),
    { getState: () => metadata },
  ),
}));

vi.mock("@/lib/offline-db", () => offlineDb);

vi.mock("@/stores/library-search-store", () => ({
  useLibrarySearchStore: Object.assign(() => ({}), {
    getState: () => librarySearch,
  }),
}));

vi.mock("@/lib/cloud-library-api", () => ({
  deleteAllCloudLibraryData: vi.fn(),
}));

vi.mock("@/lib/clear-local-data", () => ({
  logoutAndRedirect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogClose: ({
    render: trigger,
    children,
  }: {
    render?: ReactElement;
    children: ReactNode;
  }) =>
    trigger ? (
      cloneElement(trigger, {}, children)
    ) : (
      <button type="button">{children}</button>
    ),
}));

function setOfflineState({
  persistence = "unknown",
  errorCategory,
}: {
  persistence?: StoragePersistenceStatus;
  errorCategory?: "storage-full" | "storage-unavailable" | "network";
} = {}) {
  const failed = errorCategory !== undefined;
  useOfflineStore.setState({
    collections: failed
      ? {
          collection: {
            enabled: true,
            trackFileIds: ["track"],
            totalBytes: 0,
            downloadedCount: 0,
            totalCount: 1,
          },
        }
      : {},
    trackJobs: failed
      ? {
          track: {
            status: "failed",
            phase: "idle",
            attempt: 1,
            errorCategory,
          },
        }
      : {},
    trackStatus: failed ? { track: "failed" } : {},
    refCounts: failed ? { track: 1 } : {},
    isDownloading: false,
    storagePersistence: persistence,
  });
}

function renderDialog() {
  return render(<StorageDialog open onOpenChange={vi.fn()} />);
}

describe("StorageDialog offline recovery", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    metadata.accountId = "synthetic-account";
    metadata.generation = 1;
    metadata.hydrated = true;
    metadata.usage.mockResolvedValue({ recordCount: 0, approximateBytes: 0 });
    offlineDb.getAllTrackSizes.mockResolvedValue([]);
    offlineDb.getTrackCount.mockResolvedValue(0);
    setOfflineState();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it.each([
    ["granted", false],
    ["not-granted", true],
    ["unsupported", true],
    ["unknown", true],
  ] as const)(
    "shows plain download advice only when needed for %s storage",
    async (persistence, showsAdvice) => {
      setOfflineState({ persistence });
      offlineDb.getTrackCount.mockResolvedValue(1);
      renderDialog();
      await waitFor(() =>
        expect(
          screen.getByText("Downloaded tracks").parentElement,
        ).toHaveTextContent("1"),
      );
      const advice = screen.queryByText(
        "Your browser may remove downloads when space is low. You can download them again.",
      );
      if (showsAdvice) expect(advice).toBeInTheDocument();
      else expect(advice).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Offline storage protection/),
      ).not.toBeInTheDocument();
    },
  );

  it("shows actionable quota help and retries all failed downloads", async () => {
    setOfflineState({ errorCategory: "storage-full" });

    renderDialog();

    expect(screen.getByText("Not enough device storage")).toBeInTheDocument();
    expect(
      screen.getByText(/Free device storage or remove downloads/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry failed downloads" }),
    );

    await waitFor(() => {
      expect(manager.retryDownloads).toHaveBeenCalledWith();
    });
  });

  it("removes all offline intent only after confirmation", async () => {
    setOfflineState({ errorCategory: "network" });

    renderDialog();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove all downloads" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all downloads" }),
    );
    expect(manager.removeAllDownloads).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("dialog");
    expect(
      within(confirmation).getByRole("heading", {
        name: "Remove all downloads?",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Remove all downloads",
      }),
    );

    await waitFor(() => {
      expect(manager.removeAllDownloads).toHaveBeenCalledOnce();
      expect(librarySearch.clear).toHaveBeenCalledOnce();
    });
  });

  it("shows metadata storage and omits download diagnostics", async () => {
    metadata.usage.mockResolvedValue({
      recordCount: 3,
      approximateBytes: 2048,
    });
    renderDialog();
    expect(await screen.findByText("2.0 KB")).toBeInTheDocument();
    expect(
      screen.queryByText(/Your browser may remove downloads/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Download diagnostics")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Estimated cached data size/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/3 tracks/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove all downloads" }),
    ).toBeEnabled();
  });

  it("clears music metadata even when there are no audio downloads", async () => {
    metadata.usage.mockResolvedValue({
      recordCount: 2,
      approximateBytes: 1024,
    });
    renderDialog();
    await screen.findByText("1.0 KB");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all downloads" }),
    );
    expect(
      screen.getByText(/metadata rebuilds automatically/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all downloads" }),
    );
    await waitFor(() =>
      expect(manager.removeAllDownloads).toHaveBeenCalledOnce(),
    );
  });

  it("waits for metadata hydration before estimating a cache that is being reset", async () => {
    metadata.hydrated = false;
    const rendered = renderDialog();
    expect(metadata.usage).not.toHaveBeenCalled();
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    metadata.hydrated = true;
    rendered.rerender(<StorageDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("0 B");
    expect(metadata.usage).toHaveBeenCalledOnce();
  });

  it("only reads usage while open, and discards an old account snapshot", async () => {
    let resolveOld!: (value: {
      recordCount: number;
      approximateBytes: number;
    }) => void;
    metadata.usage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const rendered = render(
      <StorageDialog open={false} onOpenChange={vi.fn()} />,
    );
    expect(metadata.usage).not.toHaveBeenCalled();
    rendered.rerender(<StorageDialog open onOpenChange={vi.fn()} />);
    const oldSignal = metadata.usage.mock.calls[0][1] as AbortSignal;
    metadata.accountId = "another-synthetic-account";
    metadata.generation++;
    metadata.usage.mockResolvedValue({
      recordCount: 5,
      approximateBytes: 5120,
    });
    rendered.rerender(<StorageDialog open onOpenChange={vi.fn()} />);
    expect(oldSignal.aborted).toBe(true);
    await screen.findByText("5.0 KB");
    await act(async () =>
      resolveOld({ recordCount: 99, approximateBytes: 9999 }),
    );
    expect(screen.queryByText(/99 tracks/)).not.toBeInTheDocument();
    rendered.rerender(<StorageDialog open={false} onOpenChange={vi.fn()} />);
    expect((metadata.usage.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
  });
});
