import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Returns true when the media query matches.
 * SSR-safe: always returns false on the server, then syncs on mount.
 */
export function useMediaQuery(query: string): boolean {
  const [mediaQuery, setMediaQuery] = useState<MediaQueryList | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMediaQuery(mql);
  }, [query]);

  return useSyncExternalStore(
    (callback) => {
      if (!mediaQuery) return () => {};
      mediaQuery.addEventListener("change", callback);
      return () => mediaQuery.removeEventListener("change", callback);
    },
    () => mediaQuery?.matches ?? false,
    () => false, // server snapshot
  );
}
