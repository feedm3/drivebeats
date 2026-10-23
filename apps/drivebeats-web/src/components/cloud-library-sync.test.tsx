import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudLibrarySync } from "./cloud-library-sync";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  restore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/cloud-library-sync-runner", () => ({
  runCloudLibrarySync: mocks.sync,
}));
vi.mock("@/lib/drive-appdata-client", () => ({
  restoreDriveAppData: mocks.restore,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(() => "authenticated", {
    getState: () => ({ user: { id: "account" } }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("portable resume synchronization", () => {
  it("coalesces focus and visible events without continually resetting metadata readiness", () => {
    vi.useFakeTimers();
    render(<CloudLibrarySync />);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.restore).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
});
