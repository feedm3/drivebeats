"use client";

import { useEffect } from "react";

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

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Failed to register service worker:", error);
    });
  }, []);

  return null;
}
