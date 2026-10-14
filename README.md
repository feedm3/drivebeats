# Google Drive Music Player

A free, open-source web app that lets you stream your music collection
directly from Google Drive. Supports MP3, FLAC, WAV, AAC, and OGG playback,
synced playlists and favorites, and offline downloads without uploading your
audio files.

## Features

- Import folders or audio files from Google Drive with Google Picker
- Browse imported folders in a focused library view
- Stream MP3, FLAC, WAV, AAC, and OGG files directly from Google Drive
- Sync playlists and favorites across devices
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
- [Neon](https://neon.com) Postgres for synced playlists and favorites
- Google Drive API (OAuth 2.0)

## Getting Started

### Prerequisites

- Node.js 24 and pnpm 12.7.0 (pinned in `mise.toml`)
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

DriveBeats uses `https://www.googleapis.com/auth/drive.file` together with Google Picker. Users explicitly choose the folders and files they want to share with the app.

## License

Licensed under the [MIT License](LICENSE).
