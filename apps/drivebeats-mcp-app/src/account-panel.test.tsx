import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createAccountBridge } from "./account-bridge";
import { AccountPanel } from "./account-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows linked existing Playlists and disconnect recovery and disconnect recovery", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const host = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setupSizeChangedNotifications: () => () => {},
    getHostCapabilities: () => ({ serverTools: {} }),
    callServerTool: vi.fn(
      async ({ name }: { name: string }): Promise<unknown> => ({
        _meta: { accountId: "account-a" },
        structuredContent:
          name === "drivebeats_connect_account"
            ? {
                id: "account-a",
                name: "Alex",
                email: "alex@example.test",
              }
            : name === "drivebeats_disconnect"
              ? { status: "disconnected" }
              : {
                  status: "connected",
                  playlists: [{ id: "one", name: "Road trip", tracks: [{}] }],
                  favorites: [{}, {}],
                },
      }),
    ),
  };
  const bridge = createAccountBridge(host);
  bridge.setAvailable(true);
  render(<AccountPanel bridge={bridge} />);
  expect(
    screen.getByText(/copy the link to open it in Firefox/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connect DriveBeats" }));
  expect(await screen.findByText("Road trip")).toBeInTheDocument();
  expect(screen.getByText("1 Playlist · 2 favorites")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(
    await screen.findByRole("button", { name: "Connect DriveBeats" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Road trip")).not.toBeInTheDocument();
  await act(async () => bridge.dispose());
});
it("requires ChatGPT for account connection", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const bridge = createAccountBridge(null);
  render(<AccountPanel bridge={bridge} />);
  expect(
    screen.getByRole("button", { name: "Connect DriveBeats" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Open DriveBeats in ChatGPT to connect/),
  ).toBeInTheDocument();
});
