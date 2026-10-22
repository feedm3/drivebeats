import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetadataIndexStore } from "@/lib/metadata-index-coordinator";
import { useMetadataLoaderStore } from "@/lib/track-metadata-loader";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { MetadataActivity } from "./metadata-activity";

const fixtures = vi.hoisted(() => ({ status: vi.fn(), diagnostics: vi.fn() }));
vi.mock("@/lib/metadata-diagnostics", () => ({
  getMetadataUnresolvedDiagnostics: fixtures.diagnostics,
}));
vi.mock("@/lib/metadata-index-coordinator", async () => {
  const { create } = await import("zustand");
  return {
    useMetadataIndexStore: create(() => ({
      revision: 0,
      running: true,
      pauseReason: null,
      retryAt: 0,
    })),
    getMetadataIndexStatus: fixtures.status,
  };
});
vi.mock("@/lib/track-metadata-loader", async () => {
  const { create } = await import("zustand");
  return { useMetadataLoaderStore: create(() => ({ revision: 0 })) };
});
vi.mock("@/stores/id3-metadata-store", async () => {
  const { create } = await import("zustand");
  return { useId3MetadataStore: create(() => ({ records: {} })) };
});
vi.mock("@/stores/library-search-store", async () => {
  const { create } = await import("zustand");
  return { useLibrarySearchStore: create(() => ({ status: "ready" })) };
});
vi.mock("@/components/ui/popover", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext({
    open: false,
    onOpenChange: (_open: boolean) => {},
  });
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <Context.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </Context.Provider>
    ),
    PopoverTrigger: function PopoverTrigger({
      children,
    }: {
      children: React.ReactNode;
    }) {
      const state = useContext(Context);
      return (
        <button
          type="button"
          aria-label="Music metadata progress"
          onClick={() => state.onOpenChange(!state.open)}
        >
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.status.mockReturnValue({
    indexingState: "running",
    coverageScopeVersion: 1,
    coveragePending: false,
    observedAt: 1,
    total: 3000,
    checked: 1,
    remaining: 2999,
    unresolved: 0,
    pauseReason: null,
    sessionOnlyCatalog: false,
  });
  fixtures.diagnostics.mockResolvedValue({
    reasons: [
      { code: "parse_error", count: 2 },
      { code: "budget_exceeded", count: 2 },
    ],
    tracks: [
      {
        id: "a",
        fileName: "Track A.mp3",
        reason: "parse_error",
        status: "unresolved",
      },
      {
        id: "b",
        fileName: "Track B.mp3",
        reason: "budget_exceeded",
        status: "unresolved",
      },
    ],
    total: 4,
    truncated: false,
    limit: 20,
  });
});
afterEach(cleanup);

describe("metadata activity subscriptions", () => {
  it("keeps the open details panel stable while row jobs and unrelated parent tooltip state stream", () => {
    const view = render(
      <div data-tooltip="0">
        <MetadataActivity />
      </div>,
    );
    expect(screen.getByText("1 of 3000 checked")).toBeInTheDocument();
    for (let tick = 1; tick <= 100; tick++) {
      act(() => {
        useMetadataLoaderStore.setState({ revision: tick });
        useId3MetadataStore.setState({ records: {} });
      });
      view.rerender(
        <div data-tooltip={tick}>
          <MetadataActivity />
        </div>,
      );
    }
    expect(fixtures.status).toHaveBeenCalledTimes(1);
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 3000,
      checked: 100,
      remaining: 2900,
      unresolved: 0,
      pauseReason: null,
      sessionOnlyCatalog: false,
    });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.getByText("100 of 3000 checked")).toBeInTheDocument();
    expect(fixtures.status).toHaveBeenCalledTimes(2);
  });
  it("keeps the same animation through count updates and pauses between reads", () => {
    const view = render(<MetadataActivity />);
    const spinner = view.container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
    for (let checked = 2; checked <= 10; checked++) {
      fixtures.status.mockReturnValue({
        indexingState: "running",
        total: 3000,
        checked,
        remaining: 3000 - checked,
        unresolved: 0,
        pauseReason: null,
        sessionOnlyCatalog: false,
      });
      act(() =>
        useMetadataIndexStore.setState((state) => ({
          revision: state.revision + 1,
        })),
      );
      expect(view.container.querySelector(".animate-spin")).toBe(spinner);
    }
    for (const pauseReason of ["budget", "hidden", null]) {
      fixtures.status.mockReturnValue({
        indexingState: pauseReason ? "paused" : "running",
        total: 3000,
        checked: 10,
        remaining: 2990,
        unresolved: 0,
        pauseReason,
        sessionOnlyCatalog: false,
      });
      act(() =>
        useMetadataIndexStore.setState((state) => ({
          revision: state.revision + 1,
        })),
      );
      expect(view.container.querySelector(".animate-spin")).toBe(spinner);
      expect(spinner).toHaveClass("motion-reduce:animate-none");
    }
  });
  it("shows readable failure reasons and saved track names only after the accessible expand action", async () => {
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 2913,
      checked: 82,
      remaining: 2827,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 1,
    });
    const view = render(<MetadataActivity />);
    expect(screen.getByText("Music metadata")).toBeInTheDocument();
    expect(fixtures.diagnostics).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    const expand = screen.getByRole("button", {
      name: "Why metadata could not be read",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(expand);
    await waitFor(() => expect(screen.getByText("Track A.mp3")).toBeVisible());
    expect(screen.getByText("2 tracks: Decoding failed")).toBeVisible();
    expect(screen.getByText("2 tracks: Reading limit reached")).toBeVisible();
    expect(
      screen.getByText(
        "Reading limit reached for this track. Other tracks continue.",
      ),
    ).toBeVisible();
    const heading = screen.getByText("Music metadata");
    const count = screen.getByText("82 of 2913 checked");
    const spinner = view.container.querySelector(".animate-spin");
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 2913,
      checked: 82,
      remaining: 2827,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: true,
      observedAt: 1,
    });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.getByText("82 of 2913 checked")).toBe(count);
    expect(screen.getByText("Music metadata")).toBe(heading);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(view.container.querySelector(".animate-spin")).toBe(spinner);
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 2913,
      checked: 83,
      remaining: 2826,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 2,
    });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.getByText("83 of 2913 checked")).toBe(count);
    expect(screen.getByText("Music metadata")).toBe(heading);
    expect(screen.queryByText("0 of 2913 checked")).not.toBeInTheDocument();
    expect(fixtures.diagnostics).toHaveBeenCalledOnce();
  });

  it("clears expanded diagnostic names immediately when the account or Library scope changes", async () => {
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 2913,
      checked: 82,
      remaining: 2827,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 1,
    });
    render(<MetadataActivity />);
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Why metadata could not be read" }),
    );
    await waitFor(() => expect(screen.getByText("Track A.mp3")).toBeVisible());
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 20,
      checked: 0,
      remaining: 16,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 2,
      coveragePending: true,
      observedAt: null,
    });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.queryByText("Track A.mp3")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Why metadata could not be read" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Checking your Library…")).toBeInTheDocument();
  });
  it("retains expanded reason rows while their same-scope refresh waits", async () => {
    const base = {
      indexingState: "running",
      total: 2913,
      checked: 82,
      remaining: 2827,
      unresolved: 4,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 1,
    };
    fixtures.status.mockReturnValue(base);
    render(<MetadataActivity />);
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Why metadata could not be read" }),
    );
    await waitFor(() => expect(screen.getByText("Track A.mp3")).toBeVisible());
    const reasonRow = screen.getByText("2 tracks: Decoding failed");
    fixtures.diagnostics.mockReturnValueOnce(new Promise(() => {}));
    fixtures.status.mockReturnValue({ ...base, unresolved: 5 });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.getByText("Track A.mp3")).toBeVisible();
    expect(screen.getByText("2 tracks: Decoding failed")).toBe(reasonRow);
    expect(
      screen.queryByText("Checking saved metadata…"),
    ).not.toBeInTheDocument();
  });

  it("keeps an open panel mounted when the last track finishes until the user closes it", () => {
    const view = render(<MetadataActivity />);
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    const heading = screen.getByText("Music metadata");
    expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    fixtures.status.mockReturnValue({
      indexingState: "complete",
      total: 3000,
      checked: 3000,
      remaining: 0,
      unresolved: 0,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 2,
    });
    act(() =>
      useMetadataIndexStore.setState((state) => ({
        revision: state.revision + 1,
      })),
    );
    expect(screen.getByText("Music metadata")).toBe(heading);
    expect(screen.getByText("3000 of 3000 checked")).toBeInTheDocument();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    expect(screen.queryByText("Music metadata")).not.toBeInTheDocument();
  });
  it.each([
    [
      "metadata_auth_required",
      "Metadata checks are waiting for sign-in. Sign in again to continue.",
    ],
    [
      "metadata_setup_error",
      "Metadata checks are unavailable because of a connection setup problem. Playback may still work.",
    ],
  ])("explains %s as a metadata-wide pause", (pauseReason, message) => {
    fixtures.status.mockReturnValue({
      indexingState: "paused",
      total: 2913,
      checked: 82,
      unresolved: 4,
      pauseReason,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 1,
    });
    render(<MetadataActivity />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
  it("omits a redundant category heading when every failed track has the same reason", async () => {
    fixtures.status.mockReturnValue({
      indexingState: "running",
      total: 2913,
      checked: 82,
      unresolved: 3,
      pauseReason: null,
      coverageScopeVersion: 1,
      coveragePending: false,
      observedAt: 1,
    });
    fixtures.diagnostics.mockResolvedValue({
      available: true,
      reasons: [{ code: "parse_error", count: 3 }],
      tracks: ["A", "B", "C"].map((name) => ({
        id: name,
        fileName: `Track ${name}.mp3`,
        reason: "parse_error",
        status: "unresolved",
      })),
      total: 3,
      truncated: false,
      limit: 20,
    });
    render(<MetadataActivity />);
    fireEvent.click(
      screen.getByRole("button", { name: "Music metadata progress" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Why metadata could not be read" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Embedded metadata could not be decoded."),
      ).toBeVisible(),
    );
    expect(screen.getByText("3 tracks could not be read.")).toBeVisible();
    expect(
      screen.queryByText("3 tracks: Decoding failed"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Track A.mp3")).toBeVisible();
    expect(screen.getByText("Track C.mp3")).toBeVisible();
  });
});
