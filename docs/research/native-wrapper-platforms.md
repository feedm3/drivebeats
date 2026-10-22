# Android and iOS wrapper feasibility

Checked 14 October 2026 against current source and official platform documentation. Research only; no app, account, build or remote configuration changed.

## Packaging choices

Capacitor can add Android and iOS projects to an existing JavaScript app. Its normal packaging flow needs compiled web assets with a root `index.html`; the UI remains web UI and plugins expose native capabilities. This makes it a strong candidate for preserving DriveBeats' React components and styling. [Capacitor installation](https://capacitorjs.com/docs/getting-started)

A thin wrapper can technically load the deployed website, but Capacitor explicitly describes `server.url` as a live-reload feature unsuitable for production. It is useful for a proof of concept, not the documented production architecture. [Capacitor configuration](https://capacitorjs.com/docs/config)

For a packaged production client, keep the backend deployed and package a client UI that calls it. A complete Next.js server cannot be copied into a WebView: static exports omit request-dependent route handlers, cookies and other runtime server features. DriveBeats has those features in `src/app/api/auth/*`, plus database-backed routes. Building a client bundle is an adaptation project rather than a config switch. [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)

## Authentication boundary

Google forbids authorization requests in developer-controlled embedded user agents. Its native-app guidance specifically identifies `WKWebView` as a source of `disallowed_useragent` and recommends platform Google Sign-In/AppAuth or supported browser surfaces. The current website's redirects and HttpOnly cookies in `src/app/api/auth/login/route.ts` and `callback/route.ts` therefore need an explicit native login, callback and session handoff. Opening a browser alone does not prove that the WebView acquired the authenticated session. [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies), [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)

Capacitor's Browser plugin uses `SFSafariViewController` on iOS, providing a supported browser surface, but its API is not a complete OAuth/session implementation. Android credentials and return handling must follow Google's current Android guidance; Google documents that custom URI schemes are no longer supported for Android OAuth clients, so an iOS example must not be copied unchanged. [Capacitor Browser](https://capacitorjs.com/docs/apis/browser), [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)

## What improves only with native media work

The current `src/stores/player-store.ts` creates an `Audio` element and downloads response blobs; `src/components/player/player-bar.tsx` integrates the web Media Session API. Wrapping those unchanged preserves the browser implementation. Reliable playback and advancing the Playback Queue while the WebView is suspended need a native playback owner, with UI commands and state bridged to it. That is an engineering inference from the current design and the platform lifecycle APIs, not a measured failure of a built wrapper.

- **iOS:** configure a playback audio session and background audio capability. Native Now Playing metadata supplies Lock Screen and Control Center information; remote-command handlers connect their actions. [Apple playback configuration](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback), [Now Playing](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter), [Remote commands](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter)
- **Android:** put player and media session in a `MediaSessionService` with required foreground-service permissions. It can maintain background playback, notification controls and external-controller access independently of the app UI. [Android background playback](https://developer.android.com/media/media3/session/background-playback)
- **Offline audio:** replace or supplement IndexedDB blobs (`src/lib/offline-db.ts`) with app-managed local files and downloads that the native player can read. Capacitor provides filesystem/file-transfer APIs; integration still needs account isolation, cancellation and cleanup. This preserves Drive's read-only boundary: downloads go to the device. A wrapper alone does not migrate existing browser downloads. [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem)
- **Cars:** Android Auto needs a media browser/library service and car-compatible behavior. CarPlay needs native integration and Apple-approved entitlements. Both are later features, not automatic benefits of installation. [Android car media](https://developer.android.com/training/cars/media), [CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)

## Distribution and estimates

Apple's minimum-functionality guideline requires app value beyond a repackaged website. Native playback and offline support strengthen that case, but approval cannot be promised. Its login rule has an exception for clients whose users sign in to a particular third-party service to access content; DriveBeats plausibly fits because Google Drive content is central. This is an interpretation, not Apple confirmation. [App Review Guidelines, 4.2 and 4.8](https://developer.apple.com/app-store/review/guidelines/)

Expected reuse is highest with Capacitor: retain most React UI, domain logic, and deployed backend; adapt authentication, API origins/session handling, media playback and offline storage. Exact reuse percentages and delivery time are planning estimates, not source facts. A remote-site prototype may take days; a tested production media app on both platforms is a multiweek project, with store review outside engineering control.

Unconfirmed: compatibility of any third-party native audio plugin with the current Capacitor version; actual sign-in/session return; native streaming with Drive authorization; uninterrupted background queue progression; interruptions/Bluetooth; offline storage lifecycle; store approval. Looked at official Capacitor, Next.js, Google OAuth, Apple AVFoundation/Media Player/CarPlay/App Review, and Android Media3/car documentation. No device prototype or signed-in native acceptance was performed.
