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

const diagnostics = vi.hoisted(() => ({
  has: vi.fn(() => false),
  export: vi.fn(() => '{"format":"drivebeats-offline-diagnostics-v1"}'),
}));

const offlineDb = vi.hoisted(() => ({
  getAllTrackSizes: vi.fn().mockResolvedValue([]),
  getTrackCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/offline-download-manager", () => ({
  offlineDownloadManager: manager,
}));

vi.mock("@/lib/offline-download-diagnostics", () => ({
  hasOfflineDownloadDiagnostics: diagnostics.has,
  exportOfflineDownloadDiagnostics: diagnostics.export,
}));

vi.mock("@/lib/offline-db", () => offlineDb);

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
    diagnostics.has.mockReturnValue(false);
    diagnostics.export.mockReturnValue(
      '{"format":"drivebeats-offline-diagnostics-v1"}',
    );
    offlineDb.getAllTrackSizes.mockResolvedValue([]);
    offlineDb.getTrackCount.mockResolvedValue(0);
    setOfflineState();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it.each([
    [
      "granted",
      "Granted (protected)",
      "should not remove downloads automatically",
    ],
    ["not-granted", "Not granted (best effort)", "may remove downloads"],
    ["unsupported", "Unsupported", "cannot request offline storage protection"],
    [
      "unknown",
      "Unknown (not checked)",
      "checked when you enable offline downloads",
    ],
  ] as const)(
    "renders the actual %s persistence state",
    (persistence, label, description) => {
      setOfflineState({ persistence });

      renderDialog();

      expect(
        screen.getByText(`Offline storage protection: ${label}`),
      ).toBeInTheDocument();
      expect(screen.getByText(new RegExp(description))).toBeInTheDocument();
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
    });
  });

  it("shows an honest empty diagnostics state", () => {
    diagnostics.has.mockReturnValue(false);

    renderDialog();

    expect(
      screen.getByText("No download diagnostics recorded yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy download diagnostics" }),
    ).toBeDisabled();
    expect(diagnostics.export).not.toHaveBeenCalled();
  });

  it("copies sanitized diagnostics only after the user requests it", async () => {
    diagnostics.has.mockReturnValue(true);
    const payload =
      '{"format":"drivebeats-offline-diagnostics-v1","events":[]}';
    diagnostics.export.mockReturnValue(payload);
    const writeText = vi.mocked(navigator.clipboard.writeText);

    renderDialog();

    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy download diagnostics" }),
    );

    await waitFor(() => {
      expect(diagnostics.export).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith(payload);
    });
  });
});
