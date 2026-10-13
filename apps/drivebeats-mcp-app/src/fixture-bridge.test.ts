import { describe, expect, it, vi } from "vitest";
import { createFixtureBridge, initializeFixtureBridge } from "./fixture-bridge";
import { FIXTURE_TOOL_NAME, FIXTURE_TRACKS } from "./fixture-tracks";

const result = { structuredContent: { tracks: FIXTURE_TRACKS } };

function mockHost() {
  let receive: ((value: unknown) => void) | undefined;
  const cleanupSize = vi.fn();
  const host = {
    addEventListener: vi.fn(
      (_event: "toolresult", handler: (value: unknown) => void) => {
        receive = handler;
      },
    ),
    removeEventListener: vi.fn(),
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    setupSizeChangedNotifications: vi.fn(() => cleanupSize),
    getHostCapabilities: vi.fn((): { serverTools?: unknown } => ({
      serverTools: {},
    })),
    callServerTool: vi.fn(async (): Promise<unknown> => result),
  };
  return { host, cleanupSize, emit: (value: unknown) => receive?.(value) };
}

describe("fixture bridge", () => {
  it("receives launch results during initialization and calls the fixture tool only after capability detection", async () => {
    const { host, emit } = mockHost();
    host.connect.mockImplementation(async () => {
      emit(result);
    });
    const bridge = createFixtureBridge(host);
    const modes: string[] = [];
    bridge.subscribe(() => modes.push(bridge.getSnapshot().mode));
    expect(await bridge.refresh()).toBe(false);
    expect(host.callServerTool).not.toHaveBeenCalled();
    await bridge.connect();
    expect(modes).toEqual(["connecting", "connected"]);
    expect(bridge.getSnapshot().tracks).toBe(FIXTURE_TRACKS);
    expect(host.connect).toHaveBeenCalledWith(undefined, { timeout: 10_000 });
    expect(await bridge.refresh()).toBe(true);
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: FIXTURE_TOOL_NAME,
      arguments: {},
    });
  });

  it("keeps last successful tracks when an error or unexpected media arrives", async () => {
    const { host, emit } = mockHost();
    const bridge = createFixtureBridge(host);
    await bridge.connect();
    emit(result);
    emit({ isError: true, content: [{ type: "text", text: "failure" }] });
    expect(bridge.getSnapshot().error).toContain("fixture tool failed");
    expect(bridge.getSnapshot().tracks).toBe(FIXTURE_TRACKS);
    emit({
      structuredContent: {
        tracks: [{ id: "external", url: "https://example.com/audio.wav" }],
      },
    });
    expect(bridge.getSnapshot().error).toContain("two sample tracks");
    expect(bridge.getSnapshot().tracks).toBe(FIXTURE_TRACKS);
  });

  it("feature-detects hosts without server tools and surfaces initialization failure", async () => {
    const { host } = mockHost();
    host.getHostCapabilities.mockReturnValue({});
    const bridge = createFixtureBridge(host);
    await bridge.connect();
    await bridge.refresh();
    expect(bridge.getSnapshot().canCallTools).toBe(false);
    expect(host.callServerTool).not.toHaveBeenCalled();
    expect(bridge.getSnapshot().error).toContain("cannot refresh");
    host.connect.mockRejectedValue(new Error("timeout"));
    const failedBridge = createFixtureBridge(host);
    await failedBridge.connect();
    expect(failedBridge.getSnapshot().mode).toBe("unavailable");
  });

  it("cleans listeners/resize observer and ignores an in-flight result after disposal", async () => {
    const { host, cleanupSize, emit } = mockHost();
    let resolveResult: ((value: typeof result) => void) | undefined;
    host.callServerTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResult = resolve;
        }),
    );
    const bridge = createFixtureBridge(host);
    const listener = vi.fn();
    bridge.subscribe(listener);
    await bridge.connect();
    const pending = bridge.refresh();
    await bridge.dispose();
    const snapshot = bridge.getSnapshot();
    const calls = listener.mock.calls.length;
    emit(result);
    resolveResult?.(result);
    expect(await pending).toBe(false);
    expect(bridge.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(host.removeEventListener).toHaveBeenCalledWith(
      "toolresult",
      expect.any(Function),
    );
    expect(cleanupSize).toHaveBeenCalledOnce();
    expect(host.close).toHaveBeenCalledOnce();
    await bridge.dispose();
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("reports a missing host without simulating a successful tool result", async () => {
    const bridge = createFixtureBridge(null);
    const snapshot = bridge.getSnapshot();
    const listener = vi.fn();
    bridge.subscribe(listener);
    await bridge.connect();
    expect(await bridge.refresh()).toBe(false);
    expect(bridge.getSnapshot()).toBe(snapshot);
    expect(snapshot.mode).toBe("unavailable");
    expect(snapshot.canCallTools).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("confirms refresh only when the host returns validated tracks", async () => {
    const { host } = mockHost();
    const bridge = createFixtureBridge(host);
    await bridge.connect();
    host.callServerTool.mockResolvedValue({
      structuredContent: { tracks: [] },
    });
    expect(await bridge.refresh()).toBe(false);
    expect(bridge.getSnapshot().error).toContain("two sample tracks");
    host.callServerTool.mockRejectedValue(new Error("disconnected"));
    expect(await bridge.refresh()).toBe(false);
    expect(bridge.getSnapshot().error).toContain("could not be refreshed");
  });
});

it("pauses but preserves the document on BFCache pagehide; final navigation tears it down", async () => {
  const teardown = vi.fn();
  const suspend = vi.fn();
  const bridge = initializeFixtureBridge(teardown, suspend);
  window.dispatchEvent(
    new PageTransitionEvent("pagehide", { persisted: true }),
  );
  expect(suspend).toHaveBeenCalledOnce();
  expect(teardown).not.toHaveBeenCalled();
  await bridge.refresh();
  expect(bridge.getSnapshot().mode).toBe("unavailable");
  window.dispatchEvent(
    new PageTransitionEvent("pagehide", { persisted: false }),
  );
  expect(teardown).toHaveBeenCalledOnce();
});
it("routes profile and cloud events to the account without corrupting fixture playback metadata", async () => {
  const { host, emit } = mockHost();
  const bridge = createFixtureBridge(host);
  await bridge.connect();
  emit({ structuredContent: { id: "account-a", name: "Alex" } });
  emit({
    _meta: { accountId: "account-a" },
    structuredContent: { status: "connected", playlists: [], favorites: [{}] },
  });
  expect(bridge.account?.getSnapshot().library?.favoriteCount).toBe(1);
  expect(bridge.getSnapshot().error).toBeNull();
  emit(result);
  expect(bridge.account?.getSnapshot().profile?.id).toBe("account-a");
  expect(bridge.getSnapshot().tracks).toBe(FIXTURE_TRACKS);
  emit({ isError: true, structuredContent: { status: "sign_in_required" } });
  expect(bridge.account?.getSnapshot().profile).toBeNull();
  expect(bridge.getSnapshot().error).toBeNull();
});
