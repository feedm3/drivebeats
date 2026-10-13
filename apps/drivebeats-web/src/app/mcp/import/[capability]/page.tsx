import type { Metadata } from "next";
import { McpImportPicker } from "@/components/mcp-import-picker";
import { getMcpMusicImport } from "@/lib/mcp/music-session-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "Import music into ChatGPT",
  robots: { index: false, follow: false },
};
export default async function McpImportPage({
  params,
}: {
  params: Promise<{ capability: string }>;
}) {
  const { capability } = await params;
  const auth = await getServerAuthSession();
  let available = false;
  if (auth && /^[A-Za-z0-9_-]{43}$/.test(capability)) {
    try {
      await getMcpMusicImport(capability, auth.user.id);
      available = true;
    } catch {
      /* Expired or another account. */
    }
  }
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-5 px-5 py-10">
      <p className="text-sm font-medium text-primary">DriveBeats</p>
      <h1 className="text-2xl font-semibold">Import music into ChatGPT</h1>
      {!auth ? (
        <>
          <p>
            Sign in with the Google account connected to DriveBeats in ChatGPT,
            then return to this tab and refresh.
          </p>
          <a
            href="/api/auth/login"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center rounded-lg border px-4"
          >
            Sign in to DriveBeats
          </a>
        </>
      ) : available ? (
        <>
          <p>
            Choose Imported Folders or Standalone Tracks. This selection belongs
            to your ChatGPT player. Google Drive access stays read-only.
          </p>
          <McpImportPicker capability={capability} user={auth.user} />
        </>
      ) : (
        <p>
          This request has expired or belongs to another account. Return to
          DriveBeats in ChatGPT and start Import again.
        </p>
      )}
    </main>
  );
}
