import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createFixtureBridge } from "./fixture-bridge";
import { FIXTURE_AUDIO_PATHS } from "./fixture-tracks";
import { Player } from "./player";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows linked existing Playlists and disconnect recovery without replacing the Audio element", async () => {
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
  const bridge = createFixtureBridge(host);
  await bridge.connect();
  const { container } = render(
    <Player bridge={bridge} audioSources={FIXTURE_AUDIO_PATHS} />,
  );
  const audio = container.querySelector("audio");
  expect(
    screen.getByText(/copy the link to open it in Firefox/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connect DriveBeats" }));
  expect(await screen.findByText("Road trip")).toBeInTheDocument();
  expect(screen.getByText("1 Playlist · 2 favorites")).toBeInTheDocument();
  expect(container.querySelector("audio")).toBe(audio);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(
    await screen.findByRole("button", { name: "Connect DriveBeats" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Road trip")).not.toBeInTheDocument();
  expect(container.querySelector("audio")).toBe(audio);
  await act(async () => bridge.dispose());
});
it("keeps standalone sample playback available while account connection requires ChatGPT", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const bridge = createFixtureBridge(null);
  render(<Player bridge={bridge} audioSources={FIXTURE_AUDIO_PATHS} />);
  expect(
    screen.getByRole("button", { name: "Connect DriveBeats" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  expect(
    screen.getByText(/Open DriveBeats in ChatGPT to connect/),
  ).toBeInTheDocument();
});
