"use client";

import Script from "next/script";
import { notifyGapiScriptLoaded } from "@/lib/google-picker";

export function GooglePickerScripts() {
  return (
    <Script
      id="google-api-js"
      src="https://apis.google.com/js/api.js"
      strategy="afterInteractive"
      onLoad={notifyGapiScriptLoaded}
    />
  );
}
