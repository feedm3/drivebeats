import {
  clearCatalog,
  loadCatalog,
  saveCatalog,
} from "@drivebeats/client/catalog";
import { FOLDER_MIME } from "@drivebeats/core/types";
import type { App } from "@modelcontextprotocol/ext-apps";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMusicBridge, type MusicBridge } from "./music-bridge";
import { Player } from "./player";

vi.mock("@drivebeats/client/catalog", async (original) => ({
  ...(await original<typeof import("@drivebeats/client/catalog")>()),
  loadCatalog: vi.fn(async () => undefined),
  saveCatalog: vi.fn(async () => undefined),
  clearCatalog: vi.fn(async () => undefined),
}));
let bridge: MusicBridge | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML =
    '<script id="drivebeats-media-read" type="application/json">{"origin":"https://drivebeats.example"}</script><script id="drivebeats-import-selection" type="application/json">{"origin":"https://drivebeats.example"}</script>';
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
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await bridge?.dispose();
  bridge = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const track = (id: string) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
});
function host(sampling = true) {
  const commands: Record<string, unknown>[] = [];
  const acknowledgements: Record<string, unknown>[] = [];
  let unavailable = false;
  const session = {
    sessionId: "session-one",
    importedFolderIds: ["imported"],
    standaloneTrackIds: [],
    importsRevision: 1,
    importReceipt: "verified-receipt",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const app = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setupSizeChangedNotifications: () => () => {},
    getHostCapabilities: () => ({
      serverTools: {},
      ...(sampling ? { sampling: {} } : {}),
    }),
    openLink: vi.fn(async () => ({})),
    createSamplingMessage: vi.fn(async () => ({
      role: "assistant",
      model: "host",
      content: { type: "text", text: '["second","third"]' },
    })),
    callServerTool: vi.fn(
      async ({
        name,
        arguments: args,
      }: {
        name: string;
        arguments: Record<string, unknown>;
      }) => {
        let structuredContent: Record<string, unknown> = {};
        let _meta: Record<string, unknown> = {};
        switch (name) {
          case "drivebeats_get_profile":
            structuredContent = { id: "account-one", name: "Alex" };
            break;
          case "drivebeats_open_session":
            structuredContent = session;
            break;
          case "drivebeats_heartbeat_session":
            if (unavailable)
              return {
                structuredContent: {
                  status: "unavailable",
                  message: "Session closed.",
                },
                isError: true,
              };
            structuredContent = session;
            break;
          case "drivebeats_poll_session":
            structuredContent = { session, command: commands.shift() ?? null };
            break;
          case "drivebeats_get_cloud_library":
            structuredContent = {
              status: "connected",
              playlists: [],
              favorites: [],
            };
            _meta = { accountId: "account-one" };
            break;
          case "drivebeats_read_item":
            structuredContent = {
              file: { id: "imported", name: "Imported", mimeType: FOLDER_MIME },
            };
            break;
          case "drivebeats_read_folder":
            structuredContent = {
              files: [track("first"), track("second"), track("third")],
            };
            break;
          case "drivebeats_prepare_media":
            structuredContent = {
              status: "ready",
              fileId: args.fileId,
              fileName: `${args.fileId}.mp3`,
              mimeType: "audio/mpeg",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
            _meta = {
              mediaUrl: `https://drivebeats.example/api/mcp/media/${"a".repeat(43)}`,
            };
            break;
          case "drivebeats_acknowledge_command":
            acknowledgements.push(args);
            structuredContent = { acknowledged: true };
            break;
          case "drivebeats_create_playlist":
            structuredContent = {
              status: "applied",
              operationId: args.operationId,
              result: { playlistId: "saved" },
            };
            break;
          case "drivebeats_close_session":
            structuredContent = { status: "closed" };
            break;
          default:
            throw new Error(`Unexpected test call ${name}`);
        }
        return { structuredContent, _meta };
      },
    ),
  };
  return {
    app,
    commands,
    acknowledgements,
    session,
    closeSession() {
      unavailable = true;
    },
  };
}
async function connected(sampling = true) {
  const testHost = host(sampling);
  bridge = createMusicBridge(
    testHost.app as unknown as App,
    document.createElement("audio"),
  );
  await bridge.connect();
  await vi.waitFor(() =>
    expect(bridge?.getSnapshot().catalog?.entries).toHaveLength(4),
  );
  return testHost;
}
it("executes bounded Library search through the account-local complete catalog and rejects stale commands", async () => {
  const testHost = await connected();
  testHost.commands.push({
    operationId: "search",
    type: "search_library",
    payload: { query: "SECOND", limit: 50 },
    claimToken: "claim",
    importsRevision: 1,
    expiresAt: testHost.session.expiresAt,
  });
  await vi.advanceTimersByTimeAsync(1600);
  expect(testHost.acknowledgements[0]).toMatchObject({
    status: "applied",
    result: {
      items: [
        { id: "second", name: "second.mp3", path: "Imported/second.mp3" },
      ],
    },
  });
  testHost.commands.push({
    operationId: "stale",
    type: "play_track",
    payload: { fileId: "first" },
    claimToken: "claim-stale",
    importsRevision: 0,
    expiresAt: testHost.session.expiresAt,
  });
  await vi.advanceTimersByTimeAsync(1600);
  expect(testHost.acknowledgements[1]).toMatchObject({
    status: "failed",
    result: { message: expect.stringContaining("Imported music changed") },
  });
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(saveCatalog).toHaveBeenCalled();
});
it("prepares DJ selections automatically, stops for manual choices and ignores late host completions", async () => {
  const testHost = await connected();
  await bridge?.player.play(track("first"), [track("first"), track("second")]);
  let resolve!: (result: {
    role: string;
    model: string;
    content: { type: string; text: string };
  }) => void;
  testHost.app.createSamplingMessage.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  bridge?.startDj("night driving");
  expect(testHost.app.createSamplingMessage).toHaveBeenCalledOnce();
  bridge?.player.queue([track("third")], "append");
  expect(bridge?.getSnapshot().dj).toBe(false);
  resolve({
    role: "assistant",
    model: "host",
    content: { type: "text", text: '["second"]' },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(bridge?.player.getUpcoming()).toEqual([]);
  bridge?.startDj("continue");
  await vi.waitFor(() => expect(bridge?.player.getUpcoming().length).toBe(2));
  bridge?.stopDj();
  expect(bridge?.player.getUpcoming()).toEqual([]);
});
it("stops audio and DJ immediately when the authoritative session closes and removes the exact result listener", async () => {
  const testHost = await connected();
  await bridge?.player.play(track("first"), [track("first")]);
  bridge?.startDj("calm");
  testHost.closeSession();
  await vi.advanceTimersByTimeAsync(1600);
  expect(bridge?.getSnapshot().sessionId).toBeNull();
  expect(bridge?.getSnapshot().dj).toBe(false);
  expect(bridge?.player.getSnapshot().playing).toBe(false);
  await bridge?.dispose();
  expect(testHost.app.removeEventListener).toHaveBeenCalledWith(
    "toolresult",
    testHost.app.addEventListener.mock.calls[0]?.[1],
  );
});
it("retains a Playlist operation ID through an uncertain result and does not claim queued saves are applied", async () => {
  const testHost = await connected();
  bridge?.player.queue([track("first")], "replace");
  const original = testHost.app.callServerTool.getMockImplementation();
  if (!original) throw new Error("Missing test host implementation.");
  let saves = 0;
  testHost.app.callServerTool.mockImplementation(async (params) => {
    if (params.name === "drivebeats_create_playlist" && saves++ === 0)
      return {
        structuredContent: {
          status: "queued",
          operationId: params.arguments.operationId,
        },
        _meta: {},
      };
    return original(params);
  });
  await bridge?.saveQueue("Road trip");
  expect(bridge?.getSnapshot().notice).toContain("pending");
  await bridge?.saveQueue("Road trip");
  const calls = testHost.app.callServerTool.mock.calls.filter(
    ([params]) => params.name === "drivebeats_create_playlist",
  );
  expect(calls[0]?.[0].arguments.operationId).toBe(
    calls[1]?.[0].arguments.operationId,
  );
  expect(bridge?.getSnapshot().notice).toContain("Playlist saved");
});
it("recovers expired account-scoped import receipts with an empty session and requires explicit imports again", async () => {
  localStorage.setItem("drivebeats-mcp-import:account-one", "expired");
  const testHost = host();
  const original = testHost.app.callServerTool.getMockImplementation();
  if (!original) throw new Error("Missing test host implementation.");
  testHost.app.callServerTool.mockImplementation(async (params) =>
    params.name === "drivebeats_open_session" && params.arguments.importReceipt
      ? {
          structuredContent: {
            status: "failed",
            message:
              "Imported music authorization expired. Select your music again.",
          },
          isError: true,
        }
      : original(params),
  );
  bridge = createMusicBridge(
    testHost.app as unknown as App,
    document.createElement("audio"),
  );
  await bridge.connect();
  await vi.waitFor(() =>
    expect(bridge?.getSnapshot().sessionId).toBe("session-one"),
  );
  const opened = testHost.app.callServerTool.mock.calls.filter(
    ([params]) => params.name === "drivebeats_open_session",
  );
  expect(opened.map(([params]) => params.arguments)).toEqual([
    { importReceipt: "expired" },
    {},
  ]);
  expect(clearCatalog).toHaveBeenCalledWith("account-one");
});
it("does not invoke inference on hosts without sampling", async () => {
  const testHost = await connected(false);
  bridge?.startDj("intent");
  expect(testHost.app.createSamplingMessage).not.toHaveBeenCalled();
  expect(bridge?.getSnapshot().dj).toBe(false);
  expect(bridge?.getSnapshot().djNotice).toContain("unavailable");
  expect(loadCatalog).toHaveBeenCalledWith("account-one");
});

it("prevents the Stop DJ click from submitting the newly switched Start button and restarting inference", async () => {
  const testHost = await connected();
  if (!bridge) throw new Error("Missing music bridge.");
  await bridge.player.play(track("first"), [track("first"), track("second")]);
  bridge.startDj("night driving");
  await vi.waitFor(() => expect(bridge?.player.getUpcoming().length).toBe(2));
  render(<Player bridge={bridge} />);
  const start = vi.spyOn(bridge, "startDj");
  const stop = vi.spyOn(bridge, "stopDj");
  const button = screen.getByRole("button", { name: "Stop DJ Mode" });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(button, click);
  expect(click.defaultPrevented).toBe(true);
  expect(stop).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Start DJ Mode" }),
  ).toBeInTheDocument();
  expect(bridge.getSnapshot().dj).toBe(false);
  expect(testHost.app.createSamplingMessage).toHaveBeenCalledOnce();
});
