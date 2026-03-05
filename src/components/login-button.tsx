"use client";

import { Button } from "@/components/ui/button";


export function LoginButton() {
  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4">
      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <h1 className="max-w-lg text-4xl font-bold tracking-tight">
          Google Drive MP3 Player
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Stream your music collection directly from Google Drive — no downloads, no uploads, no syncing needed.
        </p>
        <Button asChild size="lg" className="mt-4">
          <a href="/api/auth/login">Sign in with Google</a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Free to use. We only request read-only access to your Drive.
        </p>
      </div>

      {/* SEO content — features section visible to crawlers and users */}
      <section className="w-full max-w-3xl border-t border-border/50 py-12">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Play your MP3s from Google Drive, instantly
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="text-center">
            <div className="mb-2 text-2xl">
              <svg className="mx-auto" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Browse your folders</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Navigate your Google Drive folder structure and find your MP3 files.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2 text-2xl">
              <svg className="mx-auto" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Spotify-style player</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Shuffle, repeat, volume control, seekable progress bar, and keyboard shortcuts.
            </p>
          </div>
          <div className="text-center">
            <div className="mb-2 text-2xl">
              <svg className="mx-auto" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold">Private and secure</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only access. Your files never leave Google servers. No data stored.
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
