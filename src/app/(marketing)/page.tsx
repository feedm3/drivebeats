import { Clock, FolderOpen, Heart, ListMusic, Lock, Play } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { AuthErrorNotice } from "@/components/auth-error-notice";
import { SignInButton } from "@/components/sign-in-button";

export const metadata: Metadata = {
  title: {
    absolute: "DriveBeats - Google Drive Music Player",
  },
  description:
    "Stream MP3, FLAC, WAV, AAC, and OGG files from Google Drive with playlists, favorites, and access limited to only the files you choose.",
};

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center px-4">
      <div className="pt-6">
        <Suspense fallback={null}>
          <AuthErrorNotice />
        </Suspense>
      </div>
      {/* Hero */}
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <Image
          src="/web-app-manifest-192x192.png"
          alt="DriveBeats"
          width={64}
          height={64}
          className="mb-2 rounded-2xl"
        />
        <h1 className="max-w-lg text-4xl font-bold tracking-tight">
          Stream your music collection from Google Drive
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Pick your folders, then play them right here. Playlists, favorites,
          full playback controls. No uploads, no syncing, no extra apps.
        </p>
        <SignInButton className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90" />
        <p className="text-xs text-muted-foreground">
          DriveBeats can only access the files you choose. Nothing else in your
          Drive.
        </p>
      </div>

      {/* Features */}
      <section className="w-full max-w-3xl py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Your Drive music, your way
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="text-center">
            <div className="mb-2">
              <Heart className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Quick favorites</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Save tracks as favorites wherever you find them, then open your
              Favorites view to play them back as a quick personal library.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Clock className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">
              Recently played at a glance
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Jump back into the tracks you listened to most recently without
              rebuilding the queue by hand.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <FolderOpen className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Import only what you want</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick specific folders or audio files, then browse them in a
              focused library. The rest of your Drive stays private.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <ListMusic className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Cross-folder playlists</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Mix songs from any folder into custom playlists. Drag to add, drag
              to reorder, and everything saves to your browser automatically.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Play className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Full playback controls</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Shuffle, repeat, volume, seekable progress bar, and keyboard
              shortcuts. Everything you&apos;d expect from a music player.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Lock className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Private by design</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              DriveBeats only sees files and folders you explicitly share. The
              rest of your Drive is never visible.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="w-full max-w-3xl border-t border-border/50 py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          How it works
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              1
            </div>
            <h3 className="text-sm font-semibold">Sign in</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in with Google to get started.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              2
            </div>
            <h3 className="text-sm font-semibold">Pick your library</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose folders or audio files from your Drive to add to your
              library.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              3
            </div>
            <h3 className="text-sm font-semibold">Play</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Stream your MP3, FLAC, WAV, AAC, and OGG files, build playlists
              across folders, and control playback with shuffle, repeat, and
              keyboard shortcuts.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="w-full max-w-3xl border-t border-border/50 py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Frequently asked questions
        </h2>
        <div className="space-y-4">
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Is DriveBeats really free?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Yes. DriveBeats is free to use, with no paid tiers and no ads.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              How does signing up work?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Click &ldquo;Sign in with Google&rdquo; and you&rsquo;ll be taken
              to Google&rsquo;s sign-in and consent screen, where you choose
              which account to use. After that, you&rsquo;re sent back to
              DriveBeats and can pick the folders or audio files you want to use
              with Google Picker. DriveBeats never sees your Google password,
              and you can remove access at any time from your Google Account
              settings.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can you see or modify my files?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              DriveBeats is built to read and play the files you choose. It does
              not upload, edit, rename, move, or delete your Drive files.
              Access is limited to the items you select with Google Picker,
              rather than your entire Drive.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What permissions does DriveBeats need?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              DriveBeats requests{" "}
              <code>https://www.googleapis.com/auth/drive.file</code> so you can
              choose the folders and audio files you want to use without
              granting access to your entire Drive. It also requests{" "}
              <code>openid</code>, <code>userinfo.email</code>, and{" "}
              <code>userinfo.profile</code> so the app can sign you in and show
              your account inside DriveBeats.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Where are my playlists, favorites, and recently played tracks stored?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              They are stored locally in your browser on this device. DriveBeats
              does not write them back to your Google Drive.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What file formats are supported?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              DriveBeats is built for MP3, FLAC, WAV, AAC/M4A, and OGG files.
              You can import individual tracks or folders that contain them.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What happens if I log out?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Logging out removes your local DriveBeats data from this browser,
              including imported items, playlists, favorites, recently played
              tracks, and saved player state. Your files in Google Drive stay
              exactly as they are.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can I use DriveBeats on my phone or tablet?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Yes. DriveBeats works in modern mobile and desktop browsers, so
              you can browse your library and control playback on phones,
              tablets, and computers.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Does DriveBeats work offline?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              No. DriveBeats plays music from Google Drive in your browser, so
              you need an internet connection to load and play tracks.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What happens when I add new songs to an imported folder?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              When you open or refresh that folder in DriveBeats, it loads the
              current contents from Google Drive. Playlists stay the way you set
              them up until you change them.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Do my files get downloaded or stored on your servers?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              No. DriveBeats plays your audio from Google Drive in your browser.
              Your files are not uploaded, copied, or stored on DriveBeats
              servers.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              How do I remove access?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Visit your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Google Account permissions
              </a>{" "}
              page and revoke access for DriveBeats.
            </p>
          </details>
        </div>
      </section>

      {/* Final CTA */}
      <section className="w-full max-w-3xl border-t border-border/50 py-16 text-center">
        <h2 className="mb-4 text-2xl font-semibold">Ready to listen?</h2>
        <SignInButton className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90" />
      </section>
    </div>
  );
}
