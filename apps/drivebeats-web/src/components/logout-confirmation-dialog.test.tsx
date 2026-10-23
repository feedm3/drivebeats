import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LogoutConfirmationDialog } from "@/components/logout-confirmation-dialog";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";

const state = vi.hoisted(() => ({
  inspect: vi.fn(),
  collections: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/drive-appdata-client", () => ({
  getDriveAppDataLogoutState: state.inspect,
}));
vi.mock("@/lib/cloud-library-api", () => ({
  getPendingCollectionSaveCount: state.collections,
}));
vi.mock("@/lib/clear-local-data", () => ({ logoutAndRedirect: state.logout }));
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
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.inspect.mockResolvedValue({
    pendingCount: 0,
    checkpointPending: false,
    incomplete: false,
  });
  state.collections.mockReturnValue(0);
  state.logout.mockResolvedValue(undefined);
  useDriveAppDataStore.setState(useDriveAppDataStore.getInitialState(), true);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("warns about pending collection saves and logs out only after explicit confirmation, without flushing", async () => {
  state.collections.mockReturnValue(2);
  render(<LogoutConfirmationDialog open onOpenChange={vi.fn()} />);
  expect(
    await screen.findByText("2 backup items are still pending."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Any pending changes that have not finished saving will be lost/,
    ),
  ).toBeInTheDocument();
  expect(state.logout).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Log out and clear device" }),
  );
  expect(state.logout).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
it("warns about an unfinished metadata checkpoint even when no batch is queued, and lets the user wait", async () => {
  state.inspect.mockResolvedValue({
    pendingCount: 0,
    checkpointPending: true,
    incomplete: true,
  });
  const change = vi.fn();
  render(<LogoutConfirmationDialog open onOpenChange={change} />);
  expect(
    await screen.findByText(
      "Some music tags or Library choices have not finished saving.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(change).toHaveBeenCalledWith(false);
  expect(state.logout).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
