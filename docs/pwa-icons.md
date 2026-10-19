# Home Screen icons

The root layout embeds `apps/drivebeats-web/public/apple-icon.png` as a PNG data
URL in one explicit `apple-touch-icon` link. This avoids the separate icon fetch
associated with iOS 27's first-letter fallback. The approach was verified on an
affected iPhone in Kißlegg before being ported here; DriveBeats still needs its
own physical-device acceptance check.

The layout reads the small file once at server module initialization. It remains
available at `/apple-icon.png`, including with old query strings, so cached
documents retain a working image URL. The file-convention image under `src/app`
is removed to prevent Next.js from declaring a competing network-based Apple
icon. Use an explicit link rather than `metadata.icons.apple`: in Next.js
16.4.2, the latter suppresses other file-derived icon links.

The opaque 180×180 PNG uses this app's existing blue cloud/play artwork, resized
from its original Apple icon, flattened onto the dark app background `#0f0f0f`,
and encoded as an indexed PNG. It is 16,544 bytes. Normal favicon assets,
manifest icons, app identity, service workers, authentication and playback are
unchanged. When updating artwork, regenerate the small PNG from the app's master
image; its embedded representation automatically follows the public file.

Inlining trades separate image caching for extra HTML transfer on each full
load. React also carries the link in its server payload, so the compressed page
cost can exceed the compressed PNG size. It adds no image bytes to client
JavaScript. The existing CSP already permits `data:` images. Older iOS and
automatic refresh of previously installed icons are not verified.

For release verification, check that initial HTML has exactly one Apple icon,
its data URL decodes to the public 180×180 PNG, ordinary favicon/manifest links
remain, and the previous public icon URL responds successfully. Inspect server
file traces for the PNG and confirm it is absent from client JavaScript. On an
affected iPhone, reload Safari and check Add to Home Screen before removing an
existing installation.

Release checks for this port: lint/types, 458 tests and the production build
passed. React Doctor reported no issues (97/100). Four unauthenticated HTTP
routes retained three ordinary icon links, the manifest and the existing CSP;
the Apple data URL decoded to the exact public PNG. The app route redirects a
signed-out visitor to the landing page, as before. Both plain and queried old
Apple icon URLs remained available. All five layout-using page traces included
the file and its bytes were absent from client JavaScript. Added gzip HTML was
approximately 19–35 KB, depending on the page. An isolated Chrome check at a
390-pixel viewport decoded the icon to 180×180 with no uncaught page errors.
An independent source review found no actionable issues. Authenticated playback
was outside this icon-only change and was not re-tested.
