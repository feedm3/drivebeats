import type { Metadata } from "next";
import { getMcpConsentSession } from "@/lib/mcp/oauth-service";

export const metadata: Metadata = {
  title: "Connect to ChatGPT",
  robots: { index: false, follow: false },
};

const scopeDescriptions: Record<string, string> = {
  "profile:read":
    "Read your DriveBeats name and email to identify your account.",
  "library:read":
    "Read your imported Library, saved Playlists, favorites and track metadata.",
  "library:write": "Save Playlists and update favorites when you request it.",
  "media:read":
    "Read audio from Playable Tracks you select from your saved music.",
};

export default async function McpConnectPage() {
  let session: Awaited<ReturnType<typeof getMcpConsentSession>> = null;
  try {
    session = await getMcpConsentSession();
  } catch {
    // Configuration errors or stale consent state must not expose credentials.
  }
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-5 py-10">
      <p className="mb-3 text-sm font-medium text-primary">DriveBeats</p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        {session
          ? "Connect DriveBeats to ChatGPT"
          : "Start your connection again"}
      </h1>
      {session ? (
        <>
          <p className="mb-5 text-sm text-muted-foreground">
            Connect as{" "}
            <span className="break-all font-medium text-foreground">
              {session.profile.name || session.profile.email}
            </span>
            {session.profile.name ? (
              <span className="mt-1 block break-all">
                {session.profile.email}
              </span>
            ) : null}
          </p>
          <p className="mb-3 text-sm">Allow DriveBeats in ChatGPT to:</p>
          <ul className="mb-6 list-disc space-y-3 pl-5 text-sm text-muted-foreground">
            {session.scopes.map((scope) => (
              <li key={scope}>
                {scopeDescriptions[scope] ??
                  "Access the requested DriveBeats feature."}
              </li>
            ))}
          </ul>
          <p className="mb-6 text-sm text-muted-foreground">
            Google Drive access is read-only. You can disconnect in DriveBeats
            without deleting your saved Playlists or favorites. Signing out of
            the website keeps this connection active.
          </p>
          <form
            action="/api/mcp/oauth/authorize"
            method="post"
            className="flex flex-wrap gap-3"
          >
            <input type="hidden" name="csrf" value={session.csrf} />
            <button
              type="submit"
              name="decision"
              value="approve"
              className="min-h-11 min-w-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Allow connection
            </button>
            <button
              type="submit"
              name="decision"
              value="cancel"
              className="min-h-11 min-w-11 rounded-lg border border-border px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Cancel
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          This connection request is missing or has expired. Return to ChatGPT
          and connect DriveBeats again.
        </p>
      )}
    </main>
  );
}
