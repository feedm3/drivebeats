import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  extract: vi.fn(),
  descriptor: vi.fn(),
  range: vi.fn(),
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  loadMetadataCache: async () => ({ records: [], epoch: 0, durable: true }),
  loadMetadataRecord: async () => ({ record: undefined, epoch: 0 }),
  saveMetadataRecord: mocks.save,
  clearMetadataCache: async () => {},
}));
vi.mock("@/lib/id3-metadata", () => ({
  extractId3MetadataResult: mocks.extract,
}));
vi.mock("@/stores/player-store", () => ({
  getAvailablePlaybackBlob: async () => null,
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: mocks.descriptor,
  readGoogleDriveFileRange: mocks.range,
}));
const track = {
  id: "track",
  name: "Track.mp3",
  mimeType: "audio/mpeg",
  modifiedTime: "v2",
  size: "100",
};
const source = () => ({
  accountId: "a",
  fileId: track.id,
  modifiedTime: track.modifiedTime,
  size: track.size,
});
async function setup() {
  const { useAuthStore } = await import("./auth-store");
  useAuthStore.setState({
    user: { id: "a", email: "a@example.test", name: null, picture: null },
    authStatus: "authenticated",
    isLoggingOut: false,
  });
  const { useImportedDriveStore } = await import("./imported-drive-store");
  useImportedDriveStore.setState({ rootFiles: [track], rootFolders: [] });
  const { useId3MetadataStore } = await import("./id3-metadata-store");
  await useId3MetadataStore.getState().setAccount("a");
  return { store: useId3MetadataStore, auth: useAuthStore };
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.save.mockResolvedValue(true);
  mocks.extract.mockResolvedValue({
    status: "ready",
    tags: { title: "Bound local title" },
    loadedVia: "local_blob",
  });
});

it.each([
  undefined,
  { ...source(), modifiedTime: "v1" },
  { ...source(), accountId: "b" },
  { ...source(), fileId: "other" },
])(
  "ignores unproven playback notifications without starting Drive reads: %j",
  async (identity) => {
    const { store } = await setup();
    await store
      .getState()
      .requestMetadata(track.id, new Blob([new Uint8Array(100)]), identity);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
  },
);
it("checks actual Blob size and keeps the source snapshot across async joins", async () => {
  const { store } = await setup();
  await store
    .getState()
    .requestMetadata(track.id, new Blob(["short"]), source());
  expect(mocks.save).not.toHaveBeenCalled();
  const identity = source();
  const work = store
    .getState()
    .requestMetadata(track.id, new Blob([new Uint8Array(100)]), identity);
  identity.modifiedTime = "mutated";
  await work;
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: "a",
      fingerprint: JSON.stringify(["v2", "100"]),
      tags: { title: "Bound local title" },
    }),
    0,
  );
  expect(mocks.descriptor).not.toHaveBeenCalled();
});
it("does not attach an old account's pending notification to the new account", async () => {
  const { store, auth } = await setup();
  const work = store
    .getState()
    .requestMetadata(track.id, new Blob([new Uint8Array(100)]), source());
  auth.setState({
    user: { id: "b", email: "b@example.test", name: null, picture: null },
  });
  await work;
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.descriptor).not.toHaveBeenCalled();
  expect(mocks.range).not.toHaveBeenCalled();
});
