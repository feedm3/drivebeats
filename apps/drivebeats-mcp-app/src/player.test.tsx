import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureBridge } from "./fixture-bridge";
import {
  FIXTURE_AUDIO_PATHS,
  FIXTURE_TOOL_NAME,
  FIXTURE_TRACKS,
} from "./fixture-tracks";
import { Player } from "./player";

const audioSources = {
  pulse: `https://drivebeats.example${FIXTURE_AUDIO_PATHS.pulse}`,
  afterglow: `https://drivebeats.example${FIXTURE_AUDIO_PATHS.afterglow}`,
};
const result = { structuredContent: { tracks: FIXTURE_TRACKS } };

async function connectedBridge() {
  let receive: ((value: unknown) => void) | undefined;
  const host = {
    addEventListener: vi.fn(
      (_event: "toolresult", listener: (value: unknown) => void) => {
        receive = listener;
      },
    ),
    removeEventListener: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setupSizeChangedNotifications: vi.fn(() => () => {}),
    getHostCapabilities: vi.fn(() => ({ serverTools: {} })),
    callServerTool: vi.fn(async () => result),
  };
  const bridge = createFixtureBridge(host);
  await bridge.connect();
  return { bridge, host, emit: (value: unknown) => receive?.(value) };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    async function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("pause"));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DriveBeats player", () => {
  it("keeps the same playing Audio, source and position across repeated host results", async () => {
    const { bridge, emit } = await connectedBridge();
    const { container } = render(
      <Player bridge={bridge} audioSources={audioSources} />,
    );
    const audio = container.querySelector("audio");
    if (!audio) throw new Error("Missing Audio element");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await screen.findByRole("button", { name: "Pause" });
    audio.currentTime = 3;
    fireEvent.timeUpdate(audio);
    act(() => {
      emit(result);
      emit(result);
    });
    expect(container.querySelector("audio")).toBe(audio);
    expect(audio.getAttribute("src")).toBe(audioSources.pulse);
    expect(audio.currentTime).toBe(3);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("refreshes through the host and announces only a validated success", async () => {
    const { bridge, host } = await connectedBridge();
    const { container } = render(
      <Player bridge={bridge} audioSources={audioSources} />,
    );
    const audio = container.querySelector("audio");
    fireEvent.click(screen.getByRole("button", { name: "Refresh tracks" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Tracks refreshed"),
    );
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: FIXTURE_TOOL_NAME,
      arguments: {},
    });
    host.callServerTool.mockRejectedValueOnce(new Error("Network failure"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh tracks" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Tracks refreshed",
    );
    expect(container.querySelector("audio")).toBe(audio);
  });

  it("pauses on Next, prepares the new track without autoplay and stops on unmount", async () => {
    const { bridge } = await connectedBridge();
    const { container, unmount } = render(
      <Player bridge={bridge} audioSources={audioSources} />,
    );
    const audio = container.querySelector("audio");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await screen.findByRole("button", { name: "Pause" });
    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    expect(container.querySelector("audio")).toBe(audio);
    expect(audio?.getAttribute("src")).toBe(audioSources.afterglow);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  });

  it("shows a concise playback error, supports retry and retains its source on load failure", async () => {
    const { bridge } = await connectedBridge();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException("Playback denied", "NotAllowedError"),
    );
    const { container } = render(
      <Player bridge={bridge} audioSources={audioSources} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tap Play to try again",
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    const audio = container.querySelector("audio");
    if (!audio) throw new Error("Missing Audio element");
    fireEvent.error(audio);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This sample could not load",
    );
    expect(audio.getAttribute("src")).toBe(audioSources.pulse);
  });

  it("ignores a stale Play rejection after selecting another track", async () => {
    const { bridge } = await connectedBridge();
    let rejectPlay: ((error: Error) => void) | undefined;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPlay = reject;
        }),
    );
    render(<Player bridge={bridge} audioSources={audioSources} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    await act(async () => {
      rejectPlay?.(new Error("AbortError"));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Afterglow" }),
    ).toBeInTheDocument();
  });
});
