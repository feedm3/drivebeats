import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataRecord } from "@/lib/metadata-cache-types";

const mocks = vi.hoisted(() => ({
  records: new Map<string, MetadataRecord>(),
  blob: vi.fn(),
  extract: vi.fn(),
  descriptor: vi.fn(),
  range: vi.fn(),
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  loadMetadataCache: async (accountId: string) => ({
    records: [...mocks.records.values()].filter(
      (record) => record.accountId === accountId,
    ),
    epoch: 0,
    durable: true,
  }),
  loadMetadataRecord: async (accountId: string, fileId: string) => ({
    record: mocks.records.get(`${accountId}:${fileId}`),
    epoch: 0,
  }),
  saveMetadataRecord: async (record: MetadataRecord) => {
    mocks.records.set(`${record.accountId}:${record.fileId}`, record);
    return true;
  },
  clearMetadataCache: async (accountId: string) => {
    for (const [key, record] of mocks.records)
      if (record.accountId === accountId) mocks.records.delete(key);
  },
}));
vi.mock("@/stores/player-store", () => ({
  getAvailablePlaybackBlob: mocks.blob,
}));
vi.mock("@/lib/id3-metadata", () => ({
  extractId3MetadataResult: mocks.extract,
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: mocks.descriptor,
  readGoogleDriveFileRange: mocks.range,
}));
const track = {
  id: "known",
  name: "track.mp3",
  mimeType: "audio/mpeg",
  modifiedTime: "v1",
  size: "1000",
};
async function signedInData() {
  const { useAuthStore } = await import("@/stores/auth-store");
  useAuthStore.setState({
    authStatus: "authenticated",
    user: { id: "a", email: "a@example.test", name: null, picture: null },
    isLoggingOut: false,
  });
  const { useImportedDriveStore } = await import(
    "@/stores/imported-drive-store"
  );
  useImportedDriveStore.setState({ rootFiles: [track], rootFolders: [] });
  const { useId3MetadataStore } = await import("@/stores/id3-metadata-store");
  await useId3MetadataStore.getState().setAccount("a");
  return useId3MetadataStore;
}
async function reopenOffline() {
  vi.resetModules();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { useId3MetadataStore } = await import("@/stores/id3-metadata-store");
  const { getLocalMetadataAccountId } = await import(
    "@/lib/metadata-local-account"
  );
  if (getLocalMetadataAccountId())
    await useId3MetadataStore
      .getState()
      .setAccount(getLocalMetadataAccountId());
  return useId3MetadataStore;
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.records.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.blob.mockResolvedValue(new Blob(["existing local audio"]));
  mocks.extract.mockResolvedValue({
    status: "ready",
    tags: { title: "From offline audio" },
    loadedVia: "local_blob",
  });
});

describe("cold offline local metadata", () => {
  it("rehydrates the remembered account's tags without a live session or Drive fetch", async () => {
    const first = await signedInData();
    await first.getState().putRecord(track, {
      status: "ready",
      tags: { title: "Persisted title" },
      loadedVia: "local_blob",
    });
    const reopened = await reopenOffline();
    const { useAuthStore } = await import("@/stores/auth-store");
    const { getCachedTrackTags } = await import("@/lib/cached-track-tags");
    expect(useAuthStore.getState().user).toBeNull();
    expect(reopened.getState().accountId).toBe("a");
    expect(getCachedTrackTags(track)).toEqual({ title: "Persisted title" });
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
  });
  it("extracts existing version-matched offline audio through the common loader without authentication", async () => {
    await signedInData();
    await reopenOffline();
    const { resolveKnownTrack } = await import("@/lib/known-track-resolver");
    const { ensureTrackMetadata } = await import("@/lib/track-metadata-loader");
    const known = resolveKnownTrack("a", track.id);
    expect(known).not.toBeNull();
    if (!known) throw new Error("Missing offline scope proof");
    await expect(ensureTrackMetadata(known)).resolves.toMatchObject({
      metadata: { status: "ready", tags: { title: "From offline audio" } },
    });
    expect(mocks.extract).toHaveBeenCalledOnce();
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
  });
  it("cannot reopen tags after an explicit clear/logout, or as a different live account", async () => {
    const store = await signedInData();
    await store.getState().putRecord(track, {
      status: "ready",
      tags: { title: "Private" },
      loadedVia: "local_blob",
    });
    const { useAuthStore } = await import("@/stores/auth-store");
    useAuthStore.setState({
      user: { id: "b", email: "b@example.test", name: null, picture: null },
    });
    await store.getState().setAccount("b");
    const { getCachedTrackTags } = await import("@/lib/cached-track-tags");
    expect(getCachedTrackTags(track)).toBeUndefined();
    await store.getState().clearAll();
    const cold = await reopenOffline();
    expect(cold.getState().accountId).toBeNull();
    const { resolveKnownTrack } = await import("@/lib/known-track-resolver");
    expect(resolveKnownTrack("a", track.id)).toBeNull();
  });
  it("preserves offline local data through auth expiry but seals stale live auth after explicit clear", async () => {
    const store = await signedInData();
    await store.getState().putRecord(track, {
      status: "ready",
      tags: { title: "Retained offline" },
      loadedVia: "local_blob",
    });
    const { useAuthStore } = await import("@/stores/auth-store");
    useAuthStore.getState().clearTokens();
    expect(store.getState().accountId).toBeNull();
    expect(mocks.records.has("a:known")).toBe(true);
    const offline = await reopenOffline();
    expect(offline.getState().cache.known?.title).toBe("Retained offline");
    // Simulates another still-open tab whose local auth has not caught up.
    const { useAuthStore: reopenedAuth } = await import("@/stores/auth-store");
    reopenedAuth.setState({
      authStatus: "authenticated",
      user: { id: "a", email: "a@example.test", name: null, picture: null },
    });
    await offline.getState().clearAll();
    await offline.getState().setAccount("a");
    expect(offline.getState().accountId).toBeNull();
    expect(mocks.records.has("a:known")).toBe(false);
  });
});
