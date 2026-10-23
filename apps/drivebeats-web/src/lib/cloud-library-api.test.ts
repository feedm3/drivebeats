import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import {
  clearPendingCollectionSaves,
  createCloudPlaylist,
  fetchCloudLibrarySync,
  renameCloudPlaylist,
  resetGoogleDriveBackup,
} from "./cloud-library-api";

const response = (status = 200, body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  const lockTails = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, action: () => unknown) => {
        const next = (lockTails.get(name) ?? Promise.resolve()).then(action);
        lockTails.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    },
  });
  window.localStorage.clear();
  useDriveAppDataStore.setState({
    accountId: "account",
    generation: "incarnation",
    status: "ready",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("collection retry journal", () => {
  it("serializes concurrent sends behind the older request's acknowledgment", async () => {
    let finishFirst!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(response());
    vi.stubGlobal("fetch", fetcher);
    const first = renameCloudPlaylist("p", "First");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const last = renameCloudPlaylist("p", "Last");
    await vi.waitFor(() => expect(Object.keys(localStorage)).toHaveLength(2));
    expect(fetcher).toHaveBeenCalledOnce();
    finishFirst(response());
    await Promise.all([first, last]);
    expect(
      fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).name),
    ).toEqual(["First", "Last"]);
  });

  it("preserves ambiguous legacy intents for recovery instead of guessing their order", async () => {
    for (const id of ["old-a", "old-b"])
      localStorage.setItem(
        `drivebeats-collection-outbox-v1:account:incarnation:${id}`,
        JSON.stringify({
          input: "/api/playlists/p",
          method: "PATCH",
          body: JSON.stringify({ name: id }),
          operationId: id,
          generation: "incarnation",
        }),
      );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchCloudLibrarySync()).rejects.toThrow("need recovery");
    expect(fetcher).not.toHaveBeenCalled();
    expect(Object.keys(localStorage)).toHaveLength(2);
  });
  it("replays rename intent in creation order even when storage enumerates it backwards", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetcher);
    await expect(renameCloudPlaylist("p", "First")).rejects.toThrow("offline");
    await expect(renameCloudPlaylist("p", "Last")).rejects.toThrow("offline");
    const entries = Object.keys(localStorage).map((key) => [
      key,
      localStorage.getItem(key) as string,
    ]);
    localStorage.clear();
    for (const [key, value] of entries.reverse())
      localStorage.setItem(key, value);
    const names: string[] = [];
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") names.push(JSON.parse(init.body).name);
      return response(200, { playlists: [], favorites: [] });
    });
    await fetchCloudLibrarySync();
    expect(names).toEqual(["First", "Last"]);
  });

  it("does not let a newer successful edit overtake an older unresolved intent", async () => {
    let online = false;
    const applied: string[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      const name = init?.body && JSON.parse(init.body).name;
      if (!online && name === "First") throw new TypeError("offline");
      if (name) applied.push(name);
      return response(200, { playlists: [], favorites: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(renameCloudPlaylist("p", "First")).rejects.toThrow("offline");
    await expect(renameCloudPlaylist("p", "Last")).rejects.toThrow("offline");
    expect(applied).toEqual([]);
    online = true;
    await fetchCloudLibrarySync();
    expect(applied).toEqual(["First", "Last"]);
  });

  it("does not recreate a cleared journal when a late response advances its receipt", async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("offline");
    const pending = fetchCloudLibrarySync();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await clearPendingCollectionSaves();
    finish(
      response(409, {
        error: "Retry",
        code: "appdata_operation_resume",
        resumeOperationId: "a".repeat(64),
      }),
    );
    await expect(pending).rejects.toThrow("Retry");
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });
  it("persists a successor from a long canceled chain and resumes that ID after reload", async () => {
    const successor = "a".repeat(64);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        response(409, {
          error: "Retry shortly",
          code: "appdata_operation_resume",
          resumeOperationId: successor,
        }),
      )
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(200, { playlists: [], favorites: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("offline");
    await expect(fetchCloudLibrarySync()).rejects.toThrow("Retry shortly");
    const key = Object.keys(window.localStorage)[0];
    expect(
      JSON.parse(window.localStorage.getItem(key) as string).operationId,
    ).toBe(successor);
    expect(await fetchCloudLibrarySync()).toEqual({
      playlists: [],
      favorites: [],
    });
    expect(fetcher.mock.calls[2][1].headers["X-DriveBeats-Operation"]).toBe(
      successor,
    );
    expect(window.localStorage.getItem(key)).toBeNull();
  });
  it("can reset a signed incarnation before backup restoration populated the client store", async () => {
    useDriveAppDataStore.setState({ generation: "stale-store-generation" });
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetcher);
    await resetGoogleDriveBackup("signed-current-generation");
    expect(fetcher.mock.calls[0][1].headers["X-DriveBeats-Generation"]).toBe(
      "signed-current-generation",
    );
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });
  it("discards a stale edit rejected after a peer deletion and still refreshes collections", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        response(404, {
          error: "Playlist not found; refresh your Library",
          code: "appdata_collection_not_found",
        }),
      )
      .mockResolvedValueOnce(response(200, { playlists: [], favorites: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("offline");
    expect(await fetchCloudLibrarySync()).toEqual({
      playlists: [],
      favorites: [],
    });
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });
  it("replays the same semantic request and ID before reading cloud after a lost reply", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(200, { playlists: [], favorites: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("interrupted");
    const key = Object.keys(window.localStorage).find((key) =>
      key.startsWith("drivebeats-collection-outbox-v1:"),
    );
    expect(key).toBeTruthy();
    await fetchCloudLibrarySync();
    const first = fetcher.mock.calls[0][1];
    const retry = fetcher.mock.calls[1][1];
    expect(retry.body).toBe(first.body);
    expect(retry.headers["X-DriveBeats-Operation"]).toBe(
      first.headers["X-DriveBeats-Operation"],
    );
    expect(retry.headers["X-DriveBeats-Generation"]).toBe("incarnation");
    expect(fetcher.mock.calls[2][0]).toBe("/api/sync/library");
    expect(window.localStorage.getItem(key as string)).toBeNull();
  });
  it("does not submit another account incarnation's pending changes", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response(200, { playlists: [], favorites: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow();
    useDriveAppDataStore.setState({
      accountId: "other",
      generation: "new-incarnation",
    });
    await fetchCloudLibrarySync();
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "/api/playlists",
      "/api/sync/library",
    ]);
  });
  it("removes a definitely rejected request instead of retrying across approval changes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response(403, { error: "Approval required" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("Approval required");
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });
  it("does not change collections without prepared account identity", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    useDriveAppDataStore.setState({ generation: null });
    await expect(
      createCloudPlaylist({ id: "p", name: "Saved" }),
    ).rejects.toThrow("Prepare");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
