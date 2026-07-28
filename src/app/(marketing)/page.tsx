import {
  ArrowRight,
  Check,
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
import { LandingFaqItem } from "@/components/landing-faq-item";
import { SignInButton } from "@/components/sign-in-button";

export const metadata: Metadata = {
  title: {
    absolute: "DriveBeats - Google Drive Music Player",
  },
  description:
    "Stream MP3, FLAC, WAV, AAC, and OGG files from Google Drive, keep playlists and favorites synced across devices, and download music for offline playback.",
};

// One primary button treatment for the whole page: hero and closing CTA must
// look identical.
const primaryCtaClass =
  "inline-flex h-12 items-center justify-center rounded-md bg-primary px-7 text-base font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// The screenshot PNGs already carry their own window chrome, rounded corners,
// and drop shadow, so no outline or radius is added here — one would just draw
// a rectangle around the transparent padding.
const screenshotClass = "h-auto w-full";

const steps = [
  {
    n: 1,
    title: "Sign in",
    desc: "Connect your Google account. DriveBeats never sees your password.",
  },
  {
    n: 2,
    title: "Pick your library",
    desc: "Choose folders or audio files from your Drive to add to your library.",
  },
  {
    n: 3,
    title: "Play",
    desc: "Stream, build playlists, and favorite tracks. Everything syncs so it's ready on your next device.",
  },
];

const features = [
  {
    icon: Heart,
    title: "Favorites that follow you",
    description:
      "Heart a song on one device, find it in your Favorites on every other.",
  },
  {
    icon: Download,
    title: "Offline playback",
    description:
      "Download playlists and favorites so you can keep listening on a plane, on your commute, or anywhere without a connection.",
  },
  {
    icon: FolderOpen,
    title: "Import only what you want",
    description:
      "Pick specific folders or audio files for a clean library view. Nothing else is touched.",
  },
  {
    icon: ListMusic,
    title: "Playlists from any folder",
    description:
      "Combine songs from different folders into playlists. Drag to reorder, pick them up on any device.",
  },
  {
    icon: Play,
    title: "A real music player",
    description:
      "Shuffle, repeat, progress bar, and keyboard shortcuts. Works the same whether you're streaming or playing downloaded tracks.",
  },
  {
    icon: Lock,
    title: "Private by design",
    description:
      "No full-Drive access. Your listening history, imported library, and offline downloads never leave your browser.",
  },
];

const showcase = [
  {
    title: "Favorites on every device",
    description:
      "Heart a track on one device, find it waiting on every other. Your library stays in sync, wherever you listen.",
    image: {
      src: "/screenshots/2026-04-21-favorites.png",
      alt: "DriveBeats library view with a Favorites collection, folder tree sidebar, and the bottom player bar",
    },
  },
  {
    title: "Just the folders you pick",
    description:
      "Import what you want. No full-Drive access, no clutter — only the albums and folders you choose to bring in.",
    image: {
      src: "/screenshots/2026-04-21-music-folder.png",
      alt: "Browsing an imported album folder in DriveBeats showing track filenames and sizes",
    },
  },
  {
    title: "Your data, your rules",
    description:
      "Clear downloads, delete synced cloud data, or remove your account — anytime, without leaving the app.",
    image: {
      src: "/screenshots/2026-04-21-storage-and-data.png",
      alt: "DriveBeats Storage and data dialog showing device downloads, sync counts, and delete controls",
    },
  },
];

const trustPoints = [
  "Free forever",
  "Under a minute setup",
  "Only the Drive files you choose",
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)]"
        />
        <div className="pt-10 pb-20 md:pt-16 md:pb-28">
          <div className="mx-auto w-full max-w-6xl px-4">
            <div className="mx-auto w-full max-w-2xl">
              <Suspense fallback={null}>
                <AuthErrorNotice />
              </Suspense>
            </div>
            <div className="flex flex-col items-center gap-8 pt-10 text-center md:pt-14">
              <div className="flex flex-col items-center gap-5">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 py-1 pr-3 pl-1 text-sm font-medium text-muted-foreground">
                  <Image
                    src="/web-app-manifest-192x192.png"
                    alt=""
                    width={16}
                    height={16}
                    className="rounded-sm"
                    aria-hidden="true"
                  />
                  Google Drive music player
                </span>
                <h1 className="max-w-[24ch] text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
                  Play your Google Drive music on any device
                </h1>
                <p className="max-w-[48ch] text-pretty text-lg text-muted-foreground md:text-xl">
                  Pick the folders you want, stream your MP3s, FLACs, and more.
                  Keep playlists and favorites in sync across all your devices.
                  Download tracks for offline playback.
                </p>
              </div>
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <SignInButton className={primaryCtaClass} />
                <a
                  href="#how-it-works"
                  className="inline-flex h-12 items-center justify-center gap-1.5 rounded-md px-4 text-base font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  See how it works
                  <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                </a>
              </div>
              <ul
                // biome-ignore lint/a11y/noRedundantRoles: Tailwind Preflight sets list-style:none, which makes Safari/VoiceOver drop list semantics — the role puts them back
                role="list"
                className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground"
              >
                {trustPoints.map((point) => (
                  <li key={point} className="inline-flex items-center gap-1.5">
                    <Check
                      className="size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Hero screenshot */}
            <div className="mx-auto mt-14 w-full max-w-5xl md:mt-20">
              <Image
                src="/screenshots/2026-04-21-favorites.png"
                alt="DriveBeats app showing a Favorites view with folder sidebar and player bar"
                width={2526}
                height={1942}
                className={screenshotClass}
                priority
                sizes="(min-width: 1024px) 1024px, 100vw"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t border-border/50 bg-muted/40 py-20 md:py-28"
      >
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="mb-14">
            <h2 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              How it works
            </h2>
            <p className="mt-4 max-w-[48ch] text-pretty text-lg text-muted-foreground">
              Three steps. No app store, no uploads, no setup headaches.
            </p>
          </div>
          {/* biome-ignore lint/a11y/noRedundantRoles: restores list semantics stripped by Preflight */}
          <ol role="list" className="grid gap-8 sm:grid-cols-3 md:gap-12">
            {steps.map((step, i) => (
              <li key={step.n} className="relative flex flex-col gap-4">
                {/* Connector from this step's marker to the next one. The
                    negative right inset carries it across the column gap, so it
                    has to track the gap value. Not drawn after the last step,
                    or when the columns stack. */}
                {i < steps.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="absolute top-6 -right-8 left-12 hidden border-t border-dashed border-border sm:block md:-right-12"
                  />
                )}
                <div className="relative z-10 flex size-12 items-center justify-center rounded-full bg-primary text-lg font-semibold tabular-nums text-primary-foreground ring-4 ring-background">
                  {step.n}
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="max-w-[32ch] text-pretty text-base text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* See it in action */}
      <section className="border-t border-border/50 py-20 md:py-28">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="mb-14 md:mb-20">
            <h2 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              See it in action
            </h2>
            <p className="mt-4 max-w-[48ch] text-pretty text-lg text-muted-foreground">
              A quick look at the library, the folders you import, and the data
              controls you keep.
            </p>
          </div>
          <div className="flex flex-col gap-16 md:gap-24">
            {showcase.map((item, i) => (
              <div
                key={item.title}
                className={`grid items-center gap-8 md:grid-cols-2 md:gap-12 ${
                  i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <h3 className="max-w-[40ch] text-balance text-2xl font-semibold tracking-tight md:text-3xl">
                    {item.title}
                  </h3>
                  <p className="mt-4 max-w-[56ch] text-pretty text-base text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <Image
                  src={item.image.src}
                  alt={item.image.alt}
                  width={2526}
                  height={1942}
                  className={screenshotClass}
                  sizes="(min-width: 768px) 50vw, 100vw"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/50 bg-muted/40 py-20 md:py-28">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="mb-14">
            <h2 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Your Drive music, your way
            </h2>
            <p className="mt-4 max-w-[48ch] text-pretty text-lg text-muted-foreground">
              Everything you expect from a modern music player — nothing you
              don&apos;t.
            </p>
          </div>
          <dl className="grid gap-8 sm:grid-cols-2 md:gap-12 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="flex flex-col gap-3">
                  <Icon
                    className="size-6 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1.5">
                    <dt className="text-lg font-semibold">{feature.title}</dt>
                    <dd className="max-w-[56ch] text-pretty text-base text-muted-foreground">
                      {feature.description}
                    </dd>
                  </div>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border/50 py-20 md:py-28">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="mb-12">
            <h2 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Frequently asked questions
            </h2>
          </div>
          <div className="flex max-w-3xl flex-col gap-3">
            <LandingFaqItem question="How does signing up work?">
              Click &ldquo;Sign in with Google&rdquo; and you&rsquo;ll be taken
              to Google&rsquo;s sign-in and consent screen, where you choose
              which account to use. After that, you&rsquo;re sent back to
              DriveBeats and can pick the folders or audio files you want to use
              with Google Picker. DriveBeats never sees your Google password,
              and you can remove access at any time from your Google Account
              settings.
            </LandingFaqItem>
            <LandingFaqItem question="What permissions does DriveBeats need?">
              DriveBeats requests the Google Drive{" "}
              <code translate="no">drive.file</code> scope, which is limited to
              the folders and audio files you explicitly choose with Google
              Picker, not your entire Drive. It also uses basic sign-in info
              (your name, email, and profile picture) to identify your account
              within the app.
            </LandingFaqItem>
            <LandingFaqItem question="Can you see or modify my files?">
              DriveBeats is built to read and play the files you choose. It does
              not upload, edit, rename, move, or delete your Drive files. Access
              is limited to the items you select with Google Picker, rather than
              your entire Drive.
            </LandingFaqItem>
            <LandingFaqItem question="Do my files get downloaded or stored on your servers?">
              Not on our servers. DriveBeats streams your audio from Google
              Drive in your browser, and if you choose offline playback, the
              downloaded tracks are stored locally in your browser on this
              device. Only playlist and favorite metadata is synced so those
              collections can follow you across devices.
            </LandingFaqItem>
            <LandingFaqItem question="Where is my DriveBeats data stored?">
              Playlists and favorites sync to your DriveBeats account so they
              can follow you across devices. Recently played tracks, imported
              items, player state, and offline downloads stay local to this
              browser. DriveBeats does not write any of this app data back to
              your Google Drive.
            </LandingFaqItem>
            <LandingFaqItem question="Can I delete my synced data?">
              Yes. Open Storage &amp; data in the app to delete synced playlists
              and favorites from your account, or clear only the downloads
              stored on this device.
            </LandingFaqItem>
            <LandingFaqItem question="What happens if I log out?">
              Logging out removes your local DriveBeats data from this browser,
              including imported items, recently played tracks, offline
              downloads, and saved player state. Your synced playlists and
              favorites stay in your account unless you delete them from Storage
              &amp; data.
            </LandingFaqItem>
            <LandingFaqItem question="Can I install DriveBeats as an app on my phone or computer?">
              Yes. DriveBeats is a Progressive Web App, so you can add it to
              your home screen on Android, iOS, or your desktop from your
              browser menu. It works offline and doesn&apos;t require an app
              store download.
            </LandingFaqItem>
            <LandingFaqItem question="How do I remove access?">
              Visit your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Google Account permissions
              </a>{" "}
              page and revoke access for DriveBeats.
            </LandingFaqItem>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border/50 bg-muted/40 py-20 md:py-28">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-card px-6 py-12 text-center md:px-12 md:py-16">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_70%)]"
            />
            <div className="relative flex flex-col items-center gap-8">
              <div className="flex flex-col items-center gap-4">
                <h2 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
                  Your music, on every device, for free
                </h2>
                <p className="max-w-[48ch] text-pretty text-lg text-muted-foreground">
                  Stream from Google Drive, keep playlists and favorites in
                  sync, and listen offline.
                </p>
              </div>
              <SignInButton className={primaryCtaClass} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
