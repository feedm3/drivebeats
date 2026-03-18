import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="overflow-y-auto px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6 text-sm text-muted-foreground">
        <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p>
          <strong className="text-foreground">Last updated:</strong> March 18,
          2026
        </p>

        <h2 className="text-lg font-semibold text-foreground">What we do</h2>
        <p>
          DriveBeats lets you stream audio files (MP3, FLAC, WAV, AAC, OGG)
          stored in your Google Drive. It also lets you sync playlists and
          favorites between devices. It does not upload or re-host your audio
          files on our servers.
        </p>

        <h2 className="text-lg font-semibold text-foreground">
          Google account access
        </h2>
        <p>
          We request Google Drive access through{" "}
          <strong className="text-foreground">Google Picker</strong> and the{" "}
          <strong className="text-foreground">drive.file</strong> scope. This
          limits DriveBeats to the folders and files you explicitly choose in
          the picker. In practice, that means DriveBeats can access your
          imported library, not your entire Drive. We do not modify, delete, or
          share your files. You can revoke access at any time from your{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            Google Account permissions
          </a>
          .
        </p>
        <p>
          We also request <strong className="text-foreground">OpenID</strong>,{" "}
          <strong className="text-foreground">email</strong>, and{" "}
          <strong className="text-foreground">profile</strong> scopes so
          DriveBeats can identify which Google account is signed in and show
          your account name, email address, and avatar inside the app.
        </p>

        <h2 className="text-lg font-semibold text-foreground">
          Cookies and local storage
        </h2>
        <p>
          We store secure HttpOnly cookies for authentication, including a
          refresh token cookie and a signed session cookie, so you can stay
          signed in for up to 30 days. No advertising or cross-site tracking
          cookies are used.
        </p>
        <p>
          We store some app data locally in your browser, including recently
          played tracks, your imported library, offline downloads, and player
          state. Playlists and favorites are also cached locally for faster
          loading, but they are synced to our database so they can follow you
          across devices. When you choose to log out, the app shows a
          confirmation dialog and then deletes that local app data from the
          browser if you confirm.
        </p>
        <p>
          We store playlist and favorite metadata in our Neon-hosted Postgres
          database so those collections can sync between your devices. This
          metadata includes the file ids and display metadata needed to rebuild
          those collections inside the app, including parent folder references.
          We do not upload or copy the audio files themselves into our database.
          Recently played history is not synced and remains on the device where
          it was created.
        </p>
        <p>
          Inside the app, you can delete synced playlists and favorites from the
          Storage &amp; data screen. Logging out clears local device data, but it
          does not delete your synced cloud data unless you explicitly choose
          that delete action.
        </p>

        <h2 className="text-lg font-semibold text-foreground">Analytics</h2>
        <p>
          We use{" "}
          <a
            href="https://vercel.com/docs/analytics"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            Vercel Analytics
          </a>{" "}
          to measure page views and performance. No personal information is
          collected.
        </p>

        <h2 className="text-lg font-semibold text-foreground">Data sharing</h2>
        <p>
          Your Google Drive files are requested directly from Google and stream
          to your browser. We don&apos;t sell your data, share it with data
          brokers, or use it for advertising.
        </p>
        <p>
          Limited data is shared with service providers that operate the app,
          such as Google for authentication, Google Picker, and Drive access,
          Neon for synced playlist and favorite storage, and Vercel for hosting
          and privacy-friendly analytics.
        </p>

        <h2 className="text-lg font-semibold text-foreground">Contact</h2>
        <p>
          Questions? Contact Fabian Dietenberger at{" "}
          <a
            href="https://www.dietenberger.me/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            dietenberger.me
          </a>
          .
        </p>
      </div>
    </div>
  );
}
