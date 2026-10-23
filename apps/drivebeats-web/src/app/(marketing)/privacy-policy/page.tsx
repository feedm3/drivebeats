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
          <strong className="text-foreground">Last updated:</strong> October 23,
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
          imported library, not your entire Drive. Your selected music files
          remain read-only: we never modify, delete or share them. You can
          revoke access at any time from your{" "}
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
          We also require{" "}
          <strong className="text-foreground">drive.appdata</strong> access.
          DriveBeats creates, reads and deletes its own hidden app-data files in
          your Google Drive to save playlists, favorites, Imported Folder and
          Standalone Track choices, and extracted title, artist and album tags.
          This backup uses your Google storage. App-folder approval is required
          to use DriveBeats. These writes never alter your music files.
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
          We also store an encrypted Google refresh token in our database,
          linked to your Google account ID, so future sign-ins can reuse the
          access you already approved. Logging out removes your browser session
          and preserves this connection. Deleting cloud data removes the saved
          connection. You can revoke access at any time in your Google Account
          permissions.
        </p>
        <p>
          Recently played history, downloaded audio, download settings, active
          player state and the derived Library Search catalog stay on this
          device. Your Library choices, music tags, playlists and favorites are
          cached locally and backed up in hidden Google Drive app data. Saved
          unchanged tags restore on another browser before new tag extraction.
          Pending changes have not yet been acknowledged by Google and may be
          lost if this browser is cleared or closed before saving finishes.
        </p>
        <p>
          Hidden app data passes through DriveBeats servers to validate and
          coordinate saves, restore and account deletion. Account identity,
          encrypted Google connection data and durable synchronization and
          deletion controls remain in our Neon-hosted Postgres database. Audio
          files are never saved to Neon or to the hidden backup.
        </p>
        <p>
          Existing playlists and favorites move once from Neon to Google Drive
          after you approve app-folder access. Legacy Neon music tables are
          retained for a fixed 30-day window beginning with the verified
          production rollout. During that window the app shows the exact global
          cutoff in Europe/Berlin. Unmigrated playlists and favorites are
          permanently removed at that cutoff; later sign-ins start with empty
          collections. Account, authentication and synchronization controls
          remain.
        </p>
        <p>
          Logging out clears local device data and preserves the remote backup
          and saved connection. Unsaved playlist, favorite, music tag and
          Library choice changes are lost when you log out; the confirmation
          warns you before clearing them. Removing downloads clears only this
          device. Delete account in Storage &amp; data permanently deletes
          hidden DriveBeats data before removing account credentials and
          clearing this browser. Missing Google access requires reauthorization
          before DriveBeats can attempt cleanup. If an interrupted save has an
          unknown outcome, automatic account deletion may be blocked and need
          manual cleanup or support/provider verification. Your account and
          encrypted Google connection remain stored until cleanup is verified.
          Deleting hidden data through Google Drive Settings → Manage apps →
          DriveBeats → Options does not by itself prove all pending saves have
          stopped or complete account deletion. Revoking access alone does not
          delete hidden data. Your music files remain untouched.
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
          Neon for account, encrypted connection and synchronization controls,
          and temporary legacy playlist and favorite storage, and Vercel for
          hosting and privacy-friendly analytics.
        </p>

        <h2 className="text-lg font-semibold text-foreground">
          AI assistants and site tools
        </h2>
        <p>
          If you choose to use an AI assistant with DriveBeats, WebMCP site
          tools let it search your library, read your saved collections, control
          playback, and update playlists or favorites in the open page. Tool
          results are sent to the AI provider you use, such as OpenAI when using
          ChatGPT. These results can include track filenames and file IDs,
          playlist names and contents, favorite status, sign-in status, and
          playback information such as the current track and position.
        </p>
        <p>
          The site tools do not return audio files, Google authentication
          tokens, or your account name and email address. Your Google Drive
          music files remain read-only. You can use DriveBeats without an AI
          assistant.
        </p>

        <h2 className="text-lg font-semibold text-foreground">Contact</h2>
        <p>
          Questions? Contact Fabian Dietenberger at{" "}
          <a
            href="https://www.dietenberger.me/"
            target="_blank"
            rel="noopener"
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
