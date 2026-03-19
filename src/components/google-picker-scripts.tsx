"use client";

import Script from "next/script";
import { useSyncExternalStore } from "react";
import {
  hasRequestedGooglePickerScript,
  notifyGapiScriptLoaded,
  subscribeToGooglePickerScriptRequest,
} from "@/lib/google-picker";

export function GooglePickerScripts() {
  const shouldLoadScript = useSyncExternalStore(
    subscribeToGooglePickerScriptRequest,
    hasRequestedGooglePickerScript,
    () => false,
  );

  if (!shouldLoadScript) {
    return null;
  }

  return (
    <Script
      id="google-api-js"
      src="https://apis.google.com/js/api.js"
      strategy="afterInteractive"
      onLoad={notifyGapiScriptLoaded}
    />
  );
}
