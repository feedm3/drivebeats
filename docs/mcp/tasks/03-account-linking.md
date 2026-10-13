# Task 3 Account linking

Read [execution context](../context.md) and [task 2 notes](02-basic-mcp-app.md#execution-notes). Requires real ChatGPT UI/tool/audio proof. Scope: same-account access and authorized Drive reads; full browsing/player UX comes in task 4.

## Source and intended flow

Inspect web src/app/api/auth/{login,callback,refresh,logout}/route.ts, src/lib/{google,google-api,auth-session,server-auth,cloud-library-service,cloud-library-validation,playlist-limits}.ts, src/db/{users,client}.ts, and auth tests. Read [OpenAI auth](https://developers.openai.com/plugins/build/auth), [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), and task 2's chosen package contracts.

Current auth validates Google identity, puts Google refresh credentials in a first-party HttpOnly/Secure/SameSite=Lax cookie, and redirects login/callback to /app. It is not an MCP authorization server or reusable backend grant.

User flow: Connect in ChatGPT → DriveBeats authorization page outside iframe → existing Google sign-in → connection consent → return to ChatGPT. Map both frontends to verified Google sub, preserving existing cloud data. Website cookies may shorten login but cannot be the plugin's ongoing auth dependency.

## Deliverables

1. Document and implement the minimal supported OAuth approach: protected-resource/authorization-server discovery, PKCE, safe callbacks, one supported client registration method, scoped credentials and verification. Use maintained auth modules/helpers; no hand-written cryptographic protocol or arbitrary return URLs.
2. ChatGPT gets a DriveBeats grant. Enforce issuer/audience/expiry/scopes and ownership on each private tool. Add a stable-identity profile tool/metadata when supported.
3. Keep Google authorization separate. Implement a secure credential/refresh lifecycle allowing selected music reads without website cookies. Document storage, encryption/secret requirements, expiry/revocation and reconnect consent. Required persisted grant tables use new forward migrations in root db/migrations; preserve the playlist database and local full catalog boundary.
4. Load cloud data through current services/limits. Private read tools and runtime auth challenges must cause real ChatGPT linking UI; retain a useful anonymous shell/sign-in-required state.
5. Provide authenticated UI operations through the host bridge and a scoped media-read mechanism. Refresh/reusable provider credentials never enter tool results, model context, URLs or logs. Bind media/session grants to the same account and selected-file authorization.
6. Preserve ordinary web sign-in/refresh/logout. Plugin disconnect revokes its grant without deleting cloud data. Document website logout versus plugin disconnect behavior.

## Decisions and user input

Choose exact auth helper/provider after inspecting infrastructure and SDK support. Keep Google drive.file and the existing identity provider. New paid/remote providers, Google client configuration, production secrets and remote migrations/config changes require applicable authorization. Prepare concrete code/config instructions with variable names only. Do not silently broaden Google scopes.

## Acceptance and verification

Run root checks and meaningful tests: signed out; bad/expired/wrong-audience token; scope failure; state/PKCE/callback rejection; canceled consent; refresh; revocation; cross-account isolation.

Link an existing account in actual ChatGPT and see its existing data. Perform a real authorized read of selected audio; invalid/unselected/inaccessible files fail usefully. Test reconnect and ordinary website login. Directly injected test tokens alone do not prove account linking. Unavailable credentials/accounts leave corresponding checks unverified.

## Execution notes

Implemented locally on 2026-10-13 with supervised backend, private-tools/media,
and UI subagents, plus peer reviews and supervisor integration checks. Task 2's
existing uncommitted work and the pre-existing glossary edit were preserved.
**Live acceptance remains pending; the task checkbox stays open.** The initial
local implementation made no commit, push or remote changes. The subsequently
authorized rollout is recorded below.

### Deliverable status

| Deliverable | Local implementation | Remaining acceptance |
| --- | --- | --- |
| 1. OAuth approach | Protected-resource/authorization-server discovery, one preconfigured public client, exact callback allowlist, S256 PKCE, resource binding and issuer responses. Maintained `@node-oauth/oauth2-server` 5.3.0 and `jose` 6.2.1. | Configure actual host client/callback and HTTPS issuer; prove linking in ChatGPT. |
| 2. Scoped grant/identity | DriveBeats JWT issuer/audience/expiry/scope verification and persisted grant ownership on every private operation; standard stable `openai/profile` tool. | Link an existing Google identity and compare its actual cloud data. |
| 3. Provider lifecycle | Encrypted server-side Google refresh credentials, nonce/state validation, explicit consent, refresh rotation/replay-family revocation and fixed 30-day grant expiry. Forward migration `0007_mcp_account_linking.sql`. | Apply migration/configuration and exercise real Google consent/refresh/reconnect. |
| 4. Cloud reads/linking challenge | Existing cloud-library service; per-tool OAuth declarations and runtime `mcp/www_authenticate` errors; useful anonymous and unconfigured states. | Actual host linking prompt and authenticated cloud read. |
| 5. UI/media interface | Host-bridge account operations; scoped one-track five-minute capabilities, membership/account checks and Range streaming. Forward migration `0008_mcp_media_grants.sql`. | Actual selected Drive audio read; inaccessible/unselected track rejection with live provider. |
| 6. Website/disconnect | Existing website login/callback/refresh/logout source unchanged. App Disconnect and RFC 7009 revoke invalidate the connection without deleting cloud data. | Real website login/logout, plugin reconnect and cross-session data preservation. |

### Paths and contracts

- Backend: `apps/drivebeats-web/src/lib/mcp/{auth,oauth-service,private-tools,media-service}.ts`, five table modules in `src/db/mcp-*.ts`, and the two root migrations. Shared Neon client remains `src/db/client.ts`; music reads reuse current cloud services.
- Discovery: `GET /.well-known/oauth-authorization-server` and `GET /.well-known/oauth-protected-resource/mcp`. The resource is `<MCP_AUTH_ISSUER>/mcp`. Authorization uses `/api/mcp/oauth/{authorize,google,token,revoke}`; consent is `/mcp/connect`.
- Scopes: `profile:read`, `library:read`, `media:read`. `drivebeats_connect_account` is app-only and requests all three for explicit Connect. `drivebeats_get_profile` uses only `profile:read`, returns standard top-level identity fields, declares an output schema and `_meta["openai/profile"]: true`; identity is the stable verified Google sub, independent of grant ID and email changes.
- `drivebeats_get_cloud_library` returns the existing Playlists/favorites/ID3 metadata payload and `_meta.accountId`; the UI rejects data for another displayed account. `drivebeats_prepare_media` and `drivebeats_disconnect` are app-only. Both public fixture tools remain anonymous; seven tools are discoverable.
- SDK 2.3.1's `registerTool` drops unknown top-level extension fields. The narrow JSON response decorator in `server.ts` mirrors `_meta.securitySchemes` into top-level `securitySchemes` for `tools/list` and `server/discover`; tests and actual local HTTP discovery verify the wire declaration. It retains modern protocol behavior and existing transport headers.
- Client: MCP App `account-bridge.ts`, `account-panel.tsx`, `media-origin.ts`, shared fixture transport and consent page. `bridge.account.connect/refresh/disconnect/prepareMedia(fileId)` are task 4's account/media interface. OAuth credentials stay with the host; the app retains display data only. Media capabilities are returned in `_meta`, held only by the caller, and validated against the independently injected canonical issuer origin and exact media path. There is no autoplay or new shared music player yet.
- The UI resource declares both the exact fixture deployment origin and configured media issuer when they differ. A dedicated server-injected `drivebeats-media-read` JSON script supplies the trusted media origin; tool results cannot replace it. Connect CSP remains empty because account calls use the host bridge.

### Credential lifecycle and configuration

See [account-linking setup](../account-linking.md) for exact variables, callbacks,
activation sequence and behavioral limits. New server variables are
`MCP_AUTH_ISSUER`, `MCP_CLIENT_ID`, `MCP_CLIENT_REDIRECT_URIS`,
`MCP_ACCESS_TOKEN_SIGNING_KEY`, `MCP_CREDENTIAL_ENCRYPTION_KEY`. Existing Google
client and database variables are reused; credentials were never printed or
exported.

The separate Google callback is
`<MCP_AUTH_ISSUER>/api/mcp/oauth/google`; it requires a Google authorized
redirect URI configuration change. Google scopes remain `drive.file` and the
existing identity scopes. Website cookies are not an ongoing plugin dependency.
Google sign-in always requests explicit consent in this prototype rather than
silently importing website authorization.

Pending linking payloads are encrypted in `mcp_link_requests`, expire in ten
minutes and are addressed by an HttpOnly/Secure/SameSite=Lax `__Host-mcp_link`
cookie containing only a UUID. Approval/cancel checks Origin and CSRF and
atomically consumes the request. Authorization codes expire after 120 seconds
and are stored as hashes. Access tokens last 15 minutes; refresh tokens are
hashed, rotate atomically, never outlive their 30-day grant, and revoke the grant
family on sequential or concurrent replay. Expired pending requests are removed
and expired/revoked Google credential ciphertext is cleared when a new valid
link starts. Expired media/code/refresh hash records have no access rights;
periodic retention cleanup remains an operational follow-up.

Disconnect clears the grant's provider ciphertext and rejects future token and
media reads without deleting synced music or logging out the website. Website
logout retains the plugin connection and cloud data. Account cloud deletion
cascades linked grant records with the existing user deletion. No Google Drive
writes were added.

### Verification

| Check | Result |
| --- | --- |
| Root tests | Final `pnpm test` passed: **48 MCP UI + 362 web = 410 tests**, plus core typecheck. |
| Root lint/build | Final `pnpm lint` and `pnpm build` passed. Existing Biome configuration deprecation, broken unrelated skill symlink and oversized logo warnings remain. |
| Security/flow tests | Signed out; invalid/expired/wrong issuer/audience/subject/client/profile; insufficient/escalated scopes; state/callback/PKCE checks; consent approve/cancel/CSRF/replay; refresh rotation and concurrent/sequential replay; RFC 7009 revocation; media account mismatch, expired/revoked grant, unselected/removed membership, inaccessible audio, strict Range and credential hiding. Nonce enforcement was inspected in the reused Google identity verifier, rather than exercised through real sign-in. |
| Local production HTTP | Built Next server with temporary fake issuer/client and ephemeral keys: both discovery documents, all seven tool auth declarations, stable profile marker, anonymous fixtures, full-scope linking challenge, invalid Bearer 401, distinct fixture/issuer CSP, packaged HTML and invalid authorize/resource/media requests passed. These checks made no database/provider calls. |
| Browser | Playwright CLI against compiled production UI in a local simulated MCP host: signed-out Connect, auth-required/canceled retry, linked profile and existing-data-shaped fixture, refresh/disconnect, correct singular counts, sample MP3 decoded to six seconds with advancing time/no media error; same Audio element survives account Disconnect. 320px/428px/1440px had no horizontal overflow; controls at least 44x44px. Rebuilt linked UI had zero warning/error console messages. |
| Consent browser | Actual local `/mcp/connect` displays safe missing/expired-request recovery. Approve/cancel/CSRF are verified by route/component tests; real Google consent is pending. The ordinary local web shell logs missing Vercel Analytics script errors, separate from MCP UI behavior. |
| React Doctor | Full MCP App scan completed with one low-risk maintainability warning for account-panel control-flow complexity; reviewed, no functional issue confirmed. No score/telemetry or dependency supply-chain scan requested. |
| Peer/supervisor review | Verified auth/account/credential boundaries and corrected tool declarations/profile shape, issuer-versus-deployment media origins, cross-account/delayed UI results, grant client binding and concurrent refresh replay. No confirmed important issue remains in the reviewed changes. |
| Preservation | `git diff --check` passed. Prior task 2 and glossary changes retained; web authentication routes and old migrations untouched. |

### Unverified and required next steps

Actual ChatGPT linking, Google consent, real existing-account data, selected
Drive audio, reconnect, website login/refresh/logout and another real session's
data retention were **not verified**. Evidence inspected: current task 2 host
notes, official OpenAI/MCP auth documentation, installed OAuth/SDK contracts,
repository source/tests, built local HTTP responses and simulated-host browser
checks. No direct injected test token or simulated display is claimed as real
account linking. The authorized rollout below records migrations exercised on
a Neon rehearsal branch and applied to the intended main database; this proves
schema readiness, while provider and actual-host acceptance remain separate.

The initial remote activation checklist required authorization: choose the
issuer/deployment, apply
migrations `0007` then `0008`, configure the five MCP variables and Google
callback, deploy the backend/UI, update the existing private plugin connection
to the preconfigured OAuth client, then run the live acceptance checklist in
the setup guide. Host disconnect calling RFC 7009 is client-dependent; the
explicit in-app Disconnect reliably invokes the implemented revocation tool.
Task 4 has not been implemented.

### Authorized rollout, 2026-10-13

The user authorized migrations, OAuth configuration, preview deployment and
private plugin update, then commit/push. Work is on
`codex/mcp-account-linking`; production promotion was not requested. The
existing task 2 app/build dependencies are part of the release; the pre-existing
`GLOSSARY.md` edit remains excluded.

- Migrations `0007` then `0008` applied in one repeatable-read transaction to
  Neon project `old-night-81938469` (drivebeats), main branch
  `br-rapid-mud-agwwmwmp`, database `neondb`. Five new tables, 29 columns,
  11 constraints and seven indexes verified, including a separate application
  direct-connection check. Existing row counts before/after in the same
  transaction were unchanged: users 263, Playlists 71, Playlist Tracks 759,
  favorites 202, metadata 176. The new tables were empty. There is no existing
  migration tracker; `0007` is non-idempotent and must not be rerun.
- Rehearsal used retained Neon branch `br-damp-water-agel7lrz`
  (`mcp-task3-migration-check-20261013`). It contains a copy of the original
  database; cleanup remains pending because deleting it needs authorization.
- Stable preview issuer chosen:
  `https://drivebeats-mcp-preview-fabian.vercel.app`. Public client ID:
  `drivebeats-chatgpt-preview`. Host callback:
  `https://chatgpt.com/connector_platform_oauth_redirect`. The Google callback
  to configure is the issuer plus `/api/mcp/oauth/google`.
- All five MCP variables are configured for Preview deployments on
  `codex/mcp-account-linking`; the signing and credential-encryption keys are
  independent, server-only values. Existing Google and database configuration
  is reused. Variable presence is configuration evidence; deployed runtime
  behavior and actual linking remain separate checks.
- Plugin source is now reproducible in `plugins/drivebeats-preview`, version
  `0.2.0`, preserving the existing internal package name, plugin ID,
  USER/PRIVATE scope, and icon paths. It declares mixed access, provided
  public-client authentication `none` and all three baseline scopes.
- The independent release review caught and fixed two real integration
  problems: the MCP transport now allows the validated issuer alias; the
  consent route alone permits configured HTTPS callback origins in
  `form-action`. The ordinary website policy remains unchanged. Isolated
  Chromium form→303 reproduction showed callback hits 0 before and 1 after
  the scoped CSP fix. This is redirect-policy evidence, not ChatGPT linking.
- Root checks after these fixes passed: `pnpm test` **48 UI + 373 web = 421**,
  `pnpm lint`, `pnpm build`; focused release checks covered 16 tests.
- Implementation commit `3ff4158` was pushed on
  `codex/mcp-account-linking`. The pre-existing `GLOSSARY.md` edit remains
  outside that commit.
- Deployment exclusion commit `e51df44` was pushed on the same branch.
  `.vercelignore` excludes environment files and local mise configuration;
  the clean deployment dry run verified those exclusions before rebuilding.
- The clean Preview deployment is READY:
  `dpl_9GPoane4n6tHTeB6ZFfNWmnqiahW`, with immutable origin
  `https://drivebeats-egr5w2xko-fabian-dietenbergers-projects.vercel.app`.
  The stable issuer alias resolves to this deployment, verified by canonical
  readback. Thirteen deployed smoke checks passed, covering discovery/tool
  metadata, CSP, auth challenges and invalid requests.
- A real deployed authorize request returned 307, persisted an encrypted
  linking request in Neon and redirected to Google with the existing
  DriveBeats production client, the stable issuer's `/api/mcp/oauth/google`
  callback, `drive.file` and the existing identity scopes. This proves the
  deployed start of authorization, not a completed account link.
- The existing private plugin was updated to version `0.2.0`, release
  `pluginrel_6acdd2f59bcc81919ecb8b6314ff8153`. Readback verified all four
  manifest files; plugin identity and USER/PRIVATE scope remain unchanged.
- Google Cloud sign-in works in Firefox. The exact callback is prepared in
  the existing client's configuration but remains unsaved: the computer-use
  policy requires confirmation at that save action. Provider configuration
  and real ChatGPT linking remain pending. No credentials are included in
  these notes.
- The actual ChatGPT plugin page in Firefox shows the installed version
  `0.2.0`. Its Start action opens the normal `/codex/open-app` launcher and
  asks to open ChatGPT Desktop. Browser control of the native host UI was
  blocked, so host connection requires user interaction. Plugin Management
  search returns no DriveBeats results, and updated DriveBeats tools are
  unavailable in the current tool inventory after the cached fixture tools
  disappeared. Neither the web listing nor the launch
  action proves new tool activation or completed OAuth linking.

Google callback and real-host results will be appended after their
verification. The task remains unchecked until real account data and selected
Drive reads are accepted.

### Installed-host compatibility repair, 2026-10-13

The installed desktop host could not activate release `0.2.0`. Desktop logs
reported unknown extension fields and parsed zero tools. The actual bundled
CLI, version `0.162.0-alpha.17.2`, initialized with MCP protocol `2025-06-18`,
which the server's modern-only transport rejected. These were distinct package
and transport compatibility failures. The evidence came from desktop logs,
the installed plugin package/cache and isolated runs of that exact bundled
CLI, rather than a different SDK client.

- The server now supports the SDK's stateless legacy transport alongside
  modern requests. Tool authorization declarations are mirrored correctly in
  both JSON and SSE responses. An isolated actual-CLI run failed with the old
  `0.2.0` package and passed with the corrected legacy-only `0.2.1` package.
  The provided-client legacy OAuth declaration preserves the public client
  and PKCE. Callback validation allows exact configured HTTPS callbacks and
  one fixed loopback callback on port `46123`; it permits no arbitrary HTTP
  origins or wildcard callbacks.
- After the repair, root `pnpm test` passed **48 UI + 387 web = 435 tests**;
  `pnpm lint` and `pnpm build` passed. Independent focused verification passed
  39 tests. Commit `14ce7d9` was pushed on `codex/mcp-account-linking` using
  authenticated HTTPS after SSH-agent authentication failed.
- Preview deployment `dpl_78uX3TTqN5PekvAA2c9YgAcGMNGr` is READY and the
  stable issuer alias resolves to it. The actual bundled CLI discovered all
  seven deployed tools. Raw modern and legacy requests verified anonymous
  fixtures and private authorization challenges against the same deployment.
- The existing private plugin was updated through `0.2.1` to `0.2.2`, release
  `pluginrel_6ace1a0342688191b982013b6e92e134`. Inventory/readback verified the
  legacy-only package. The two old portable root configuration files were
  removed from the current package and remain recoverable through prior
  release configuration. Plugin identity and USER/PRIVATE scope are unchanged.
- DriveBeats tools are now restored in this actual chat. Real
  `drivebeats_list_fixture_tracks` and `drivebeats_open_fixture_player` calls
  succeeded and exposed the Pulse and Afterglow samples. The real profile call returned the expected
  `sign_in_required` response while signed out. This proves installed tool
  activation and anonymous tool calls; it does not prove linked cloud access.
- Native icon observations came from the user's screenshot, and Firefox
  confirmed the `0.2.1` package folder. Release `0.2.2` uses a fresh binary path,
  `assets/drivebeats-icon.png`, in both icon references; the bytes match the
  intended existing logo and package loading passes. The displayed native
  icon has not yet been verified after this release. Firefox was under active
  user control, so no navigation was performed for that display check.
- A token-endpoint mock exercised the actual native client's OAuth request:
  PKCE, resource binding and the provided public client ID were correct, and
  no dynamic client registration occurred. No real tokens were issued by that
  check. Google callback Save remains pending the required user confirmation;
  actual Google consent, return to ChatGPT, linked profile/cloud data, selected
  Drive audio, refresh/reconnect/revocation and website/session preservation
  remain unverified.

The earlier zero-tool observation is resolved by the installed-host repair.
Task 3 remains unchecked until the remaining real-account flow is verified;
neither mocked OAuth requests nor restored anonymous tools satisfy that gate.

The user subsequently confirmed the plugin detail page still displays `0.2.1`.
Remote metadata and the actual desktop cache independently contain `0.2.2`;
that installed cache passes the bundled CLI's icon-byte and seven-tool checks.
Visible icon rendering therefore remains unresolved. No supported Plugin
Management refresh or icon-repair operation is exposed.

The global sidebar launch tool's title was changed from `Open DriveBeats` to
`DriveBeats`. OpenAI's entrypoint contract derives its displayed title from
`tools/list.title`; the resource and UI already used `DriveBeats`. Both modern
and legacy discovery tests assert the requested label. Native metadata refresh
and visible sidebar acceptance still require verification.

Commit `c1e3fa8` was pushed and deployed to preview as
`dpl_76bnRf5pCCggzQxA29LhQgoPnka5`; canonical alias readback confirms that exact
deployment. Real modern and legacy `tools/list` responses now expose the
global launch title `DriveBeats` and all seven tools. The actual bundled CLI
passes against release `0.2.2` and this deployment. The final title change also
passed all 435 root tests, lint and build. The remaining working-tree glossary
edit belongs to the user and was excluded from these commits.

### Browser choice and saved Google callbacks, 2026-10-13

The user saved both the stable preview linking callback and
`https://www.drivebeats.app/api/mcp/oauth/google` in the existing Google OAuth
client. Reopening that exact client in Firefox confirmed both saved entries
alongside the unchanged website callbacks. Production callback registration
prepares future deployment; production MCP has not been activated.

Commit `9b10b03` adds a hosted connection page with Continue with Google and a
visible, copyable original authorization request. Opening that URL in Firefox
creates its own pending cookie while retaining ChatGPT's state, PKCE challenge,
client and resource. The embedded player explains where to copy it because the
MCP Apps SDK does not expose the host-owned authorization URL. The page escapes
URLs, permits only its fixed copy script by CSP hash, disables caching and sends
no referrer to Google. Root tests passed **48 UI + 394 web = 442 tests**, lint
and build passed, and independent focused OAuth review passed 37 tests.
React Doctor reported 92/100 with only the existing account-panel complexity
warning. The commit was pushed; deployed and browser results follow below.

The canonical preview now points to READY deployment
`dpl_8iJPxzgQGJRtdBUm3y7vR2WqLytH` (source `9b10b03`). Live HTTP checks verified
the final script-hash CSP, no-referrer/no-store headers, canonical request URL,
both host callbacks and the fixed Google continuation. Modern and legacy
discovery and the bundled desktop CLI still load all seven tools.

The real in-app browser rendered the page with a synthetic authorization
request. Its visible connection URL exactly matched the original request;
clicking Copy link displayed success with no console errors. At 320px and
428px, document width matched viewport width and both controls were at least
44px high. Clipboard byte readback could not be confirmed through this browser
adapter, which returned an empty clipboard despite the success status. Actual
paste into Firefox and real host linking remain pending the user's test.
