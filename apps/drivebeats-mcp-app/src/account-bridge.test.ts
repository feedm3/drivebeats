import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_LIBRARY_TOOL,
  CONNECT_TOOL,
  createAccountBridge,
  DISCONNECT_TOOL,
} from "./account-bridge";

const profile = {
  structuredContent: {
    id: "google-a",
    name: "Alex",
    email: "alex@example.test",
  },
};
const library = {
  _meta: { accountId: "google-a" },
  structuredContent: {
    status: "connected",
    playlists: [
      { id: "playlist-a", name: "Road trip", tracks: [{ fileId: "track-a" }] },
    ],
    favorites: [{ fileId: "favorite-a" }],
  },
};
function connected() {
  const caller = {
    callServerTool: vi.fn(
      async ({ name }: { name: string }): Promise<unknown> =>
        name === CONNECT_TOOL
          ? profile
          : name === DISCONNECT_TOOL
            ? { structuredContent: { status: "disconnected" } }
            : library,
    ),
  };
  const bridge = createAccountBridge(caller);
  bridge.setAvailable(true);
  return { bridge, caller };
}

describe("account bridge", () => {
  it("waits for deliberate connection and reads existing data through authenticated host tools", async () => {
    const { bridge, caller } = connected();
    expect(caller.callServerTool).not.toHaveBeenCalled();
    expect(bridge.getSnapshot().profile).toBeNull();
    expect(await bridge.connect()).toBe(true);
    expect(caller.callServerTool.mock.calls.map(([args]) => args.name)).toEqual(
      [CONNECT_TOOL, CLOUD_LIBRARY_TOOL],
    );
    expect(bridge.getSnapshot().library).toEqual({
      playlists: [{ id: "playlist-a", name: "Road trip", trackCount: 1 }],
      favoriteCount: 1,
    });
    expect(bridge.getSnapshot().profile?.id).toBe("google-a");
  });
  it("shows sign-in challenge and canceled consent recovery without pretending to connect", async () => {
    const { bridge, caller } = connected();
    caller.callServerTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { status: "sign_in_required" },
      _meta: { "mcp/www_authenticate": ["Bearer resource_metadata=example"] },
    });
    expect(await bridge.connect()).toBe(false);
    expect(bridge.getSnapshot().status).toBe("sign_in_required");
    expect(bridge.getSnapshot().error).toContain("If you canceled");
    expect(caller.callServerTool).toHaveBeenCalledTimes(1);
    expect(await bridge.connect()).toBe(true);
    expect(bridge.getSnapshot().profile?.name).toBe("Alex");
  });
  it("clears displayed private data on expired credentials and scope denial", async () => {
    const { bridge, caller } = connected();
    await bridge.connect();
    caller.callServerTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { status: "scope_required" },
    });
    expect(await bridge.refresh()).toBe(false);
    expect(bridge.getSnapshot().status).toBe("scope_required");
    expect(bridge.getSnapshot().profile).toBeNull();
    expect(bridge.getSnapshot().library).toBeNull();
    expect(bridge.getSnapshot().error).toContain("Reconnect");
  });
  it("does not leak server exception or malformed account contents into errors", async () => {
    const { bridge, caller } = connected();
    caller.callServerTool.mockRejectedValueOnce(
      new Error("secret_token_do_not_display"),
    );
    expect(await bridge.connect()).toBe(false);
    expect(bridge.getSnapshot().error).not.toContain("secret_token");
    caller.callServerTool.mockResolvedValueOnce({
      structuredContent: {
        status: "connected",
        profile: { email: "missing-identity" },
      },
    });
    expect(await bridge.connect()).toBe(false);
    expect(bridge.getSnapshot().error).toContain("unexpected");
  });
  it("revokes only via disconnect tool and clears view data, then reconnects", async () => {
    const { bridge, caller } = connected();
    await bridge.connect();
    expect(await bridge.disconnect()).toBe(true);
    expect(caller.callServerTool).toHaveBeenLastCalledWith({
      name: DISCONNECT_TOOL,
      arguments: {},
    });
    expect(bridge.getSnapshot().library).toBeNull();
    expect(bridge.getSnapshot().profile).toBeNull();
    expect(bridge.getSnapshot().notice).toContain(
      "Playlists and favorites are kept",
    );
    expect(await bridge.connect()).toBe(true);
    expect(bridge.getSnapshot().library?.favoriteCount).toBe(1);
  });
  it("rejects a stale library response after the host switches accounts", async () => {
    const { bridge, caller } = connected();
    await bridge.connect();
    let resolve: ((value: unknown) => void) | undefined;
    caller.callServerTool.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = bridge.refresh();
    bridge.receive({
      structuredContent: {
        id: "google-b",
        name: "Bailey",
      },
    });
    resolve?.(library);
    expect(await pending).toBe(false);
    expect(bridge.getSnapshot().profile?.id).toBe("google-b");
    expect(bridge.getSnapshot().library).toBeNull();
  });
  it("ignores late responses after teardown and does not call unsupported hosts", async () => {
    const unavailable = createAccountBridge(null);
    expect(await unavailable.connect()).toBe(false);
    const { bridge, caller } = connected();
    let resolve: ((value: unknown) => void) | undefined;
    caller.callServerTool.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = bridge.connect();
    bridge.dispose();
    resolve?.(profile);
    expect(await pending).toBe(false);
    expect(bridge.getSnapshot().profile).toBeNull();
    expect(caller.callServerTool).toHaveBeenCalledTimes(1);
  });
});
it("keeps scoped media access out of state and rejects foreign, expired and model-visible URLs", async () => {
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const mediaUrl = `https://drivebeats.example/api/mcp/media/${"a".repeat(43)}`;
  const caller = {
    callServerTool: vi.fn(
      async ({ name }: { name: string }): Promise<unknown> =>
        name === CONNECT_TOOL
          ? profile
          : name === CLOUD_LIBRARY_TOOL
            ? library
            : {
                structuredContent: {
                  status: "ready",
                  fileId: "track-a",
                  fileName: "Track A.mp3",
                  mimeType: "audio/mpeg",
                  expiresAt,
                },
                _meta: { mediaUrl },
              },
    ),
  };
  const bridge = createAccountBridge(caller, "https://drivebeats.example");
  bridge.setAvailable(true);
  await bridge.connect();
  expect(await bridge.prepareMedia("track-a")).toEqual({
    fileId: "track-a",
    fileName: "Track A.mp3",
    mimeType: "audio/mpeg",
    expiresAt,
    mediaUrl,
  });
  expect(JSON.stringify(bridge.getSnapshot())).not.toContain(mediaUrl);
  caller.callServerTool.mockResolvedValueOnce({
    structuredContent: {
      status: "ready",
      fileId: "track-a",
      fileName: "Track A",
      mimeType: "audio/mpeg",
      expiresAt,
    },
    _meta: {
      mediaUrl: mediaUrl.replace("drivebeats.example", "other.example"),
    },
  });
  expect(await bridge.prepareMedia("track-a")).toBeNull();
  caller.callServerTool.mockResolvedValueOnce({
    structuredContent: {
      status: "ready",
      fileId: "track-a",
      fileName: "Track A",
      mimeType: "audio/mpeg",
      expiresAt: "2000-01-01T00:00:00Z",
    },
    _meta: { mediaUrl },
  });
  expect(await bridge.prepareMedia("track-a")).toBeNull();
  caller.callServerTool.mockResolvedValueOnce({
    structuredContent: {
      status: "ready",
      fileId: "track-a",
      fileName: "Track A",
      mimeType: "audio/mpeg",
      expiresAt,
      mediaUrl,
    },
  });
  expect(await bridge.prepareMedia("track-a")).toBeNull();
});
it("ignores delayed profile broadcasts after disconnect and account-mismatched cloud results", async () => {
  const { bridge } = connected();
  await bridge.connect();
  await bridge.disconnect();
  bridge.receive(profile);
  expect(bridge.getSnapshot().profile).toBeNull();
  await bridge.connect();
  bridge.receive({ structuredContent: { id: "google-b", name: "Bailey" } });
  bridge.receive(library);
  expect(bridge.getSnapshot().profile?.id).toBe("google-b");
  expect(bridge.getSnapshot().library).toBeNull();
  bridge.receive({ ...library, _meta: { accountId: "google-b" } });
  expect(bridge.getSnapshot().library?.favoriteCount).toBe(1);
});
