import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RootOperation } from "@/lib/drive-appdata-client";
import { FOLDER_MIME } from "@/types";

const folder = { id: "folder", name: "Music", mimeType: FOLDER_MIME };
const track = { id: "track", name: "Track.mp3", mimeType: "audio/mpeg" };
let events: RootOperation[][];
function changed(event: Event) {
  events.push((event as CustomEvent<RootOperation[]>).detail);
}
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  events = [];
  window.addEventListener("drivebeats-portable-roots", changed);
});
afterEach(() => {
  window.removeEventListener("drivebeats-portable-roots", changed);
});

it("hydrates remote selections without writing commands and retains unavailable descriptors", async () => {
  const { useImportedDriveStore } = await import("./imported-drive-store");
  useImportedDriveStore.getState().bindAccount("account", "generation");
  useImportedDriveStore.getState().hydrateRemoteRoots([folder, track]);
  expect(events).toEqual([]);
  expect(useImportedDriveStore.getState().rootFolders).toEqual([folder]);
  expect(useImportedDriveStore.getState().rootFiles).toEqual([track]);
});

it("emits only deliberate adds/removals, including Standalone Track removal", async () => {
  const { useImportedDriveStore } = await import("./imported-drive-store");
  const state = useImportedDriveStore.getState();
  state.upsertItems([folder, track]);
  state.removeRootFolder(folder.id);
  state.removeRootFile(track.id);
  expect(events).toEqual([
    [
      { type: "add", rootKind: "folder", id: folder.id, descriptor: folder },
      { type: "add", rootKind: "track", id: track.id, descriptor: track },
    ],
    [{ type: "remove", rootKind: "folder", id: folder.id }],
    [{ type: "remove", rootKind: "track", id: track.id }],
  ]);
  expect(useImportedDriveStore.getState()).toMatchObject({
    rootFolders: [],
    rootFiles: [],
  });
  state.clear();
  expect(events).toHaveLength(3);
});

it("preserves same-account roots but fences choices from another account or incarnation", async () => {
  const { useImportedDriveStore } = await import("./imported-drive-store");
  const state = useImportedDriveStore.getState();
  state.bindAccount("a", "first");
  state.hydrateRemoteRoots([folder]);
  state.bindAccount("a", "first");
  expect(useImportedDriveStore.getState().rootFolders).toEqual([folder]);
  state.bindAccount("b", "second");
  expect(useImportedDriveStore.getState().rootFolders).toEqual([]);
  state.hydrateRemoteRoots([folder]);
  state.bindAccount("b", "recreated");
  expect(useImportedDriveStore.getState().rootFolders).toEqual([]);
  expect(events).toEqual([]);
});

it("keeps equivalent restored roots and account bindings referentially stable", async () => {
  const { useImportedDriveStore } = await import("./imported-drive-store");
  const richTrack = {
    ...track,
    modifiedTime: "v1",
    size: "123",
    parents: [folder.id],
  };
  useImportedDriveStore.getState().bindAccount("a", "generation");
  useImportedDriveStore.getState().hydrateRemoteRoots([folder, richTrack]);
  const before = useImportedDriveStore.getState();
  const notify = vi.fn();
  const unsubscribe = useImportedDriveStore.subscribe(notify);
  before.bindAccount("a", "generation");
  before.hydrateRemoteRoots([
    structuredClone(folder),
    structuredClone(richTrack),
  ]);
  expect(useImportedDriveStore.getState()).toBe(before);
  expect(notify).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  unsubscribe();
});

it("publishes changed root descriptors while retaining the unaffected root array", async () => {
  const { useImportedDriveStore } = await import("./imported-drive-store");
  useImportedDriveStore
    .getState()
    .hydrateRemoteRoots([
      folder,
      { ...track, modifiedTime: "v1", size: "123" },
    ]);
  const before = useImportedDriveStore.getState();
  const notify = vi.fn();
  const unsubscribe = useImportedDriveStore.subscribe(notify);
  before.hydrateRemoteRoots([
    structuredClone(folder),
    { ...track, modifiedTime: "v2", size: "456" },
  ]);
  expect(useImportedDriveStore.getState().rootFolders).toBe(before.rootFolders);
  expect(useImportedDriveStore.getState().rootFiles).not.toBe(before.rootFiles);
  expect(useImportedDriveStore.getState().rootFiles[0]).toMatchObject({
    modifiedTime: "v2",
    size: "456",
  });
  expect(notify).toHaveBeenCalledOnce();
  expect(events).toEqual([]);
  unsubscribe();
});
