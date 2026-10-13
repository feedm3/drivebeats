import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXTURE_AUDIO_PATHS } from "./fixture-tracks";

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    async function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
    },
  );
});
afterEach(() => {
  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    );
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("uses normal static MP3 paths in standalone mode and preserves Audio through BFCache suspension", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("./main");
  });
  const audio = document.querySelector("audio");
  expect(audio?.getAttribute("src")).toBe(FIXTURE_AUDIO_PATHS.pulse);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await screen.findByRole("button", { name: "Pause" });
  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
  });
  expect(document.querySelector("audio")).toBe(audio);
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    );
  });
  expect(document.querySelector("audio")).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

it("uses the server-provided origin and retains the same HTTPS source on media failure", async () => {
  document.body.innerHTML =
    '<script id="drivebeats-fixture-audio" type="application/json">{"origin":"https://drivebeats.example"}</script><div id="root"></div>';
  await act(async () => {
    await import("./main");
  });
  const audio = document.querySelector("audio");
  const expected = `https://drivebeats.example${FIXTURE_AUDIO_PATHS.pulse}`;
  expect(audio?.getAttribute("src")).toBe(expected);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await screen.findByRole("button", { name: "Pause" });
  fireEvent.error(audio as HTMLAudioElement);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This sample could not load",
  );
  expect(document.querySelector("audio")).toBe(audio);
  expect(audio?.getAttribute("src")).toBe(expected);
});

it("shows unavailable samples without assigning a source when server configuration is invalid", async () => {
  document.body.innerHTML =
    '<script id="drivebeats-fixture-audio" type="application/json">invalid configuration</script><div id="root"></div>';
  await act(async () => {
    await import("./main");
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "sample tracks are unavailable",
  );
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  expect(document.querySelector("audio")?.hasAttribute("src")).toBe(false);
});
