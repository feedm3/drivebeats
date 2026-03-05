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
          Google Drive. It does not upload, copy, or store any of your files.
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

        <h2 className="text-lg font-semibold text-foreground">Cookies</h2>
        <p>
          We store a single secure cookie to keep you signed in between visits.
          No tracking cookies are used.
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
          Your data stays between you and Google. We don{"'"}t sell it, share
          it, or give it to anyone.
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
