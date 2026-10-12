import { useCallback, useSyncExternalStore } from "react";

/**
 * Returns true when the media query matches, or `null` while the viewport is
 * still unknown.
 *
 * The server has no viewport, and React replays the server snapshot during
 * hydration, so any boolean returned there is a guess that is wrong for half
 * the users. Reporting `null` instead lets callers render a layout-agnostic
 * placeholder until the first post-hydration render reads the real viewport,
 * which is what keeps desktop visitors from flashing the mobile layout.
 */
export function useMediaQuery(query: string): boolean | null {
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
      return null;
    }

    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
