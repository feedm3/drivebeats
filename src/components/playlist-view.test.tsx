import {
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
import { PlaylistView } from "@/components/playlist-view";
import { useOfflineStore } from "@/stores/offline-store";
import type { TrackCollection } from "@/types";
import { FAVORITES_COLLECTION_ID } from "@/types";

const manager = vi.hoisted(() => ({
  start: vi.fn(),
  ensureCollectionAvailableOffline: vi.fn().mockResolvedValue(undefined),
  retryDownloads: vi.fn().mockResolvedValue(undefined),
  removeCollectionDownloads: vi.fn().mockResolvedValue(undefined),
  removeAllDownloads: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/offline-download-manager", () => ({
  offlineDownloadManager: manager,
}));

vi.mock("@/components/ui/icon-tooltip", () => ({
  IconTooltip: ({ children }: { children: ReactElement }) => children,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const collection: TrackCollection = {
  id: FAVORITES_COLLECTION_ID,
  kind: "favorites",
  name: "Favorites",
  tracks: [
    {
      fileId: "one",
      fileName: "One.mp3",
      mimeType: "audio/mpeg",
    },
    {
      fileId: "two",
      fileName: "Two.mp3",
      mimeType: "audio/mpeg",
    },
  ],
};

function setOfflineState({
  downloadedCount,
  secondStatus,
  errorCategory,
}: {
  downloadedCount: number;
  secondStatus: "queued" | "downloading" | "downloaded" | "failed";
  errorCategory?: "missing-file" | "network";
}) {
  useOfflineStore.setState({
    collections: {
      [FAVORITES_COLLECTION_ID]: {
        enabled: true,
        trackFileIds: ["one", "two"],
        totalBytes: 100,
        downloadedCount,
        totalCount: 2,
      },
    },
    trackJobs: {
      one: {
        status: "downloaded",
        phase: "idle",
        attempt: 1,
      },
      two: {
        status: secondStatus,
        phase: secondStatus === "downloading" ? "fetching" : "idle",
        attempt: secondStatus === "failed" ? 2 : 0,
        errorCategory,
      },
    },
    trackStatus: {
      one: "downloaded",
      two: secondStatus,
    },
    refCounts: { one: 1, two: 1 },
    isDownloading: secondStatus === "downloading",
    storagePersistence: "unknown",
  });
}

describe("PlaylistView offline recovery controls", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    useOfflineStore.setState({
      collections: {},
      trackJobs: {},
      trackStatus: {},
      refCounts: {},
      isDownloading: false,
      storagePersistence: "unknown",
    });
  });

  it("retries an incomplete enabled collection and keeps removal separate", async () => {
    setOfflineState({
      downloadedCount: 1,
      secondStatus: "failed",
      errorCategory: "network",
    });

    render(<PlaylistView collection={collection} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Retry failed downloads/ }),
    );

    await waitFor(() => {
      expect(manager.retryDownloads).toHaveBeenCalledWith(
        FAVORITES_COLLECTION_ID,
      );
    });
    expect(manager.removeCollectionDownloads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove downloads" }));
    expect(manager.removeCollectionDownloads).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("dialog");
    expect(
      within(confirmation).getByRole("heading", { name: "Remove downloads" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Remove downloads",
      }),
    );

    await waitFor(() => {
      expect(manager.removeCollectionDownloads).toHaveBeenCalledWith(
        FAVORITES_COLLECTION_ID,
      );
    });
  });

  it("requires confirmation before removing a complete collection", async () => {
    setOfflineState({
      downloadedCount: 2,
      secondStatus: "downloaded",
    });

    render(<PlaylistView collection={collection} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove downloads" }));
    expect(manager.removeCollectionDownloads).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("dialog");
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Remove downloads",
      }),
    );

    await waitFor(() => {
      expect(manager.removeCollectionDownloads).toHaveBeenCalledWith(
        FAVORITES_COLLECTION_ID,
      );
    });
  });

  it("shows normalized per-track action help without exposing raw errors", () => {
    setOfflineState({
      downloadedCount: 1,
      secondStatus: "failed",
      errorCategory: "missing-file",
    });

    render(<PlaylistView collection={collection} />);

    const reason = "This file is no longer available in Drive.";
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: reason })).toBeInTheDocument();
    expect(screen.queryByText(/response|token|stack/i)).not.toBeInTheDocument();
  });

  it("shows the foreground limitation only while this collection is active", async () => {
    setOfflineState({
      downloadedCount: 1,
      secondStatus: "downloading",
    });

    render(<PlaylistView collection={collection} />);

    expect(
      screen.getByText(/Downloads continue while DriveBeats is open/),
    ).toBeInTheDocument();

    setOfflineState({
      downloadedCount: 2,
      secondStatus: "downloaded",
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Downloads continue while DriveBeats is open/),
      ).not.toBeInTheDocument();
    });
  });

  it("uses the enable method for a collection without offline intent", async () => {
    render(<PlaylistView collection={collection} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Download for offline" }),
    );

    await waitFor(() => {
      expect(manager.ensureCollectionAvailableOffline).toHaveBeenCalledWith(
        FAVORITES_COLLECTION_ID,
      );
    });
  });
});
