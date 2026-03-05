import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/header";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = `${process.env.NEXT_PUBLIC_APP_URL}`;

export const metadata: Metadata = {
  title: {
    default:
      "Google Drive MP3 Player — Stream Your Music Collection Online for Free",
    template: "%s | Google Drive MP3 Player",
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
  authors: [{ name: "Google Drive MP3 Player" }],
  creator: "Google Drive MP3 Player",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Google Drive MP3 Player",
    title: "Google Drive MP3 Player — Stream Your Music Collection Online for Free",
    description:
      "Stream your MP3 collection directly from Google Drive. Free, no uploads, Spotify-style controls.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Google Drive MP3 Player — Stream Your Music Collection Online for Free",
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
  applicationName: "Google Drive MP3 Player",
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
    name: "Google Drive MP3 Player",
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
    <html lang="en" className="h-dvh overflow-hidden" suppressHydrationWarning>
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
        className={`${geistSans.variable} ${geistMono.variable} flex h-full flex-col antialiased`}
      >
        <Providers>
          <Header />
          <main className="flex-1 overflow-hidden">{children}</main>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
