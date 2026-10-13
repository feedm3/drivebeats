import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(async () => {
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it("requires a real account and imports, preserves document through suspension, and tears down without any media source", async () => {
  await act(async () => {
    await import("./main");
  });
  expect(
    screen.getByRole("button", { name: "Connect DriveBeats" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Play" }),
  ).not.toBeInTheDocument();
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  expect(
    screen.getByRole("heading", { name: "DriveBeats" }),
  ).toBeInTheDocument();
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  expect(
    screen.queryByRole("heading", { name: "DriveBeats" }),
  ).not.toBeInTheDocument();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
