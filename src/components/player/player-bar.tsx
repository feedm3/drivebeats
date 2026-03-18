"use client";

import { useEffect, useRef, useState } from "react";
import { AddToPlaylistPopover } from "@/components/add-to-playlist-popover";
import { FavoriteToggleButton } from "@/components/favorite-toggle-button";
import { parseTrackMetadata } from "@/lib/track-metadata";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { PlayControls } from "./play-controls";
import { ProgressBar } from "./progress-bar";
import { TrackInfo } from "./track-info";
import { VolumeControl } from "./volume-control";

function updateMediaSession(title: string, artist: string) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
  });
}

function setupMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;

  ms.setActionHandler("play", () => {
    usePlayerStore.getState().audio?.play();
  });
  ms.setActionHandler("pause", () => {
    usePlayerStore.getState().audio?.pause();
  });
  ms.setActionHandler("previoustrack", () => {
    void usePlayerStore.getState().previous();
  });
  ms.setActionHandler("nexttrack", () => {
    void usePlayerStore.getState().next();
  });
  ms.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) {
      usePlayerStore.getState().seek(details.seekTime);
    }
  });
}

function shouldSuppressErrorToast() {
  return useAuthStore.getState().isLoggingOut;
}

interface PlayerBarProps {
  onNavigateToTrack?: () => void;
}

export function PlayerBar({ onNavigateToTrack }: PlayerBarProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const recentTrackRef = useRef<string | null>(null);
  const restoreAttemptedRef = useRef(false);
  const [playerHydrated, setPlayerHydrated] = useState(() =>
    usePlayerStore.persist.hasHydrated(),
  );
  const trackMetadata = currentTrack
    ? parseTrackMetadata(currentTrack.name, currentTrack.parentFolderName)
    : null;
  const currentTrackTitle = trackMetadata?.title ?? "";
  const currentTrackArtist =
    trackMetadata?.subtitle ?? (currentTrack ? "Google Drive" : "");

  // Audio element event listeners
  useEffect(() => {
    const el = usePlayerStore.getState().initAudio();

    const onTimeUpdate = () => {
      const { currentTrack } = usePlayerStore.getState();
      usePlayerStore.getState().setCurrentTime(el.currentTime);

      if (!currentTrack || recentTrackRef.current === currentTrack.id) return;

      const duration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      const threshold = duration > 0 ? Math.min(10, duration * 0.2) : 10;

      if (el.currentTime >= threshold) {
        useLibraryStore.getState().markPlayed({
          fileId: currentTrack.id,
          fileName: currentTrack.name,
          mimeType: currentTrack.mimeType,
          parents: currentTrack.parents,
        });
        recentTrackRef.current = currentTrack.id;
      }
    };
    const onDurationChange = () =>
      usePlayerStore.getState().setDuration(el.duration || 0);
    const onLoadStart = () => {
      recentTrackRef.current = null;
    };
    const onPlay = () => usePlayerStore.getState().setIsPlaying(true);
    const onPause = () => usePlayerStore.getState().setIsPlaying(false);
    const onEnded = async () => {
      const { repeat, next } = usePlayerStore.getState();
      if (repeat === "one") {
        el.currentTime = 0;
        el.play();
        return;
      }
      await next();
    };
    const onError = async () => {
      const { currentTrack, fetchAndPlay } = usePlayerStore.getState();
      if (!currentTrack) return;

      try {
        await fetchAndPlay(currentTrack.id);
        return;
      } catch {
        // Retry failed, fall through to toast
      }

      import("sonner").then(({ toast }) =>
        shouldSuppressErrorToast()
          ? undefined
          : toast.error(`Failed to play "${currentTrack.name}"`),
      );
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("loadstart", onLoadStart);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    setupMediaSessionHandlers();

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("loadstart", onLoadStart);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      usePlayerStore.getState().clearCache();
    };
  }, []);

  // Update Media Session metadata when track changes
  useEffect(() => {
    updateMediaSession(currentTrackTitle, currentTrackArtist);
  }, [currentTrackTitle, currentTrackArtist]);

  // Wait for persisted player state before attempting a one-time restore.
  useEffect(() => {
    if (playerHydrated) return;

    const unsubscribe = usePlayerStore.persist.onFinishHydration(() => {
      setPlayerHydrated(true);
    });

    return unsubscribe;
  }, [playerHydrated]);

  // Restore the last selected track into the static player after reload.
  useEffect(() => {
    if (!playerHydrated || restoreAttemptedRef.current) return;

    restoreAttemptedRef.current = true;

    const persistedTrack = usePlayerStore.getState().currentTrack;
    if (!persistedTrack) return;

    const restore = async () => {
      try {
        await usePlayerStore.getState().restoreTrack();
      } catch {
        import("sonner").then(({ toast }) =>
          shouldSuppressErrorToast()
            ? undefined
            : toast.error(`Failed to restore "${persistedTrack.name}"`),
        );
      }
    };

    void restore();
  }, [playerHydrated]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const store = usePlayerStore.getState();
      if (!store.currentTrack) return;

      switch (e.key) {
        case " ": {
          e.preventDefault();
          store.togglePlay();
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          store.seek(Math.max(0, store.currentTime - 5));
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          store.seek(Math.min(store.duration, store.currentTime + 5));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          store.setVolume(Math.min(1, store.volume + 0.05));
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          store.setVolume(Math.max(0, store.volume - 0.05));
          break;
        }
        case "m":
        case "M": {
          store.toggleMute();
          break;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!currentTrack) return null;

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-300 fixed inset-x-0 bottom-0 z-50 border-t border-border/50 bg-background/95 shadow-[0_-2px_10px_rgba(0,0,0,0.18)] backdrop-blur supports-[backdrop-filter]:bg-background/80 standalone:pb-[env(safe-area-inset-bottom,0px)]">
      <div className="mx-auto max-w-[1440px] px-4">
        <div className="pt-3">
          <ProgressBar />
        </div>
        <div className="flex items-center gap-1 py-3 sm:hidden">
          <TrackInfo onNavigateToTrack={onNavigateToTrack} />
          <div className="flex shrink-0 items-center gap-1">
            <FavoriteToggleButton
              fileId={currentTrack.id}
              fileName={currentTrack.name}
              mimeType={currentTrack.mimeType}
              parents={currentTrack.parents}
              size="icon-sm"
              className="text-muted-foreground/80"
            />
            <AddToPlaylistPopover file={currentTrack} />
          </div>
        </div>
        <div className="relative flex items-center justify-center pb-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:py-3">
          <div className="hidden sm:block">
            <TrackInfo onNavigateToTrack={onNavigateToTrack} />
          </div>
          <PlayControls />
          <div className="absolute right-0 sm:static standalone:hidden">
            <div className="flex items-center justify-end gap-1">
              <FavoriteToggleButton
                fileId={currentTrack.id}
                fileName={currentTrack.name}
                mimeType={currentTrack.mimeType}
                parents={currentTrack.parents}
                size="icon-sm"
                className="hidden text-muted-foreground/80 sm:inline-flex"
              />
              <AddToPlaylistPopover
                file={currentTrack}
                className="hidden sm:inline-flex"
              />
              <VolumeControl />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
