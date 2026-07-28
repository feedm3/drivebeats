import type { MetadataRoute } from "next";
import { THEME_COLOR_DARK } from "@/lib/theme-color";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DriveBeats",
    short_name: "DriveBeats",
    description:
      "Stream your music collection directly from Google Drive. MP3, FLAC, WAV, AAC, OGG supported. Free, no uploads needed.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    // The manifest only supports a single static color, so it cannot follow the
    // light/dark toggle the way <meta name="theme-color"> does. It is used for
    // the install splash screen and the task-switcher window chrome, where a
    // dark surface is the safer choice: it matches the app icon, and a wrong
    // dark splash reads as intentional while a wrong white splash flashes. The
    // value is the dark `--background` (oklch(0.17 0 0)) so the splash hands off
    // seamlessly to the app in its default (dark-on-most-devices) appearance.
    background_color: THEME_COLOR_DARK,
    theme_color: THEME_COLOR_DARK,
    icons: [
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-1024x1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/web-app-manifest-1024x1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
