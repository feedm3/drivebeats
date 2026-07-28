import { describe, expect, it, vi } from "vitest";
import { createUpdateReloader } from "@/components/service-worker-registration";

// The reloader awaits the playback answer, so let every pending microtask and
// timer callback settle before asserting.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(options: { wasControlled: boolean; isPlaying?: boolean }) {
  const state = { isPlaying: options.isPlaying ?? false };
  const reload = vi.fn();
  const isPlaybackActive = vi.fn(() => Promise.resolve(state.isPlaying));
  const reloader = createUpdateReloader({
    wasControlled: options.wasControlled,
    isPlaybackActive,
    reload,
  });

  return { reloader, reload, isPlaybackActive, state };
}

describe("createUpdateReloader", () => {
  it("reloads a previously controlled client that never requested the swap", async () => {
    // Another tab posted SKIP_WAITING; this one only sees controllerchange.
    const { reloader, reload } = setup({ wasControlled: true });

    reloader.onControllerChange();
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloader.hasReloaded).toBe(true);
    expect(reloader.hasPendingReload).toBe(false);
  });

  it("does not reload on a first install that claims an uncontrolled page", async () => {
    const { reloader, reload, isPlaybackActive } = setup({
      wasControlled: false,
    });

    reloader.onControllerChange();
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(isPlaybackActive).not.toHaveBeenCalled();
    expect(reloader.hasPendingReload).toBe(false);
  });

  it("reloads on a later swap after the first install claimed the page", async () => {
    const { reloader, reload } = setup({ wasControlled: false });

    // First claim: exempt, but the page is controlled from here on.
    reloader.onControllerChange();
    await flush();
    expect(reload).not.toHaveBeenCalled();

    // A deploy later in the same long-lived tab prunes the cache generation
    // this page's bundle came from, so it must reload now.
    reloader.onControllerChange();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("defers a reload while audio plays and runs it once playback stops", async () => {
    const { reloader, reload, state } = setup({
      wasControlled: true,
      isPlaying: true,
    });

    reloader.onControllerChange();
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(reloader.hasPendingReload).toBe(true);

    // Still playing: a retry must not yank the client either.
    reloader.retry();
    await flush();
    expect(reload).not.toHaveBeenCalled();

    state.isPlaying = false;
    reloader.retry();
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloader.hasPendingReload).toBe(false);
  });

  it("re-checks playback that stopped while a decision was in flight", async () => {
    const state = { isPlaying: true };
    const reload = vi.fn();
    const reloader = createUpdateReloader({
      wasControlled: true,
      isPlaybackActive: () => Promise.resolve(state.isPlaying),
      reload,
    });

    reloader.onControllerChange();
    // Playback stops and the retry lands while the first answer is still
    // pending; the in-flight decision must not settle on the stale "playing".
    state.isPlaying = false;
    reloader.retry();
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads at most once no matter how many events arrive", async () => {
    const { reloader, reload } = setup({ wasControlled: true });

    reloader.onControllerChange();
    reloader.onControllerChange();
    await flush();
    reloader.onControllerChange();
    reloader.retry();
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads without a controllerchange, even when retried", async () => {
    const { reloader, reload } = setup({ wasControlled: true });

    reloader.retry();
    await flush();

    expect(reload).not.toHaveBeenCalled();
  });

  it("treats an unavailable playback answer as idle and reloads", async () => {
    // Mirrors a failed dynamic import: the player chunk is gone, which can only
    // happen when the module was never live in this document, so nothing plays.
    const reload = vi.fn();
    const reloader = createUpdateReloader({
      wasControlled: true,
      isPlaybackActive: () => Promise.resolve(false),
      reload,
    });

    reloader.onControllerChange();
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
