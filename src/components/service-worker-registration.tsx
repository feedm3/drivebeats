"use client";

import { useEffect } from "react";

type PlayerModule = typeof import("@/stores/player-store");

const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" } as const;

export interface UpdateReloaderOptions {
  /**
   * Whether this client was already controlled by a service worker when it
   * mounted. Only such a client is running assets that the newly activated
   * worker just pruned from Cache Storage, so only such a client must reload.
   */
  wasControlled: boolean;
  /**
   * Resolves to whether audio is playing *in this client*. Async because the
   * answer may require loading the player module first.
   */
  isPlaybackActive: () => Promise<boolean>;
  reload: () => void;
}

/**
 * Decides whether a `controllerchange` must reload this client, and defers the
 * reload while audio is playing.
 *
 * A new worker's `activate` deletes every shell cache generation except its
 * own, and `clients.claim()` then fires `controllerchange` in *every* already
 * controlled client — not just the one that posted `SKIP_WAITING`. Any client
 * that keeps running the old bundle would fail on the next lazily loaded chunk,
 * because the generation that cached it is gone. So the reload decision is
 * about "was I controlled before the swap", never about "did I ask for it".
 */
export function createUpdateReloader(options: UpdateReloaderOptions) {
  const { isPlaybackActive, reload } = options;

  // Mutable: a first-ever visit starts uncontrolled, but once the initial
  // worker claims it, the page IS controlled and its assets live in that
  // worker's cache generation. If the tab stays open across a later deploy, the
  // next swap must reload it like any other controlled client. Only the very
  // first claim is exempt.
  let isControlled = options.wasControlled;

  let isReloadPending = false;
  let hasReloaded = false;
  let isDeciding = false;
  let recheckRequested = false;

  const decide = async () => {
    if (hasReloaded || !isReloadPending) {
      return;
    }

    // A decision is already in flight awaiting the playback answer. Flag it so
    // that run re-checks instead of settling on a stale answer.
    if (isDeciding) {
      recheckRequested = true;
      return;
    }

    isDeciding = true;
    try {
      do {
        recheckRequested = false;
        const playing = await isPlaybackActive();
        if (hasReloaded || !isReloadPending) {
          return;
        }

        // Never yank a client mid-song. The reload stays pending and runs on
        // the next retry: when playback stops, or when the tab becomes visible
        // again. Until then this client keeps serving from memory, which is why
        // the retry path must never be dropped.
        if (playing) {
          continue;
        }

        hasReloaded = true;
        isReloadPending = false;
        reload();
        return;
      } while (recheckRequested);
    } finally {
      isDeciding = false;
    }
  };

  return {
    /**
     * Synchronous `controllerchange` entry point: the event cannot be awaited,
     * so it only records that a reload is due and hands off to the async
     * decision.
     */
    onControllerChange() {
      // Without a prior controller this is a first install claiming a
      // previously uncontrolled page: nothing it loaded came from a cache the
      // new worker just deleted, so it must not reload. From here on the page
      // is controlled, so any further swap does have to reload it.
      if (!isControlled) {
        isControlled = true;
        return;
      }

      if (hasReloaded) {
        return;
      }

      isReloadPending = true;
      void decide();
    },
    /** Re-evaluates a deferred reload, e.g. once playback stops. */
    retry() {
      void decide();
    },
    get hasPendingReload() {
      return isReloadPending;
    },
    get hasReloaded() {
      return hasReloaded;
    },
  };
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) {
            void registration.unregister();
          }
        })
        .catch((error) => {
          console.error("Failed to unregister service workers:", error);
        });
      return;
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let playerModule: PlayerModule | null = null;
    let unsubscribePlayer: (() => void) | null = null;
    let didRequestSkipWaiting = false;

    const wasControlled = Boolean(navigator.serviceWorker.controller);

    const readPlaybackActive = () => {
      if (!playerModule) {
        return false;
      }

      const { isPlaying, audio } = playerModule.usePlayerStore.getState();
      return isPlaying || Boolean(audio && !audio.paused && !audio.ended);
    };

    // Loaded lazily so the player graph stays out of the root layout bundle.
    const ensurePlayerModule = async () => {
      if (playerModule) {
        return;
      }

      const loaded = await import("@/stores/player-store");
      if (disposed) {
        return;
      }

      playerModule = loaded;
      // Retry deferred work as soon as playback stops.
      unsubscribePlayer ??= loaded.usePlayerStore.subscribe((state) => {
        if (!state.isPlaying) {
          void applyPendingUpdate();
          reloader.retry();
        }
      });
    };

    const isPlaybackActive = async () => {
      try {
        await ensurePlayerModule();
      } catch {
        // The chunk could not be loaded. If the player store were live in this
        // document the dynamic import would have resolved from the module cache
        // without a network request, so a failure means nothing is playing
        // here. Report "idle" and let the reload repair this client, whose
        // chunks are evidently gone.
        return false;
      }

      return readPlaybackActive();
    };

    const reloader = createUpdateReloader({
      wasControlled,
      isPlaybackActive,
      reload: () => {
        window.location.reload();
      },
    });

    const applyPendingUpdate = async () => {
      if (disposed || didRequestSkipWaiting || !registration?.waiting) {
        return;
      }

      try {
        await ensurePlayerModule();
      } catch {
        // The player chunk can be unreachable on a route that never loaded it
        // once a new deployment has replaced it. A store that was never
        // instantiated cannot be playing anything, so treat this as idle and
        // let the update through rather than blocking it forever.
      }

      const waiting = registration?.waiting;
      if (disposed || didRequestSkipWaiting || !waiting) {
        return;
      }

      // Never swap the worker mid-song: the reload below would stop playback.
      // The update stays waiting and is applied when playback stops, when the
      // tab becomes visible again, or on the next page load.
      if (readPlaybackActive()) {
        return;
      }

      didRequestSkipWaiting = true;
      waiting.postMessage(SKIP_WAITING_MESSAGE);
    };

    const onControllerChange = () => {
      reloader.onControllerChange();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // A long-lived installed PWA may never reload, so check for new deploys.
      registration?.update().catch(() => {
        // Update checks fail offline; the next visibility change retries.
      });
      void applyPendingUpdate();
      // Second safety net for a reload deferred by playback, in case the store
      // subscription missed the transition.
      reloader.retry();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    document.addEventListener("visibilitychange", onVisibilityChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((swRegistration) => {
        if (disposed) {
          return;
        }

        registration = swRegistration;
        // A worker may already be waiting from an earlier visit.
        void applyPendingUpdate();

        swRegistration.addEventListener("updatefound", () => {
          const installing = swRegistration.installing;
          if (!installing) {
            return;
          }

          installing.addEventListener("statechange", () => {
            // Without a controller this is the first install, which activates
            // on its own and must not trigger a reload.
            if (
              installing.state !== "installed" ||
              !navigator.serviceWorker.controller
            ) {
              return;
            }

            void applyPendingUpdate();
          });
        });
      })
      .catch((error) => {
        console.error("Failed to register service worker:", error);
      });

    return () => {
      disposed = true;
      unsubscribePlayer?.();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
