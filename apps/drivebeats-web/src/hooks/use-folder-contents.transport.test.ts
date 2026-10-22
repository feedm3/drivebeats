import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { downloadGoogleDriveFileMedia } from "@/lib/google-api";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderContents } from "./use-folder-contents";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const setFiles = vi.hoisted(() => vi.fn());
vi.mock("@/stores/folder-cache-store", () => ({
  useFolderCacheStore: { getState: () => ({ setFiles }) },
}));
afterEach(() => {
  useAuthStore.setState({ isLoggingOut: true });
  useAuthStore.setState({ isLoggingOut: false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("publishes an in-flight folder listing when playback arrives, without a false network toast", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  useAuthStore.setState({
    user: {
      id: "folder-playback",
      email: "test@example.test",
      name: null,
      picture: null,
    },
    authStatus: "authenticated",
    getValidAccessToken: async () => "test-token",
  });
  const files = [{ id: "track", name: "Track.mp3", mimeType: "audio/mpeg" }];
  let release!: () => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("alt=media")) return new Response("audio");
    return new Response(
      new ReadableStream({
        start(target) {
          release = () => {
            target.enqueue(new TextEncoder().encode(JSON.stringify({ files })));
            target.close();
          };
          started();
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useFolderContents());
  const listing = result.current.fetchFromApi("folder");
  await reading;
  const playback = downloadGoogleDriveFileMedia(
    "track",
    "test-token",
    undefined,
    { priority: "playback" },
  ).then((response) => response.text());
  release();
  expect(await listing).toEqual(files);
  expect(await playback).toBe("audio");
  expect(setFiles).toHaveBeenCalledWith("folder", files);
  expect(toast.error).not.toHaveBeenCalled();
});
