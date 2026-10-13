# Task 2 MCP App compatibility

Checked 2026-10-12 against current official documentation, npm publisher metadata and published package declarations. The real ChatGPT host now discovers the server and renders its global sidebar player. Audible audio and host lifecycle acceptance remain open.

## Compatible package baseline

| Package | Current published version | Compatibility evidence |
| --- | --- | --- |
| `@modelcontextprotocol/server` | 2.3.1 | Official SDK v2 HTTP adapter and `McpServer` exports. |
| `@modelcontextprotocol/client` / `core` | 2.3.1 | Companion SDK v2 packages. |
| `@modelcontextprotocol/ext-apps` | 2.0.3 | Peers server/client/core `^2.0.0`, Zod `^4.2.0`, React and React DOM including `^19.0.0`. |
| `zod` | 4.6.5 selected | Satisfies ext-apps v2 peer requirements; latest 4.6.6 is too recent for this workspace's install policy at verification time. |
| `@modelcontextprotocol/inspector` | 2.10.1 | Ships SDK 2.2.0 and ext-apps `^2.0.0`; requires Node >=22.19.0. |
| `vite` | 8.3.4 | Node `^20.19.0 || >=22.12.0`; Node 24 satisfies it. |
| `vite-plugin-singlefile` | 2.3.3 | Vite peers include `^8.0.0`. |
| `@openai/mcp-extensions` | 0.1.0 | **Not compatible with this baseline:** peers SDK v1 `^1.29.0` and ext-apps `^1.7.5`. |

Verified with root `pnpm view <package> version peerDependencies dependencies engines`; versions are a timestamped registry snapshot, not an upgrade policy. Publisher records: [server](https://registry.npmjs.org/@modelcontextprotocol/server/2.3.1), [ext-apps](https://registry.npmjs.org/@modelcontextprotocol/ext-apps/2.0.3), [Inspector](https://registry.npmjs.org/@modelcontextprotocol/inspector/2.10.1), [Vite](https://registry.npmjs.org/vite/8.3.4), [singlefile](https://registry.npmjs.org/vite-plugin-singlefile/2.3.3), [OpenAI extensions](https://registry.npmjs.org/@openai/mcp-extensions/0.1.0).

**Decision:** Use documented OpenAI sidebar metadata directly; installing the OpenAI extensions package solely for a metadata type would introduce incompatible peer requirements. No `window.openai` compatibility shim is needed for the standard bridge.

## Server and wire APIs

Import `createMcpHandler` and `McpServer` from `@modelcontextprotocol/server`. The handler exposes `.fetch(request)`; it is not itself a fetch function. Its factory supports asynchronous construction: `(ctx) => McpServer | Server | Promise<McpServer | Server>`. It constructs fresh servers per request. `legacy: "reject"` selects modern-only operation; the default also accepts stateless 2025-era requests. Begin strict; host evidence must justify compatibility. [Modern SDK support](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).

Published 2.3.1 declarations confirm `registerResource(name, uri, metadata, readCallback)` and `registerTool(name, config, callback)`. Use complete `z.object(...)` schemas for `inputSchema`/`outputSchema`; raw Zod property maps are deprecated. Return both useful text content and schema-conforming `structuredContent`. A strict empty object schema rejects unexpected launch arguments. Package declarations were inspected from the [official published tarball](https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.3.1.tgz).

Modern requests place these fields inside `params._meta`: `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo`, and `io.modelcontextprotocol/clientCapabilities`. Mirror the version as `MCP-Protocol-Version`, method as `Mcp-Method`, and tool name/resource URI as `Mcp-Name` for `tools/call`/`resources/read`. Send JSON with an Accept header admitting JSON and SSE. `server/discover` has no name header. No modern `initialize` session or session ID is needed. [Transport and metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

## UI resource and bridge

Launch tool metadata:

```ts
_meta: {
  ui: { resourceUri: "ui://drivebeats/<content-version>.html" },
  "openai/ui": { entrypoints: [{ type: "global" }] },
}
```

The documented global entrypoint opens an MCP App from the sidebar. It needs no model-supplied arguments. [OpenAI extensions](https://developers.openai.com/plugins/build/extensions).

Serve resource MIME `text/html;profile=mcp-app`. Resource content metadata uses `_meta.ui.csp.connectDomains` and `resourceDomains`. Embedded JS/CSS and host-mediated tool calls permit an empty connection list. The current OpenAI media restriction requires the sample-audio deployment origin in the resource list, as detailed below. Only the launch tool references the resource: ordinary fixture-read results should update existing UI data rather than request another iframe. Version resource URIs when the rendered bundle changes because hosts treat them as cache keys. [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

The MCP Apps specification's default CSP includes `media-src 'self' data:` and preserves `data:` in its metadata-derived construction example. Embedded WAV data URLs fit that policy without a remote asset domain; hosts may impose tighter restrictions, so this remains subject to actual host testing. [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#host-behavior).

Browser import: `App` from `@modelcontextprotocol/ext-apps`. Construct `new App({ name, version }, {}, { strict: true, autoResize: false })`. Register `addEventListener("toolresult", handler)` and other handlers **before** `connect`; remove them during cleanup. Shipped 2.0.3 marks the `on*` notification setters deprecated. `await app.connect(undefined, { timeout: 10000 })` initializes the default parent-window postMessage transport. `await app.close()` closes it. Check `app.getHostCapabilities()?.serverTools` before `app.callServerTool({ name, arguments: {} })`. Record `getHostVersion()` and relevant `getHostContext()` fields as host evidence. [SDK source](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/app.ts), [published declarations](https://registry.npmjs.org/@modelcontextprotocol/ext-apps/-/ext-apps-2.0.3.tgz).

The App defaults disable Zod JIT, supporting CSP without `unsafe-eval`. With automatic resize disabled, optionally retain and later invoke `app.setupSizeChangedNotifications()`'s cleanup function. Shipped `connect` does not retain the automatic ResizeObserver cleanup. Keep audio ownership independent of tool-result React renders, and handle failed `play()` promises. None of these APIs guarantees playback across iframe destruction or desktop/mobile backgrounding. [SDK source](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/app.ts).

## Build and assets

Vite produces deployable assets with `vite build`; development URLs are not deployment resources. [Vite production build](https://vite.dev/guide/build.html). `viteSingleFile()` embeds JS/CSS, but files in `public/` are **not** inlined. Relative `/assets/...` references resolve against the sandbox origin and cannot assume the Next website origin. The HTML must be copied into web-owned deployment files and explicitly included in Next output tracing. [Singlefile documentation](https://github.com/richardtallent/vite-plugin-singlefile#caveats).

The current cleanup checks in two original MP3 samples with full SHA-256 filenames. Build verifies and copies those bytes, then inserts only the deployment origin as JSON before the UI module. Server and client accept a canonical HTTPS or loopback-HTTP origin; the client constructs its compiled fixed MP3 paths, and the server hashes the final rendered HTML. Runtime generators, generated manifests, Blob fallback and temporary playback/CSP instrumentation were removed. These reviewed source facts remain separate from deployment byte delivery and human audible checks.

## Inspector verification

Inspector v2 has explicit `--protocol-era modern`. Examples, with URL/URI/tool names replaced by the implementation:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.10.1 --cli http://localhost:3100/mcp --transport http --protocol-era modern --method tools/list --format json
pnpm dlx @modelcontextprotocol/inspector@2.10.1 --cli http://localhost:3100/mcp --transport http --protocol-era modern --method resources/list --format json
pnpm dlx @modelcontextprotocol/inspector@2.10.1 --cli http://localhost:3100/mcp --transport http --protocol-era modern --method resources/read --uri ui://drivebeats/RESOURCE.html --format json
pnpm dlx @modelcontextprotocol/inspector@2.10.1 --cli http://localhost:3100/mcp --transport http --protocol-era modern --method tools/call --tool-name TOOL --tool-args-json '{}' --format json
```

`--method initialize` is a connect-only probe, including modern discovery; it does not require a modern initialize wire request. Explicit wire `server/discover` can be tested through the SDK adapter. Add `--advertise-apps` when probing UI capabilities and `--app-info` to inspect app metadata without calling a tool. [Official CLI guide](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md).

Isolate Inspector state using task-local paths: `MCP_STORAGE_DIR`, `MCP_CLIENT_CONFIG_PATH`, and, if already exported, `MCP_INSPECTOR_OAUTH_STATE_PATH`. Set `MCP_INSPECTOR_SECRET_STORE=memory` and `MCP_INSPECTOR_PERSIST_TOKENS=none` to avoid OS keychain changes. Ad-hoc targets avoid the writable catalog; use an existing read-only `--config` if configuration is necessary. [Environment variables](https://github.com/modelcontextprotocol/inspector/blob/main/docs/environment-variables.md).

## Real ChatGPT connection and remaining evidence

Current OpenAI instructions accept a public HTTPS `/mcp` endpoint or Secure MCP Tunnel. In ChatGPT Plugins, add a custom MCP server, configure the connection/authentication, create the plugin, review discovered tools, install it, and begin a new conversation. Refresh metadata after bundle/tool changes. This requires account/workspace access and changes external account state; the repository's approval rule applies after the local result is reviewable. [Connect/test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

A Secure MCP Tunnel requires a tunnel identity, a running `tunnel-client`, Platform organization association, target ChatGPT workspace association, and the operator's tunnel permissions. For HTTP, the client targets `--mcp-server-url <URL>`; `doctor --profile <profile> --explain` checks it. Account availability/credentials were **not checked**. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

**Confirmed in the real host:** the private plugin connects to the approved preview `/mcp`, discovery works and the global sidebar player renders. After the version 0.1.3 HTTPS fix, the user replied “it works now” to the requested Play/Pause/Next, UI refresh, chat switching and minimize/reopen checklist. This is the recorded overall real-host acceptance, separate from automated checks. Detailed background stop/continue timing was not supplied; native sandbox console inspection remained unavailable. Root task notes retain the exact evidence and limits.

## Original desktop playback diagnosis

The human Play attempt in `chatgpt 26.1007.30912` reported an active gesture, visible document, `autoplayAllowed: true`, and WAV support `maybe`. The document uses `codex-sandbox://mcp-app-….web-sandbox.oaiusercontent.com`. Before `play()`, the audio element already had error code 4 with `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`, `readyState: 0`, `networkState: 3` and duration `NaN`; `play()` rejected with `NotSupportedError`. These are human-provided host observations, not an automated audio acceptance pass.

Chromium emits this precise error before loading/decoding when the URL is invalid, its origin cannot display it, or CSP blocks media. Its origin check explicitly permits `data:` URLs. Given a valid data URL, CSP is the remaining cause in that source path; this does not implicate WAV encoding or autoplay. [Media element implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/html/media/html_media_element.cc), [origin implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/weborigin/security_origin.cc).

The current first-party OpenAI sandbox asset constructs `media-src` from `'self'` plus baseline HTTPS domains and normalized resource domains. It adds neither `data:` nor `blob:` by default. Its normalizer accepts those literal schemes only for trusted apps; third-party resource-domain entries using them are filtered out, while explicit HTTPS origins are accepted. This differs from the MCP specification's example default containing `data:`. It is a static implementation fact, not yet the captured effective policy of the failing iframe. [Current sandbox CSP source](https://web-sandbox.oaiusercontent.com/assets/apply-csp-B3_p2VtT.js), [sandbox entrypoint](https://web-sandbox.oaiusercontent.com/mcp-app.html), [widget policy application](https://web-sandbox.oaiusercontent.com/assets/run-widget-code-YperyLOO.js).

Read-only inspection of the installed app's `browser-background-switches-Zzmx0u5p.js` shows `codex-sandbox` registered with standard, secure, stream, Fetch API, CORS and service-worker privileges enabled. Missing protocol streaming support therefore does not explain the observation. [Electron protocol privileges](https://github.com/electron/electron/blob/main/docs/api/protocol.md).

Current Chromium's CSP matcher compares the URL scheme directly against the protected scheme without unwrapping a Blob origin, predicting that `blob:` will also fail a `codex-sandbox` `'self'` rule. [CSP self matcher](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/frame/csp/csp_source.cc), [directive evaluation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/frame/csp/csp_directive_list.cc).

The supervisor reproduced Blob rejection in the actual in-app browser against a throwaway local HTTP page whose response header restricted media to `'self'`. An active gesture and allowed autoplay still produced the same code 4 URL-safety error, `NotSupportedError`, zero ready state, network state 3 and `NaN` duration. The captured violation was enforced `media-src` with the `'self'` policy. This confirms the Blob/CSP mechanism locally; it is not a real MCP-host playback test.

Hosting the original audio fixtures over HTTPS and declaring their exact deployment origin in `resourceDomains` matches the current host's policy construction. That implementation passed root tests/lint/build, public MCP/asset checks, and actual hosted-artifact browser playback under the declared media policy. Version 0.1.3 received the human real-host confirmation recorded above. Task 2 is accepted; no autoplay or background continuity guarantee is inferred.

## Cleanup release 0.1.4

Display branding is now DriveBeats with the existing logo. Static MP3 assets replace build-time WAV generation, the HTML config contains only an origin, and the bridge no longer simulates preview refresh or exposes debug state. Root tests/lint/build passed, with 322 tests and React Doctor 100/100. All 12 current public HTTPS checks passed, including modern tools/resources, exact-origin CSP, MP3 bytes/MIME/cache/Range and matching embedded logo. The actual hosted HTML played both HTTPS MP3s in the supported browser under the declared media policy. A real-host regression check has been requested for MP3 playback, refreshed-track status and the updated name/logo; it is pending.

Desktop activation remains separate: this active chat returned prior-release labels, and the inspected local plugin cache still contained 0.1.3. Installed source exposes sidebar Refresh/double-click as widget reload, not a proven plugin-version update. No exact private-release activation UI flow was confirmed in the inspected plugin-detail/actions/state/query sources. The account release 0.1.4 and fresh endpoint/artifacts are verified; human current-host branding/playback/refresh confirmation remains pending.

### Icon-path follow-up, 2026-10-13

The user screenshot and installed cache now confirm desktop version 0.1.4, superseding the earlier 0.1.3 cache snapshot. The plugin detail page shows a folder fallback. Source inspection found an actual package contract violation: both `logo` and `composerIcon` lacked the `./` prefix required by [OpenAI path rules](https://developers.openai.com/plugins/build/plugins#path-rules). Private release 0.1.5 corrects both fields to `./assets/drivebeats.png` in portable and compatibility manifests. Guarded upload/read-back verified the correction with no other metadata change. Native rendering and playback/refresh regression are still awaiting human confirmation.
