import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "DriveBeats | Stream Your Music Collection from Google Drive",
    template: "%s | DriveBeats",
  },
  description:
    "Free music player for Google Drive. Stream MP3, FLAC, WAV, AAC, and OGG files, sync playlists and favorites across devices, and download tracks for offline playback.",
  keywords: [
    "google drive mp3 player",
    "google drive flac player",
    "google drive wav player",
    "google drive aac player",
    "google drive ogg player",
    "free mp3 player google drive",
    "free flac player google drive",
    "google drive music player",
    "stream music from google drive",
    "play mp3 from google drive",
    "play flac from google drive",
    "online mp3 player",
    "online flac player",
    "google drive audio player",
    "free music player online",
    "cloud mp3 player",
    "google drive streaming",
    "play music google drive",
    "mp3 player web app",
    "google drive media player",
    "browser mp3 player",
    "listen to music google drive",
  ],
  authors: [{ name: "DriveBeats" }],
  creator: "DriveBeats",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "DriveBeats",
    title: "DriveBeats | Stream Your Music Collection from Google Drive",
    description:
      "Free music player for Google Drive. Stream your collection, sync playlists and favorites across devices, and listen offline.",
  },
  twitter: {
    card: "summary_large_image",
    title: "DriveBeats | Stream Your Music Collection from Google Drive",
    description:
      "Free music player for Google Drive. Stream your collection, sync playlists and favorites across devices, and listen offline.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  applicationName: "DriveBeats",
  category: "music",
  verification: {
    google: "dGWsSgB_brN-xE3wkcEu5mWwjhYirjf5f6-_xgqncww",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "DriveBeats",
    url: SITE_URL,
    description:
      "Free music player for Google Drive. Stream MP3, FLAC, WAV, AAC, and OGG files, sync playlists and favorites across devices, and download tracks for offline playback.",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Stream MP3, FLAC, WAV, AAC, and OGG files from Google Drive",
      "Cross-device playlist and favorite sync",
      "Offline playback",
      "PWA installable",
      "Shuffle and repeat playback",
      "Browse folders",
      "Keyboard shortcuts",
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/theme-init.js" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ServiceWorkerRegistration />
        <Analytics />
      </body>
    </html>
  );
}
