"use client";

import { useEffect } from "react";
import { runCloudLibrarySync } from "@/lib/cloud-library-sync-runner";
import { restoreDriveAppData } from "@/lib/drive-appdata-client";
import { useAuthStore } from "@/stores/auth-store";

export function CloudLibrarySync() {
  const authStatus = useAuthStore((state) => state.authStatus);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let cancelled = false;
    // Speaks only for this mount. A sync started here that outlives it is still
    // applied for a remounted `CloudLibrarySync` of the same session; the runner
    // separately refuses to apply a payload once the session itself changed.
    const isCancelled = () => cancelled;

    // The gate restored portable data. Hydrate collections on this mount.
    void runCloudLibrarySync({ force: true, isCancelled });
    let lastPortableRestoreAt = Date.now();

    // `visibilitychange` is the reliable resume signal in an installed PWA;
    // `focus` additionally covers desktop where the user clicks back into the
    // window without the tab ever becoming hidden. Both funnel into one
    // throttled call, so the pair of events a single resume usually fires can no
    // longer start two overlapping syncs.
    const onResume = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void runCloudLibrarySync({ isCancelled });
      if (Date.now() - lastPortableRestoreAt < 60_000) return;
      const accountId = useAuthStore.getState().user?.id;
      if (accountId) {
        lastPortableRestoreAt = Date.now();
        void restoreDriveAppData(accountId).catch(() => undefined);
      }
    };

    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [authStatus]);

  return null;
}
