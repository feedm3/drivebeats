# Google Drive MP3 Player

A free, open-source web app that lets you stream your MP3 collection directly from Google Drive. No downloads, no uploads, no syncing needed.

## Features

- Browse your Google Drive folder structure
- Stream MP3 files directly from Google Drive
- Spotify-style player with shuffle, repeat, and seekable progress bar
- Volume control and keyboard shortcuts
- Light and dark mode
- Mobile-friendly, responsive design
- Read-only access — your files never leave Google's servers

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

### Environment Variables

Create a `.env.local` file:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
NEXT_PUBLIC_VERCEL_URL=localhost:3000
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

Deploy to [Vercel](https://vercel.com) with the same environment variables configured in your project settings. Update `GOOGLE_REDIRECT_URI` and `NEXT_PUBLIC_VERCEL_URL` to match your production domain.

## License

This project is private.
