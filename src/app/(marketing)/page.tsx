import {
  Download,
  FolderOpen,
  Heart,
  ListMusic,
  Lock,
  Play,
} from "lucide-react";
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
    "Stream MP3, FLAC, WAV, AAC, and OGG files from Google Drive, keep playlists and favorites synced across devices, and download music for offline playback.",
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
          Play your Google Drive music on any device
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Pick the folders you want, stream your MP3s, FLACs, and more. Keep
          playlists and favorites in sync across all your devices. Download
          tracks for offline playback.
        </p>
        <SignInButton className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90" />
        <p className="text-xs text-muted-foreground">
          Free forever. Set up in under a minute.
        </p>
        <p className="text-xs text-muted-foreground">
          DriveBeats only accesses the Drive files you choose.
        </p>
      </div>

      {/* How it works */}
      <section className="w-full max-w-3xl py-12">
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
              Connect your Google account. DriveBeats never sees your password.
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
              Stream, build playlists, and favorite tracks. Everything syncs so
              it&apos;s ready on your next device.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="w-full max-w-3xl border-t border-border/50 py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Your Drive music, your way
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="text-center">
            <div className="mb-2">
              <Heart className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Favorites that follow you</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Heart a song on one device, find it in your Favorites on every
              other.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Download className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Offline playback</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Download playlists and favorites so you can keep listening on a
              plane, on your commute, or anywhere without a connection.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <FolderOpen className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Import only what you want</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick specific folders or audio files for a clean library view.
              Nothing else is touched.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <ListMusic className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Playlists from any folder</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Combine songs from different folders into playlists. Drag to
              reorder, pick them up on any device.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Play className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">A real music player</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Shuffle, repeat, progress bar, and keyboard shortcuts. Works the
              same whether you&apos;re streaming or playing downloaded tracks.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <Lock className="mx-auto size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold">Private by design</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              No full-Drive access. Your listening history, imported library,
              and offline downloads never leave your browser.
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
              What permissions does DriveBeats need?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              DriveBeats requests the Google Drive{" "}
              <code>drive.file</code> scope, which is limited to the folders and
              audio files you explicitly choose with Google Picker, not your
              entire Drive. It also uses basic sign-in info (your name, email,
              and profile picture) to identify your account within the app.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can you see or modify my files?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              DriveBeats is built to read and play the files you choose. It does
              not upload, edit, rename, move, or delete your Drive files. Access
              is limited to the items you select with Google Picker, rather than
              your entire Drive.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Do my files get downloaded or stored on your servers?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Not on our servers. DriveBeats streams your audio from Google
              Drive in your browser, and if you choose offline playback, the
              downloaded tracks are stored locally in your browser on this
              device. Only playlist and favorite metadata is synced so those
              collections can follow you across devices.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Where is my DriveBeats data stored?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Playlists and favorites sync to your DriveBeats account so they
              can follow you across devices. Recently played tracks, imported
              items, player state, and offline downloads stay local to this
              browser. DriveBeats does not write any of this app data back to
              your Google Drive.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can I delete my synced data?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Yes. Open Storage &amp; data in the app to delete synced playlists
              and favorites from your account, or clear only the downloads
              stored on this device.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What happens if I log out?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Logging out removes your local DriveBeats data from this browser,
              including imported items, recently played tracks, offline
              downloads, and saved player state. Your synced playlists and
              favorites stay in your account unless you delete them from Storage
              &amp; data.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can I install DriveBeats as an app on my phone or computer?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Yes. DriveBeats is a Progressive Web App, so you can add it to
              your home screen on Android, iOS, or your desktop from your
              browser menu. It works offline and doesn&apos;t require an app
              store download.
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
        <h2 className="mb-2 text-2xl font-semibold">
          Your music, on every device, for free
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Stream from Google Drive, keep playlists and favorites in sync, and
          listen offline.
        </p>
        <SignInButton className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90" />
      </section>
    </div>
  );
}
