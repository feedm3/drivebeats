import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://driveplayer.app";

export const metadata: Metadata = {
  title: {
    default:
      "Drive Player — Free MP3 Player for Google Drive | Stream Music Online",
    template: "%s | Drive Player",
  },
  description:
    "Free online MP3 player for Google Drive. Stream your music collection directly from Drive — no downloads, no uploads, no storage limits. Spotify-style playback with shuffle, repeat, and full controls.",
  keywords: [
    "google drive mp3 player",
    "free mp3 player google drive",
    "google drive music player",
    "stream music from google drive",
    "play mp3 from google drive",
    "online mp3 player",
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
  authors: [{ name: "Drive Player" }],
  creator: "Drive Player",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Drive Player",
    title: "Drive Player — Free MP3 Player for Google Drive",
    description:
      "Stream your MP3 collection directly from Google Drive. Free, no uploads, Spotify-style controls.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drive Player — Free MP3 Player for Google Drive",
    description:
      "Stream your MP3 collection directly from Google Drive. Free, no uploads, Spotify-style controls.",
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
  applicationName: "Drive Player",
  category: "music",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Drive Player",
    url: siteUrl,
    description:
      "Free online MP3 player for Google Drive. Stream your music collection directly from Drive with Spotify-style controls.",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Stream MP3 files from Google Drive",
      "Shuffle and repeat playback",
      "Browse folders",
      "Volume control",
      "Keyboard shortcuts",
      "No downloads required",
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.add(d?"dark":"light")}catch(e){}})()`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
