import { useCallback, useSyncExternalStore } from "react";

/**
 * Returns true when the media query matches.
 * SSR-safe: returns false on the server and reads the real viewport on the
 * first client render to avoid mobile-first flicker on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined") {
        return () => {};
      }

      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", callback);

      return () => mediaQueryList.removeEventListener("change", callback);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
