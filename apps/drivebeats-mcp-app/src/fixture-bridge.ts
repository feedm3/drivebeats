import { App } from "@modelcontextprotocol/ext-apps";
import { type AccountBridge, createAccountBridge } from "./account-bridge";
import {
  FIXTURE_TOOL_NAME,
  FIXTURE_TRACKS,
  type FixtureTrack,
  readFixtureResult,
} from "./fixture-tracks";
import { getMcpMediaOrigin } from "./media-origin";

export interface FixtureBridgeState {
  mode: "connecting" | "connected" | "unavailable";
  loading: boolean;
  tracks: readonly FixtureTrack[];
  error: string | null;
  canCallTools: boolean;
}

export interface FixtureBridge {
  account?: AccountBridge;
  subscribe(listener: () => void): () => void;
  getSnapshot(): FixtureBridgeState;
  refresh(): Promise<boolean>;
  dispose(closeTransport?: boolean): Promise<void>;
}

interface HostApp {
  addEventListener(
    event: "toolresult",
    listener: (result: unknown) => void,
  ): void;
  removeEventListener(
    event: "toolresult",
    listener: (result: unknown) => void,
  ): void;
  connect(transport: undefined, options: { timeout: number }): Promise<void>;
  close(): Promise<void>;
  setupSizeChangedNotifications(): () => void;
  getHostCapabilities(): { serverTools?: unknown } | undefined;
  callServerTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

export function createFixtureBridge(
  app: HostApp | null,
): FixtureBridge & { connect(): Promise<void> } {
  let state: FixtureBridgeState = {
    mode: app ? "connecting" : "unavailable",
    loading: false,
    tracks: FIXTURE_TRACKS,
    error: app
      ? null
      : "Open DriveBeats in ChatGPT to load tracks from the host.",
    canCallTools: false,
  };
  let disposed = false;
  let cleanupSize: (() => void) | undefined;
  const listeners = new Set<() => void>();
  let mediaOrigin: string | null = null;
  try {
    mediaOrigin = getMcpMediaOrigin();
  } catch {
    // Invalid authorization origin configuration prevents scoped media reads.
  }
  const account = createAccountBridge(app, mediaOrigin);
  function update(changes: Partial<FixtureBridgeState>) {
    if (disposed) return;
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }
  function receive(result: unknown) {
    if (disposed) return false;
    const accountProfile = (
      result as { structuredContent?: { id?: unknown } } | null
    )?.structuredContent?.id;
    const status = (
      result as { structuredContent?: { status?: unknown } } | null
    )?.structuredContent?.status;
    if (
      typeof accountProfile === "string" ||
      [
        "connected",
        "disconnected",
        "sign_in_required",
        "scope_required",
        "error",
        "ready",
      ].includes(String(status))
    ) {
      account.receive(result);
      return false;
    }
    try {
      update({ tracks: readFixtureResult(result), error: null });
      return true;
    } catch (error) {
      update({
        error:
          error instanceof Error
            ? error.message
            : "The sample tracks could not be loaded.",
      });
      return false;
    }
  }
  // Install before initialization: hosts may deliver the launch result immediately.
  app?.addEventListener("toolresult", receive);
  return {
    account,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    async connect() {
      if (!app || disposed) return;
      try {
        await app.connect(undefined, { timeout: 10_000 });
        if (disposed) return;
        cleanupSize = app.setupSizeChangedNotifications();
        const canCallTools = Boolean(app.getHostCapabilities()?.serverTools);
        account.setAvailable(canCallTools);
        update({
          mode: "connected",
          canCallTools,
          error: canCallTools
            ? null
            : "This host cannot refresh sample tracks. Playback is still available.",
        });
      } catch {
        update({
          mode: "unavailable",
          error:
            "The host connection failed. Reopen DriveBeats to reconnect. You can still play the sample tracks.",
        });
      }
    },
    async refresh() {
      if (disposed || !app || !state.canCallTools || state.loading)
        return false;
      update({ loading: true, error: null });
      try {
        return receive(
          await app.callServerTool({ name: FIXTURE_TOOL_NAME, arguments: {} }),
        );
      } catch {
        update({
          error: "The sample tracks could not be refreshed. Try again.",
        });
        return false;
      } finally {
        update({ loading: false });
      }
    },
    async dispose(closeTransport = true) {
      if (disposed) return;
      disposed = true;
      account.dispose();
      app?.removeEventListener("toolresult", receive);
      cleanupSize?.();
      listeners.clear();
      if (closeTransport) await app?.close();
    },
  };
}

// One bridge per document. React result updates never initialize a new connection.
export function initializeFixtureBridge(
  onTeardown: () => void,
  onSuspend: () => void,
): FixtureBridge {
  const app =
    window.parent === window
      ? null
      : new App(
          { name: "DriveBeats", version: "0.1.0" },
          {},
          { strict: true, autoResize: false },
        );
  const bridge = createFixtureBridge(app);
  if (app) {
    app.onteardown = async () => {
      onTeardown();
      // Keep transport alive for the teardown response; the host then removes the iframe.
      await bridge.dispose(false);
      return {};
    };
  }
  window.addEventListener("pagehide", (event) => {
    onSuspend();
    // BFCache restores this same document without rerunning the entry module.
    // Keep its React root/bridge intact while frozen so Back remains usable.
    if (!event.persisted) {
      onTeardown();
      void bridge.dispose();
    }
  });
  void bridge.connect();
  return bridge;
}
