import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="overflow-y-auto px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6 text-sm text-muted-foreground">
        <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p>
          <strong className="text-foreground">Last updated:</strong> March 5,
          2026
        </p>

        <h2 className="text-lg font-semibold text-foreground">What we do</h2>
        <p>
          Google Drive MP3 Player lets you stream MP3 files stored in your
          Google Drive. It does not upload or re-host your audio files on our
          servers.
        </p>

        <h2 className="text-lg font-semibold text-foreground">
          Google account access
        </h2>
        <p>
          We request <strong className="text-foreground">read-only</strong>{" "}
          access to your Google Drive via OAuth. We can list and stream your
          files — nothing else. We cannot modify, delete, or share them. You can
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
          We also request <strong className="text-foreground">OpenID</strong>,{" "}
          <strong className="text-foreground">email</strong>, and{" "}
          <strong className="text-foreground">profile</strong> scopes so the app
          can identify which Google account is signed in and show your account
          name, email address, and avatar inside the app.
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
          We also store app data locally in your browser, such as playlists,
          favorites, recently played tracks, hidden folders, and player state.
          This data stays on your device and is not sent to our servers. When
          you choose to log out, the app shows a confirmation dialog and then
          deletes that local app data from the browser if you confirm.
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
          to your browser. We don{"'"}t sell your data, share it with data
          brokers, or use it for advertising.
        </p>
        <p>
          Limited data is shared with service providers that operate the app,
          such as Google for authentication and Drive access, and Vercel for
          hosting and privacy-friendly analytics.
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
