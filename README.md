# Google Drive Music Player

A free, open-source web app that lets you stream your music collection
directly from Google Drive. Supports MP3, FLAC, WAV, AAC, and OGG playback,
synced playlists and favorites, and offline downloads without uploading your
audio files.

## Features

- Import folders or audio files from Google Drive with Google Picker
- Browse imported folders in a focused library view
- Stream MP3, FLAC, WAV, AAC, and OGG files directly from Google Drive
- Restore playlists, favorites, imported Library choices and music tags across browsers using hidden Google Drive app data
- Spotify-style player with shuffle, repeat, and seekable progress bar
- Volume control and keyboard shortcuts
- Light and dark mode
- Mobile-friendly, responsive design
- Limited Drive access via `drive.file` — the app only sees items you select

## Control with ChatGPT

Open DriveBeats in ChatGPT's built-in browser and sign in normally. Import
your music through the website, then use Site tools to control the same
Library and player in that browser session. WebMCP registers tools directly
on the website; availability depends on the host's Site tools support.

See [WebMCP browser control](docs/research/webmcp-browser-control.md) for the
verified host requirements and remaining real-browser acceptance checks.

## Tech Stack

- [Next.js](https://nextjs.org) (App Router)
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) v4
- [shadcn/ui](https://ui.shadcn.com) components
- [Zustand](https://zustand.docs.pmnd.rs) for state management
- [Neon](https://neon.com) Postgres for account, authentication and durable synchronization controls
- Google Drive API (OAuth 2.0)

## Getting Started

### Prerequisites

- Node.js 24 (configured in `mise.toml`) and pnpm (pinned by the root
  `package.json` `packageManager` field; mise reads the same version)
- A Google Cloud project with the Drive API enabled
- OAuth 2.0 credentials (Client ID and Client Secret)
- A browser API key for Google Picker

### Environment Variables

Create `apps/drivebeats-web/.env.local`. Next.js loads app environment files
from this directory when you run the root commands:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
AUTH_SESSION_SECRET=replace-me
DATABASE_URL=postgres://...
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_API_KEY=your-browser-api-key
NEXT_PUBLIC_GOOGLE_APP_ID=your-google-cloud-project-number
```

### Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Run these commands from the repository root. The root `dev` and `start`
commands target `@drivebeats/web`; `test`, `lint`, and `build` validate the
web app. Lint also generates Next.js route types and checks TypeScript:

```bash
pnpm test
pnpm lint
pnpm build
```

### Repository Layout

- `apps/drivebeats-web`: Next.js app, routes, public assets, and app configuration
- `apps/drivebeats-web/src`: components, application logic, and domain types
- `db/migrations`: existing SQL migration history, kept at the repository root
- `docs`: operational guides

Install dependencies once from the repository root. The pnpm workspace contains
only the web app and uses one `pnpm-lock.yaml`. Local Vercel credentials
(`mise.local.toml`) and project linkage (`.vercel/`) also remain at the repository
root. Read
[Vercel access](docs/vercel-access.md) before inspecting hosting configuration.

### Production Build

```bash
pnpm build
pnpm start
```

## Deployment

Deploy to [Vercel](https://vercel.com) with the same environment variables
configured in your project settings, plus a Neon Postgres database wired
through `DATABASE_URL`. Set `NEXT_PUBLIC_APP_URL=https://www.drivebeats.app`
for the Production environment. If `NEXT_PUBLIC_APP_URL` is unset, the app
falls back to `https://www.drivebeats.app` for SEO metadata, sitemap, and
robots, but OAuth still requires it to be set correctly.

The web application root is `apps/drivebeats-web`; its Next.js output is `.next`
within that directory. Keep the build settings pointed at this app and install
dependencies from the repository root.

The canonical host is `https://www.drivebeats.app`; configure the apex
`drivebeats.app` to redirect to `www` in the Vercel domain settings, and add
`https://www.drivebeats.app/api/auth/callback` as an authorized redirect URI
in the Google Cloud OAuth client.

## FAQ

### What file formats are supported?

DriveBeats currently supports MP3, FLAC, WAV, AAC, and OGG files from Google Drive.

### Which Google Drive scope does the app use?

DriveBeats requires `https://www.googleapis.com/auth/drive.file` together with Google Picker, plus `https://www.googleapis.com/auth/drive.appdata` for its hidden backup. Users explicitly choose the folders and files they want to share with the app.

### Why would Google ask for permission again?

Normal sign-in lets Google reuse your existing approval. DriveBeats keeps the
Google refresh token encrypted in `google_oauth_grants`, associated with your
verified Google account ID. Logging out removes browser authentication and local
app data while preserving this connection for your next sign-in, including from
another device. Deleting cloud data removes the saved connection with the user
record; removing DriveBeats in your Google Account permissions revokes access.

Google may ask for approval again if access was revoked or expired, or if
DriveBeats no longer has a usable saved token. Existing users must approve the additional app-data scope before normal use. Recovery retries consent
once, then displays an error rather than looping.

Before deploying this flow, apply `db/migrations/0010_google_oauth_grants.sql`.
Tokens use AES-256-GCM with an account binding and a dedicated key derived from
`AUTH_SESSION_SECRET` using HKDF. Keep that secret stable and use a strong random
value. Rotating it invalidates both browser sessions and saved-token encryption;
users then need to approve a new connection. Tokens and audio are never exposed
through site tools; no audio is stored in the database.

## License

Licensed under the [MIT License](LICENSE).

## Google Drive backup and migration

Google sign-in requires both `drive.file` (selected music, strictly read-only)
and `drive.appdata` (DriveBeats-owned hidden data). Normal UI, playback, APIs and
WebMCP stay gated until approval and the once-only playlist/favorite migration
complete. App data passes through authenticated server routes; audio is never
stored in Neon or hidden app data. Device downloads, playback state, history and
the derived Library Search catalog remain local. Pending saves are not portable
until Google acknowledges them; saved unchanged tags restore before extraction.

Account identity, encrypted Google grants and synchronization/deletion controls
remain in Neon. Existing collections migrate once to Drive. The obsolete Neon
music tables have one global cutoff 30 days after verified production rollout;
accounts that miss it recreate playlists/favorites. No rollout date is set by
local implementation. See `docs/research/drive-appdata-handover.md` for rollout gates.
Logout and device clearing preserve remote data. Account deletion fences writers,
deletes and verifies hidden app data, then removes credentials and local data.
Revoked access requires reauthorization before cleanup can be attempted. An
interrupted upload with an unknown outcome can block automatic account deletion;
manual cleanup or provider/operator verification may be required. Account and
encrypted connection records remain until cleanup is verified. Manual Google
hidden-data deletion alone does not settle unknown saves or complete account
deletion. See [the recovery runbook](docs/operations/recover-drive-backup.md)
for the recovery boundary and required evidence.
