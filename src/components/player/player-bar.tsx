"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAuthStore } from "@/stores/auth-store";
import { TrackInfo } from "./track-info";
import { PlayControls } from "./play-controls";
import { ProgressBar } from "./progress-bar";
import { VolumeControl } from "./volume-control";

function updateMediaSession(title: string) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: "Google Drive",
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
  ms.setActionHandler("previoustrack", async () => {
    const token = await useAuthStore.getState().getValidAccessToken();
    if (token) usePlayerStore.getState().previous(token);
  });
  ms.setActionHandler("nexttrack", async () => {
    const token = await useAuthStore.getState().getValidAccessToken();
    if (token) usePlayerStore.getState().next(token);
  });
  ms.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) {
      usePlayerStore.getState().seek(details.seekTime);
    }
  });
}

export function PlayerBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  // Audio element event listeners
  useEffect(() => {
    const el = usePlayerStore.getState().initAudio();

    const onTimeUpdate = () =>
      usePlayerStore.getState().setCurrentTime(el.currentTime);
    const onDurationChange = () =>
      usePlayerStore.getState().setDuration(el.duration || 0);
    const onPlay = () => usePlayerStore.getState().setIsPlaying(true);
    const onPause = () => usePlayerStore.getState().setIsPlaying(false);
    const onEnded = async () => {
      const { repeat, next } = usePlayerStore.getState();
      if (repeat === "one") {
        el.currentTime = 0;
        el.play();
        return;
      }
      const token = await useAuthStore.getState().getValidAccessToken();
      if (token) next(token);
    };
    const onError = async () => {
      const { currentTrack, fetchAndPlay } = usePlayerStore.getState();
      if (!currentTrack) return;

      // Try refreshing the token and retrying once
      const freshToken = await useAuthStore.getState().getValidAccessToken();
      if (freshToken) {
        try {
          await fetchAndPlay(currentTrack.id, freshToken);
          return;
        } catch {
          // Retry failed, fall through to toast
        }
      }

      import("sonner").then(({ toast }) =>
        toast.error(`Failed to play "${currentTrack.name}"`),
      );
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    setupMediaSessionHandlers();

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      const { blobUrl } = usePlayerStore.getState();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, []);

  // Update Media Session metadata when track changes
  useEffect(() => {
    if (currentTrack) {
      updateMediaSession(currentTrack.name.replace(/\.mp3$/i, ""));
    }
  }, [currentTrack]);

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
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/50 bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.3)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-4xl px-4">
        <div className="pt-3">
          <ProgressBar />
        </div>
        <div className="grid grid-cols-3 items-center gap-4 py-3">
          <TrackInfo />
          <PlayControls />
          <VolumeControl />
        </div>
      </div>
    </div>
  );
}
