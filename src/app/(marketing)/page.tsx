import Image from "next/image";
import { SignInButton } from "@/components/sign-in-button";

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center px-4">
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
          Google Drive MP3 Player
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Stream your music collection directly from Google Drive. Build
          playlists across folders, reorder with drag and drop, and pick up
          right where you left off. No uploads, no syncing, no server-side
          proxy.
        </p>
        <SignInButton className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90" />
        <p className="text-xs text-muted-foreground">
          Client-side playback with read-only Drive access. Your MP3 files stay
          between Google and your browser.
        </p>
      </div>

      {/* Features */}
      <section className="w-full max-w-3xl border-t border-border/50 py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Your Drive music, your way
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="text-center">
            <div className="mb-2">
              <svg
                className="mx-auto"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Browse your folders</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Navigate your full Google Drive folder tree and find your MP3s in
              seconds.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <svg
                className="mx-auto"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15V6" />
                <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path d="M12 12H3" />
                <path d="M16 6H3" />
                <path d="M12 18H3" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Cross-folder playlists</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Mix songs from any folder into custom playlists. Drag to add, drag
              to reorder, and everything saves to your browser automatically.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <svg
                className="mx-auto"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Full playback controls</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Shuffle, repeat, volume, seekable progress bar, and keyboard
              shortcuts — everything you&apos;d expect from a music player.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2">
              <svg
                className="mx-auto"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Private and secure</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only access only. Audio streams directly from Google to your
              browser — nothing passes through our servers.
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
              Connect your Google account with read-only access so the app can
              browse and play files directly in your browser.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              2
            </div>
            <h3 className="text-sm font-semibold">Browse</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Navigate your Drive folders and find the music you want to play.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              3
            </div>
            <h3 className="text-sm font-semibold">Play</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Stream your MP3s, build playlists across folders, and control
              playback with shuffle, repeat, and keyboard shortcuts.
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
              Yes, completely free. There are no premium tiers, no ads, and no
              usage limits.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Can you see or modify my files?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              No. We request read-only access to list and stream your files. We
              cannot modify, delete, or share anything in your Drive. You can
              revoke access at any time from your Google Account settings.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              What file formats are supported?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Currently MP3 files are supported. Place them anywhere in your
              Google Drive and browse to them using the folder navigator.
            </p>
          </details>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Do my files get downloaded or stored on your servers?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              No. DriveBeats is client-side for browsing and playback. Your
              files stream from Google Drive to your browser and are not stored
              or re-hosted by us.
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
