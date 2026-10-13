# MCP account linking

Task 3 adds a separate DriveBeats OAuth grant for ChatGPT. Google identity is
still the verified Google `sub`, so the connection reads the same cloud
Playlists, favorites and ID3 metadata as the website. Google Drive remains
read-only with `drive.file`; imported roots and the full Library stay local.

## Configuration

Configure the web backend, not the browser bundle. Existing `DATABASE_URL`,
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are reused. New variable names:

| Variable | Purpose |
| --- | --- |
| `MCP_AUTH_ISSUER` | Canonical HTTPS backend origin, without a trailing slash. The protected resource is this origin plus `/mcp`. |
| `MCP_CLIENT_ID` | One preconfigured public OAuth client identifier, entered in the private plugin connection. |
| `MCP_CLIENT_REDIRECT_URIS` | Comma-separated exact HTTPS callbacks copied from the host's connection management page, plus the registered desktop callback `http://127.0.0.1:46123/callback` when using the compatible desktop package. No wildcards or other HTTP destinations. |
| `MCP_ACCESS_TOKEN_SIGNING_KEY` | Independent random 32-byte base64url key for DriveBeats access tokens. |
| `MCP_CREDENTIAL_ENCRYPTION_KEY` | Independent random 32-byte base64url key for encrypted Google credentials and linking state. |

Keep both keys server-only. Never paste credentials into chat, tool output,
plugin headers, URLs or client configuration. Access tokens use a 15-minute
lifetime; grants expire after 30 days. Changing the signing key invalidates
issued access tokens. Changing the encryption key requires reconnecting grants
encrypted with the previous key; this prototype does not implement a key ring.

The chosen registration method is a preconfigured public client using
authorization code and PKCE `S256`, with token endpoint authentication `none`.
It does not enable dynamic registration or Client ID Metadata Documents.
The backend advertises issuer identification and returns `iss` with successful
and canceled authorization responses. Current OpenAI guidance describes the
stable callback `https://chatgpt.com/connector_platform_oauth_redirect` for this
mode; use the exact callback displayed by the actual connection instead of
assuming it. [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

The installed desktop CLI `0.162.0-alpha.17.2` requires the compatible package
described in [the preview plugin guide](../../plugins/drivebeats-preview/README.md).
Its `.mcp.json` declares the same public client with `oauth.clientId` and a
fixed `oauth.callbackUrl`/`callbackPort`. The loopback callback is permitted
only when explicitly included in the server allowlist; other loopback ports,
paths, queries and ordinary HTTP callbacks are rejected. Only the consent
page's form policy includes the configured callback origin.
[Codex plugin OAuth configuration](https://learn.chatgpt.com/docs/extend/mcp#plugin-provided-mcp-servers).

Add this exact Google authorized redirect URI for the backend origin:
`<MCP_AUTH_ISSUER>/api/mcp/oauth/google`. This is a separate linking callback;
the existing website `/api/auth/callback` remains configured.

The production callback is `https://www.drivebeats.app/api/mcp/oauth/google`.
The current preview callback is
`https://drivebeats-mcp-preview-fabian.vercel.app/api/mcp/oauth/google`.
Both were saved in the existing Google client and verified by reopening it.
Registering the production callback does not deploy or activate production MCP.

## Consent and credentials

The host discovers DriveBeats authorization metadata, requests the resource
and scopes, and opens authorization outside the iframe. DriveBeats verifies
the client, exact callback, resource and PKCE request before Google sign-in.
The connection page offers Continue with Google and a selectable connection
link with Copy link. If the host opens Chrome, copy that link into Firefox
before continuing. The copied URL preserves the host's request; Firefox
creates its own pending browser session. The embedded app cannot obtain the
host's generated authorization URL directly. The landing page permits only its
fixed copy script and sends no referrer to Google.
Google returns identity and read-only authorization; DriveBeats then shows
an explicit connection consent page. Cancel returns an OAuth denial without
creating a linked grant.

Provider refresh credentials are encrypted with `jose` authenticated JWE
before storage. The host receives only a DriveBeats access/refresh grant.
Private tools validate token issuer, audience, expiration, scopes and live
grant ownership on each request. Google access tokens are refreshed on the
server for an authorized read and never returned to the host or model.
Private authentication challenges request the full account baseline so the
installed host's replacement connection can read profile, cloud music and
selected media together. Each tool still enforces its minimum scope. Reconnect
requires explicit consent; existing partial grants are not elevated.
Expired or revoked Google authorization requires reconnecting with consent.

Website logout clears the website's local session/device data. It does not
disconnect the plugin or delete synced cloud data. Plugin Disconnect revokes
that connection and removes its provider credential; it does not sign out the
website or delete Playlists/favorites. Cloud deletion cascades account grant
records with the existing user deletion. No flow writes to Google Drive.

## Selected media boundary

Task 3 authorizes reads only for Playable Tracks already in the linked
account's synced Playlists or favorites. It does not accept an arbitrary Drive
ID as Library membership. Full folder browsing, picker imports and the normal
music player are task 4 work.

The app-only media preparation operation checks account ownership, current
synced membership and live Google metadata. It returns a five-minute,
one-track media capability in result `_meta`, outside model-readable content.
Only its hash is stored. The media endpoint rechecks expiry, account/grant,
scope and current membership on every request, forwards a single valid Range
to Google, and streams the response with `Cache-Control: private, no-store`.
It does not put provider tokens or audio into Neon. Treat capability URLs as
sensitive and avoid recording them in diagnostics.

## Remote activation and acceptance

Local implementation does not apply migrations, change Google/Vercel settings,
publish a plugin release or prove ChatGPT linking. These actions need the
repository's remote-action authorization.

1. Choose the HTTPS deployment origin and exact host client/callback values.
2. Apply the new root migrations in numeric order to the intended database;
   preserve the existing migrations and cloud data.
3. Set the server variables above and configure the new Google callback.
4. Deploy the prepared backend/UI and update the existing private plugin's
   connection to use its preconfigured OAuth client; refresh tool metadata.
5. Link an existing account in actual ChatGPT. Verify profile and existing
   cloud data, consent cancellation, reconnect and a real selected audio read.
6. Reject invalid/expired/wrong-audience tokens and inaccessible/unselected
   tracks. Verify Disconnect invalidates grants/media and preserves cloud data.
7. Verify ordinary website Google sign-in, refresh and logout, and another
   session's synced data. Record actual outcomes in the task 3 execution notes.

The implementation uses the maintained
[@node-oauth/oauth2-server](https://github.com/node-oauth/node-oauth2-server)
authorization-code/PKCE/refresh helper and
[jose](https://github.com/panva/jose) for token signing and encryption. Protocol
requirements were checked against the
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
