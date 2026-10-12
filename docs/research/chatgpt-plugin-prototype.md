# DriveBeats ChatGPT plugin research and prototype discussion

Researched 2026-10-12. Research and design discussion only; no implementation, installation, deployment, or remote configuration changes. Recommendations below are proposals, not accepted architecture decisions.

The staged implementation backlog is maintained in [MCP todo](../mcp-todo.md).

## Feasibility

The intended product fits the documented integration model: an installed plugin can expose tools to ChatGPT and an MCP App in its sidebar. The sidebar launch opens a fullscreen app; a thread entrypoint can also open a conversation panel. This establishes the UI integration, but does not establish reliable music playback or persistence when navigating away. [OpenAI Plugin Extensions](https://developers.openai.com/plugins/build/extensions).

Use ChatGPT desktop/Work as the first test surface. The extensions specification labels its platform table as expected launch support and excludes Classic ChatGPT; OpenAI's guide also describes rollout limits for Free/Go web users. Do not infer availability on every plan, workspace, or client. [Extensions platform support](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support).

## How the integration works

| Part | Role in DriveBeats |
| --- | --- |
| Plugin package | Installable identity, server connection, optional workflow skills and assets. |
| MCP server | Authenticated tools to find eligible Playable Tracks, save a Playlist, and request playback actions. |
| MCP App | Dedicated player and browsing UI inside ChatGPT. |
| OpenAI extensions | Sidebar launch, conversation panels, presentation modes, and other ChatGPT-specific surfaces. |

A plugin can use a portable root `plugin.json` and `mcp.json`; OpenAI also supports its compatibility package layout. A custom MCP connection can be created in ChatGPT Plugins, then packaged and tested privately. Public directory publication is a separate reviewed process. Start with a private custom connection, without public submission or extra skills. [Packaging](https://developers.openai.com/plugins/build/plugins), [connection and testing](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The MCP App is sandboxed HTML, associated with a tool through `_meta.ui.resourceUri`. It exchanges tool calls, results, and selected model context with the host using the standard MCP Apps bridge. Use the standard first and OpenAI extensions where needed. Data tools and rendering tools should be separate so ordinary queries do not repeatedly remount the player. [MCP UI guide](https://developers.openai.com/plugins/build/chatgpt-ui).

The current sidebar metadata is `_meta["openai/ui"].entrypoints: [{ type: "global" }]`; the launch tool must accept empty arguments. This launches an MCP UI resource, rather than registering the existing website URL as an arbitrary sidebar bookmark. [Global entrypoint specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#global-entrypoint).

Private tools need delegated user authentication. ChatGPT authenticates to DriveBeats; DriveBeats separately reads Google Drive for that user. Existing first-party cookies are not that delegated authentication contract. OAuth discovery, PKCE, token audience and scope validation are part of the new seam. Keep Google credentials out of model-visible results. [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth).

Proposed user experience: connect the plugin, open a DriveBeats authorization page outside the sandbox, use the existing Google identity, approve the ChatGPT connection, and return to the plugin. A valid existing DriveBeats session may shorten sign-in, but that needs testing in the host's browser flow. Resolve both frontends to the same verified Google identity so existing cloud Playlists/favorites belong to the same account; do not create a second DriveBeats identity or password.

ChatGPT receives a DriveBeats-scoped credential for MCP calls. Google Drive authorization remains separate and preserves the current user-selected, read-only behavior. The [current callback](../../apps/drivebeats-web/src/app/api/auth/callback/route.ts) stores Google refresh credentials in a first-party HttpOnly cookie, so this is not an already-working server-side delegated connection. Extend the auth flow with return-to-ChatGPT behavior and a secure grant/refresh lifecycle. The exact Google credential storage or live-session bridge is still to be chosen; do not assume the embedded UI can reuse website cookies. A signed-in plugin can retrieve the existing cloud data, while imported folder selections remain a separate device-local setup question.

The OpenAI Responses API can also call MCP tools, useful for evaluation or a separate assistant product. It is not required to put this player in ChatGPT; ChatGPT supplies the model and host. [MCP in the Responses API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

## MCP 2.0 baseline

The modern protocol is revision `2026-07-28`, distinct from the TypeScript SDK's major version 2. Its key changes are stateless requests, `server/discover`, explicit protocol/capability metadata, and MRTR for additional user input. Broken streams can require reissuing requests, so playlist creation and skip commands need duplicate protection beyond JSON-RPC request IDs. [Protocol changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

Use the official SDK's modern HTTP handler rather than translating older initialization-based examples by hand. SDK v2 installation alone does not switch every entrypoint to modern behavior. [SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions), [modern support migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).

OpenAI's extensions guide explicitly requires MRTR for OpenAI-registered servers, and its extension specification includes modern discovery examples. However, its basic server tutorial still shows the older SDK package. Prefer the modern baseline and verify the actual custom connection and UI bridge together before choosing exact package versions or compatibility adapters. [OpenAI extensions](https://developers.openai.com/plugins/build/extensions), [server tutorial](https://developers.openai.com/plugins/build/mcp-server).

## What the existing repository supports

- Cloud Playlists, favorites, and associated title/artist/album metadata are available through [cloud-library-service.ts](../../apps/drivebeats-web/src/lib/cloud-library-service.ts). Those service operations are the reuse point for tools; enforce their existing account and limit rules.
- Imported Folders and Standalone Tracks are held in [imported-drive-store.ts](../../apps/drivebeats-web/src/stores/imported-drive-store.ts). The account-scoped Library Search catalog is device-local in [library-search-catalog-db.ts](../../apps/drivebeats-web/src/lib/library-search-catalog-db.ts). A standalone server cannot currently enumerate the entire Library.
- The [player-store.ts](../../apps/drivebeats-web/src/stores/player-store.ts) owns a browser Audio element and manual playback controls. It downloads authorized Drive audio into a local Blob. There is no existing remote command channel.
- [Server authentication](../../apps/drivebeats-web/src/lib/server-auth.ts) uses a session cookie; [Google token refresh](../../apps/drivebeats-web/src/app/api/auth/refresh/route.ts) depends on first-party auth cookies. A ChatGPT component does not automatically inherit them.
- [next.config.ts](../../apps/drivebeats-web/next.config.ts) denies iframe embedding. Build a dedicated MCP App surface; do not assume the existing site can be embedded unchanged.
- [Repository rules](../../AGENTS.md) keep Google Drive read-only, audio and player state device-local, and the full imported tree out of Neon. [The glossary](../../GLOSSARY.md) defines Library Search as filename-only; mood/genre/audio understanding is not an existing capability.

These are source findings, not a live authentication or playback test.

## Prototype capability checkpoints

1. Prove a private sidebar entrypoint and audible playback with a permitted test track. Check play/pause/next, tool-result updates, navigation away/back, and iframe lifetime. Use a test asset first to separate host playback behavior from Google authentication.
2. Link one real DriveBeats account and deliberately select the Imported Folders and Standalone Tracks that make up the plugin's Library. Support folder browsing and Library Search across all those tracks. Prove Google access and audible playback separately; use a scoped media path without exposing reusable Google tokens to the model. The precise media/auth mechanism remains part of the spike.
3. Let ChatGPT pick verified track IDs, preview a new Playlist, and save it using existing service operations. A changed Playlist must appear in the ordinary DriveBeats app after refresh.
4. Add request-driven playback control and optional DJ Mode for one explicitly active player. The tool reports success only after the player acknowledges it; a closed player reports unavailable. Test a retried skip cannot skip twice. DJ Mode prepares upcoming tracks before the current one ends; manual choices take precedence as a proposed default.

Manual controls remain available. Recommendations use names and available metadata; no waveform analysis or inferred BPM/genre pipeline. Playback Queue changes affect the listening activity; saving a Playlist is a separate deliberate operation. No cross-device player control, offline mode, or public directory submission in the proposed first slice. DJ operation after the plugin closes is not assumed.

## Follow-up: full Library, shared UI, both AI modes

User decisions: full imported Library access, including search; both explicit playback requests and automatic DJ selection.

The existing [FileBrowser](../../apps/drivebeats-web/src/components/file-browser.tsx), [FolderTree](../../apps/drivebeats-web/src/components/folder-tree.tsx), and [PlayerBar](../../apps/drivebeats-web/src/components/player/player-bar.tsx) are reusable source components. They currently depend on website-specific stores, Drive import hooks and cookie-backed authentication. Proposed direction: share the browsing/player components between the normal app and a plugin entry surface, adapting authentication, data access and host communication. Do not maintain two independent copies of the music UI.

Embedding an existing website is also a documented option when its origin is explicitly allowed, but current DriveBeats frame restrictions and authentication still require changes. It does not prove access to the normal site's existing browser storage. Shared components with a dedicated MCP App shell remain the recommended path. [OpenAI CSP guidance](https://developers.openai.com/plugins/build/chatgpt-ui#content-security-policy-csp).

Proposed Library boundary: import the same desired folders once in the plugin, then build its full catalog locally. An explicit application bridge lets MCP tools request searches/browsing from that authenticated live session and receive bounded results. This bridge is additional DriveBeats infrastructure, not automatic access supplied by the MCP Apps bridge. Scope every operation to that session's imported roots; never turn Library Search into an unrestricted search of Google Drive. Do not persist the full catalog/tree in Neon. If the UI is closed or indexing is incomplete, tools report unavailable/not-ready rather than claiming complete results.

For DJ Mode, starting the mode should authorize automatic upcoming-track selection until stopped. A prepared queue keeps playback independent of model latency. MCP exposes tools but does not itself schedule ChatGPT inference after each track. The refill mechanism still needs a spike: an explicitly initiated host message flow or separate backend inference could do it, with different conversation, UX and cost implications. Do not assume unattended host messages are supported just because the UI can send a follow-up message. [Component bridge reference](https://developers.openai.com/plugins/reference#windowopenai-component-bridge).

If embedded playback fails, controlling an explicitly paired, open DriveBeats browser session is a possible alternative. That adds a new bridge and a requirement to keep that session open; it is not already supported or the default proposal.

## Discussion frontier

### Proposed repository structure

The user proposed a monorepo for the web app, MCP App, and shared code. Recommendation: a small pnpm workspace with two app entrypoints and explicit shared packages:

```text
apps/
  drivebeats-web/          # Next.js site, existing backend, MCP endpoint
  drivebeats-mcp-app/      # ChatGPT React UI bundle and host adapter
packages/
  drivebeats-client/       # Shared music views, player, client state
  drivebeats-core/         # Types, search/shuffle rules, validation
```

The MCP App is a second browser application surface, not necessarily a second deployed backend. Its built UI can be served by the existing backend as an MCP resource. Keep database access, playlist services, credentials and server authorization in the web backend initially. Move server code to a separate package only when another server actually needs it. Shared browser packages must not import server credentials or database clients.

The existing FileBrowser, FolderTree and player views depend on global stores and auth/data hooks. AppPageClient also imports Next.js-specific functionality. Extraction therefore needs real host adapters for authentication, Drive reads, navigation and ChatGPT communication; moving source folders alone does not make the code portable. Share complete music behavior where it matches, while each app owns its host-specific setup and independent runtime state.

Use pnpm workspaces initially, without additional orchestration tooling. The repository already has pnpm-workspace.yaml for dependency build permissions but no package globs. [pnpm workspace documentation](https://pnpm.io/workspaces).

The MCP todo starts with a minimal workspace migration, then proves the sandbox/audio path before broad UI extraction. Keep the ordinary web flow working throughout. Moving the web app also requires checking CI/build paths and deployment configuration; remote configuration changes remain subject to repository approval rules. A monorepo does not resolve Library sharing or automatic DJ inference by itself.

Easy defaults: private prototype; dedicated sidebar player; modern MCP plus MCP Apps; reuse existing cloud services; ordinary controls; Google Drive read-only; no change to the full Library storage boundary.

Settled: full Library browsing/search and both requested actions and optional DJ Mode.

One user decision remains: is selecting the same desired folders once inside ChatGPT acceptable, or must the plugin automatically inherit the normal app's exact current imports? Recommendation: a separate deliberate selection for the prototype, letting the plugin operate while the normal website is closed. Automatic inheritance requires a pairing/export mechanism or a change to the existing device-local import boundary.

No ADR yet: the prototype choices are reversible and the import-sharing decision remains open. Playlist, Playback Queue, and DJ Mode are captured in the glossary.

## Unconfirmed and where checked

| Gap | Where checked / next evidence |
| --- | --- |
| Continuous/background audio, autoplay behavior, navigation persistence | OpenAI UI guide, extensions spec, reference; no guarantee found. Test real audible playback inside the target ChatGPT host. |
| Exact SDK combination for modern MCP + OpenAI UI extensions | Official MCP SDK docs and OpenAI server/extensions guides; examples span protocol eras. Pin after integration test. |
| User's account/workspace availability | OpenAI connection and rollout docs only; no account UI inspected. |
| Full-Library remote access | Imported store, search catalog, cloud service; absent today. Proposed live-session bridge needs implementation and verification. |
| Reliable semantic music selection | Existing filename search and synced ID3 fields only; no genre/BPM/audio analysis verified. |
| End-to-end Google auth and streaming in the component | Existing cookie/token/media source inspected; no live component or delegated auth implemented. |

Only documentation changed. No application tests were run because no executable behavior changed.
