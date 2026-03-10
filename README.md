# Google Drive Music Player

A free, open-source web app that lets you stream your music collection directly from Google Drive. Supports MP3 and FLAC playback with no downloads, no uploads, and no syncing needed.

## Features

- Import folders or audio files from Google Drive with Google Picker
- Browse imported folders in a focused library view
- Stream MP3 and FLAC files directly from Google Drive
- Spotify-style player with shuffle, repeat, and seekable progress bar
- Volume control and keyboard shortcuts
- Light and dark mode
- Mobile-friendly, responsive design
- Limited Drive access via `drive.file` — the app only sees items you select

## Tech Stack

- [Next.js](https://nextjs.org) (App Router)
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) v4
- [shadcn/ui](https://ui.shadcn.com) components
- [Zustand](https://zustand.docs.pmnd.rs) for state management
- Google Drive API (OAuth 2.0)

## Getting Started

### Prerequisites

- Node.js 18+
- A Google Cloud project with the Drive API enabled
- OAuth 2.0 credentials (Client ID and Client Secret)
- A browser API key for Google Picker

### Environment Variables

Create a `.env.local` file:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
AUTH_SESSION_SECRET=replace-me
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_API_KEY=your-browser-api-key
NEXT_PUBLIC_GOOGLE_APP_ID=your-google-cloud-project-number
```

### Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

## Deployment

Deploy to [Vercel](https://vercel.com) with the same environment variables configured in your project settings. Update `NEXT_PUBLIC_APP_URL` to match your production domain.

## FAQ

### What file formats are supported?

DriveBeats currently supports MP3 and FLAC files from Google Drive.

### Which Google Drive scope does the app use?

DriveBeats uses `https://www.googleapis.com/auth/drive.file` together with Google Picker. Users explicitly choose the folders and files they want to share with the app.

## License

This project is private.
