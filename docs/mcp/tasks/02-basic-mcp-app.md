# Task 2 Basic MCP App and host test

Read [execution context](../context.md) and [task 1 notes](01-monorepo.md#execution-notes). Requires task 1's local checks. Scope: real plugin/UI/audio proof; account linking and shared player extraction belong to later tasks.

## Inputs and decisions

- Create apps/drivebeats-mcp-app as @drivebeats/mcp-app: React/TypeScript browser bundle, no second Next backend. Default to Vite after verifying current docs and host CSP compatibility.
- Web hosts /mcp at apps/drivebeats-web/src/app/mcp/route.ts and registers the built UI resource. Put server/tool modules under web src/lib/mcp/; keep the handler thin.
- Start with protocol 2026-07-28, official SDK v2 server adapter, standard MCP Apps bridge, and OpenAI sidebar extension. Verify compatible package versions together; older OpenAI examples use earlier SDK imports. Add compatibility only if actual host testing requires it.
- Anonymous testing tools contain fixture data only; no private account data or Google permissions now.

Read [MCP baseline](../../research/mcp-2-prototype-baseline.md), [OpenAI UI](https://developers.openai.com/plugins/build/chatgpt-ui), [extensions](https://developers.openai.com/plugins/build/extensions), [connect/test](https://developers.openai.com/plugins/deploy/connect-chatgpt), and [SDK modern support](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28). Fetch current docs before choosing exact APIs.

## Deliverables

1. Minimal screen: sample track list, refresh result status, accessible play/pause/next controls and error state. Use owned/generated/permitted audio; document provenance.
2. Sidebar launch tool accepting {} and linked through _meta.ui.resourceUri; declare a global entrypoint using current _meta["openai/ui"] metadata. Add one fixture read tool. Data updates must not remount Audio.
3. Discovery/list/call/resource handlers, correct schemas/results/annotations, host initialization, narrow resource/connect CSP, feature detection and model-readable results.
4. Deterministic UI build before web build; declare workspace dependency/build order. Ensure HTML/CSS/JS/audio actually ship in the Next deployment artifact and load in the sandbox. Repository-local files and the Vite dev server are insufficient. Version UI resources against caching.
5. Private custom connection through an approved HTTPS endpoint or supported tunnel. Prefer existing drivebeats infrastructure. Prepare code/package/instructions before necessary external approval; real host testing is required for completion.

## Acceptance and verification

Run root checks and direct MCP Inspector discovery/list/read/UI-resource calls, invalid inputs and resource errors. Then verify actual ChatGPT: sidebar launch, model-selected fixture tool, UI-originated tool call, assets loading without console errors, and audible audio.

Exercise play/pause/next, repeated results, navigation away/back, chat switching and minimize. Document unsupported autoplay/background behavior. Check 320–428px and desktop. Record host/version, SDK/extension/UI package versions, connection method, protocol behavior, fixture provenance, and asset/build approach.

A shell screenshot or simulated tool response does not satisfy host/audio proof. If audio/sidebar is blocked, finish independent work and record exact failure/alternatives; leave task unchecked and resolve host feasibility before account linking. External changes follow current authorization and repository rules.

## Execution notes

Implemented and accepted on 2026-10-12 with UI, server/audio and compatibility/review subagents. The user confirmed real-host playback on version 0.1.3, then requested cleanup and DriveBeats branding. Current private release is **0.1.5**; its real-host regression check is pending. Task 3 remains unstarted. No commit or push was made; the pre-existing `GLOSSARY.md` edit was preserved.

### Current implementation

- `apps/drivebeats-mcp-app` is the React/Vite player. It uses the existing DriveBeats 192px logo and web blue/neutral palette. Raw protocol output, host debug state, temporary playback/CSP probes and fake preview refresh have been removed.
- Two original six-second MP3s are checked in under `public/mcp-fixtures`, each **24,668 bytes**. They were encoded once from the original synthesized tones using FFmpeg 9.0.2/libmp3lame; no recordings, third-party samples or runtime generation dependency. Decode checks confirmed six seconds of mono audio at 44.1 kHz. See [audio provenance](../../../apps/drivebeats-mcp-app/README.md).
- Fixed IDs remain `pulse` and `afterglow`; display titles are Pulse and Afterglow, artist DriveBeats Studio. Their full content hashes are part of immutable asset filenames. No browser Blob fallback or generated manifest remains.
- The web build compiles the UI, verifies/copies MP3 bytes, and inserts one fixed JSON origin before the module. The UI accepts a canonical HTTPS origin (loopback HTTP only for local checks) and constructs the two fixed MP3 paths. Tool results cannot replace media URLs.
- The current Vite HTML is 544,488 bytes; prepared template 544,601 bytes; hosted HTML 544,641 bytes, about 45% smaller than the previous release. Final hosted SHA256 is `b95af0f2328fbd4b2441321b878a06e44ae91dd0b5842b68c97f15fbe96fa890`. Next traces `.mcp-ui/index.html` for `/mcp`; static MP3s ship with the normal public output. Runtime substitutes the origin, then hashes the final HTML into the versioned `ui://drivebeats/fixture-player-<sha256>.html` resource. JavaScript, CSS and logo are embedded; audio uses HTTPS. Resource CSP permits only the exact deployment origin; connect domains remain empty. Ordinary website CSP is unchanged.
- Thin Node POST `/mcp` uses SDK `createMcpHandler`, modern **2026-07-28**, legacy rejection, 16 KiB body limit and deployment Host/Origin validation.
- Stable tool IDs are `drivebeats_open_fixture_player` and `drivebeats_list_fixture_tracks`, both strict `{}`, read-only, non-destructive, idempotent and closed-world. Only the launch tool binds the UI resource and global entrypoint. Fixture results contain fixed metadata and model-readable text.
- One Audio element survives metadata results. Play requires a tap; Pause stops it; Next prepares the next track without autoplay. Refresh announces “Tracks refreshed” only after a validated real host response. Initialization registers results before connecting; teardown/resize cleanup and BFCache suspension remain covered.
- Versions: server/client/core 2.3.1, MCP Apps bridge 2.0.3, Zod 4.6.5, Vite 8.3.4, singlefile 2.3.3, React 19.3.0, TypeScript 7.0.2, Inspector 2.10.1. [Compatibility evidence](../../research/mcp-task-2-compatibility.md).

### Current preview and private plugin

- [Preview](https://drivebeats-jtyy3oleu-fabian-dietenbergers-projects.vercel.app), deployment `dpl_EVGfSaLpZc9pRNw1GHhZDW5DTxS3`, READY, preview target.
- [DriveBeats](https://chatgpt.com/plugins/plugins_6accdcd7dcd88191a0beba5e3f94eb63), private personal plugin **0.1.5**, USER/PRIVATE. Display name and packaged logo/composer icon were read back and verified. Its existing backend/package identity and permissions are preserved.
- Connection uses the bare HTTPS `/mcp` URL with empty headers. Preview protection was disabled by the user after the initial 307 redirect failed; the assistant did not change that setting. No share query or cookie header is stored in the plugin. An exploratory CLI-created automation bypass token was previously revoked; later checks use public HTTPS directly.

### Verification

| Check | Result |
| --- | --- |
| Root tests | `pnpm test` passed: **30 UI + 292 web = 322**, plus core typecheck. |
| Root lint/build | `pnpm lint` and `pnpm build` passed. No audio generator or encoder is needed for these commands. |
| Independent review | No significant findings across player/lifecycle, origin validation, asset hashing/copy, CSP and server contracts. |
| React Doctor | **100/100**, no diagnostics. |
| Browser | Compiled UI plays both MP3s with duration 6, readyState 4, advancing time and no media error. Pause and Next work; no warning/error console output. 320px, 428px and 1440px layouts have no overflow; all controls meet 44px touch targets at the narrowest width. The actual hosted HTML also played both Vercel HTTPS MP3s under a media policy allowing only self and the preview origin, with no console errors. |
| Hosted MCP/assets | All 12 independent public HTTPS checks passed: modern tools/resources, final HTML rendering/hash, exact-origin CSP, unchanged shared logo, MP3 hashes/MIME/cache and HTTP 206 Range responses. Both model calls remain available, but this active turn returned the previous release’s labels, indicating a cached connection; current metadata is verified through the fresh Inspector connection. Strict input/resource errors were covered in the previous pass and current tests. |
| Preservation | `git diff --check` passed; glossary checksum unchanged. No Google Drive, database, authentication or synced-data changes. |

### Host evidence and limits

The original real-host failure in ChatGPT 26.1007.30912 was code 4, “Media load rejected by URL safety check”, before decoding, with active user gesture and autoplay allowed. Data and Blob media were blocked by the host's media policy. HTTPS fixtures with an exact-origin resource declaration resolved it; the user replied “it works now” to the version 0.1.3 playback/refresh/lifecycle checklist. Detailed background stop/continue timing was not supplied, so no background continuity guarantee is made.

Native automation is blocked for `com.openai.codex`; no prohibited native control or remote-debug workaround was used. The supported MCP Apps interface exposes only apps expanded beside this chat, not the global sidebar entry. Version 0.1.4's MP3, branding and simplified-refresh behavior require the requested human regression check. This active turn still returned the previous track labels and the inspected desktop cache contained 0.1.3, so saving/read-back of the account release is not claimed as desktop activation. The sidebar context menu Refresh (or double-click entry) reloads its current widget; it does not prove connection-version replacement. The official custom-connection guide recommends metadata refresh and a new conversation, but an exact private-release activation flow was not confirmed in installed UI sources. Native sandbox console inspection remains unavailable; browser checks of the served artifact provide separate console evidence.

### Icon-path correction, 2026-10-13

The user screenshot and read-only installed cache confirm that 0.1.4 reached the desktop. The detail page showed the generic folder icon despite the packaged PNG. Both manifests incorrectly referenced `assets/drivebeats.png`; [OpenAI path rules](https://developers.openai.com/plugins/build/plugins#path-rules) require `./`-prefixed plugin-root paths. Private release 0.1.5 corrects `logo` and `composerIcon` to `./assets/drivebeats.png`. Guarded upload and source read-back verified only those paths and version changed; logo bytes, MCP endpoint, identity and USER/PRIVATE scope remain unchanged. Display of the corrected icon still requires desktop confirmation; this source correction alone does not prove successful rendering.
