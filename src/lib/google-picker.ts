declare global {
  interface Window {
    __drivebeatsGapiScriptLoaded?: boolean;
    __drivebeatsGapiResolve?: () => void;
  }
}

const SCRIPT_WAIT_TIMEOUT_MS = 10_000;

let gapiReadyPromise: Promise<void> | null = null;
let pickerLoadPromise: Promise<void> | null = null;

function getGapiReadyPromise() {
  if (!gapiReadyPromise) {
    if (typeof window === "undefined") {
      return Promise.reject(new Error("Google Picker can only run in the browser"));
    }

    if (window.__drivebeatsGapiScriptLoaded && window.gapi) {
      gapiReadyPromise = Promise.resolve();
    } else {
      gapiReadyPromise = new Promise<void>((resolve, reject) => {
        window.__drivebeatsGapiResolve = resolve;

        // If the script already loaded before we set up the resolve callback
        if (window.__drivebeatsGapiScriptLoaded && window.gapi) {
          resolve();
          return;
        }

        window.setTimeout(() => {
          if (!(window.__drivebeatsGapiScriptLoaded && window.gapi)) {
            reject(new Error("Google API script did not load in time"));
          }
        }, SCRIPT_WAIT_TIMEOUT_MS);
      }).catch((error) => {
        gapiReadyPromise = null;
        throw error;
      });
    }
  }

  return gapiReadyPromise;
}

export async function ensureGooglePickerLoaded() {
  if (!pickerLoadPromise) {
    pickerLoadPromise = getGapiReadyPromise()
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            window.gapi.load("picker", {
              callback: () => resolve(),
              onerror: () => reject(new Error("Failed to load Google Picker")),
            });
          }),
      )
      .catch((error) => {
        pickerLoadPromise = null;
        throw error;
      });
  }

  return pickerLoadPromise;
}

export function getGooglePickerConfig() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;

  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_GOOGLE_API_KEY");
  }

  return {
    apiKey,
    appId: appId || undefined,
  };
}

/**
 * Called by GooglePickerScripts when the GAPI script loads.
 * Resolves the shared promise so ensureGooglePickerLoaded proceeds without polling.
 */
export function notifyGapiScriptLoaded() {
  window.__drivebeatsGapiScriptLoaded = true;
  window.__drivebeatsGapiResolve?.();
}
