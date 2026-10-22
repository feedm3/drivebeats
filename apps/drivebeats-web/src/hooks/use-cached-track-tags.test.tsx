import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateCachedTrackTags } from "@/lib/cached-track-tags";
import { useKnownTrackProofStore } from "@/lib/known-track-resolver";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useCachedTrackTags } from "./use-cached-track-tags";

const fixtures = vi.hoisted(() => ({
  auth: {
    authStatus: "authenticated",
    user: { id: "account" },
    isLoggingOut: false,
  },
  known: true,
  read: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => fixtures.auth, subscribe: vi.fn() },
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  loadMetadataCache: async () => ({ records: [], epoch: 0, durable: true }),
  loadMetadataRecord: fixtures.read,
  saveMetadataRecord: async () => true,
  clearMetadataCache: async () => {},
}));
vi.mock("@/lib/known-track-resolver", async () => {
  const { create } = await import("zustand");
  return {
    useKnownTrackProofStore: create(() => ({ revision: 0 })),
    resolveKnownTrack: (accountId: string, id: string) =>
      fixtures.known
        ? {
            accountId,
            track: {
              id,
              name: "Track.mp3",
              mimeType: "audio/mpeg",
              modifiedTime: "v1",
              size: "100",
            },
            scopeKey: "scope",
          }
        : null,
    assertKnownTrack: () => fixtures.known,
  };
});
const track = {
  id: "track",
  name: "Track.mp3",
  mimeType: "audio/mpeg",
  modifiedTime: "v1",
  size: "100",
};

async function seed() {
  await useId3MetadataStore.getState().putRecord(track, {
    status: "ready",
    tags: { title: "Durable title" },
    loadedVia: "local_blob",
  });
  const record = useId3MetadataStore.getState().records.track;
  useId3MetadataStore.setState({ records: {}, cache: {} });
  return record;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  fixtures.read.mockReset();
  fixtures.auth.user.id = "account";
  fixtures.known = true;
  await useId3MetadataStore.getState().setAccount(null);
  await useId3MetadataStore.getState().setAccount("account");
  useKnownTrackProofStore.setState({ revision: 0 });
});
afterEach(cleanup);

describe("local metadata hydration for mounted consumers", () => {
  it("shares one local read across row/player consumers and shows durable tags without network work", async () => {
    const record = await seed();
    let release!: () => void;
    fixtures.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ record, epoch: 0 });
        }),
    );
    const network = vi.spyOn(globalThis, "fetch");
    const first = renderHook(() => useCachedTrackTags(track));
    const second = renderHook(() => useCachedTrackTags(track));
    await waitFor(() => expect(fixtures.read).toHaveBeenCalledOnce());
    await act(async () => release());
    await waitFor(() => {
      expect(first.result.current?.title).toBe("Durable title");
      expect(second.result.current?.title).toBe("Durable title");
    });
    expect(network).not.toHaveBeenCalled();
    // Repeated memory pressure must not create permanent eviction/reload loops.
    act(() => useId3MetadataStore.setState({ records: {}, cache: {} }));
    expect(fixtures.read).toHaveBeenCalledOnce();
  });
  it.each(["account", "generation", "membership"] as const)(
    "does not publish a delayed local read after its %s changes",
    async (change) => {
      const record = await seed();
      let release!: () => void;
      fixtures.read.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ record, epoch: 0 });
          }),
      );
      const pending = hydrateCachedTrackTags(track);
      await waitFor(() => expect(fixtures.read).toHaveBeenCalledOnce());
      if (change === "account") fixtures.auth.user.id = "other";
      else if (change === "generation")
        useId3MetadataStore.setState({
          generation: useId3MetadataStore.getState().generation + 1,
        });
      else fixtures.known = false;
      release();
      await pending;
      expect(useId3MetadataStore.getState().records).toEqual({});
    },
  );
  it("bounds concurrent local reads while eventually hydrating all requested IDs", async () => {
    const template = await seed();
    const releases: (() => void)[] = [];
    fixtures.read.mockImplementation(
      (_account: string, fileId: string) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({ record: { ...template, fileId }, epoch: 0 }),
          );
        }),
    );
    const pending = Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        hydrateCachedTrackTags({ ...track, id: `track-${index}` }),
      ),
    );
    await waitFor(() => expect(fixtures.read).toHaveBeenCalledTimes(32));
    for (const release of releases.splice(0)) release();
    await waitFor(() => expect(fixtures.read).toHaveBeenCalledTimes(40));
    for (const release of releases.splice(0)) release();
    await pending;
    expect(Object.keys(useId3MetadataStore.getState().records)).toHaveLength(
      40,
    );
  });
});
