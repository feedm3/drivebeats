"use client";

import { useEffect, useState } from "react";

export function OfflineStatusBanner() {
  const [hydrated, setHydrated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setHydrated(true);
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!hydrated || isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-900 dark:text-amber-200"
    >
      Offline mode: downloaded playlists and tracks stay available on this
      device.
    </div>
  );
}
