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

Not started. Record auth implementation, endpoints/scopes, variable names, migrations, Google credential lifecycle, disconnect behavior, actual ChatGPT/Drive outcomes, and the client auth/media interface task 4 consumes.
