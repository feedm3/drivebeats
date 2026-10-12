# Task 2 Basic MCP App and host test

Read [execution context](../context.md) and [task 1 notes](01-monorepo.md#execution-notes). Requires task 1's local checks. Scope: real plugin/UI/audio proof; account linking and shared player extraction belong to later tasks.

## Inputs and decisions

- Create apps/drivebeats-mcp-app as @drivebeats/mcp-app: React/TypeScript browser bundle, no second Next backend. Default to Vite after verifying current docs and host CSP compatibility.
- Web hosts /mcp at apps/drivebeats-web/src/app/mcp/route.ts and registers the built UI resource. Put server/tool modules under web src/lib/mcp/; keep the handler thin.
- Start with protocol 2026-07-28, official SDK v2 server adapter, standard MCP Apps bridge, and OpenAI sidebar extension. Verify compatible package versions together; older OpenAI examples use earlier SDK imports. Add compatibility only if actual host testing requires it.
- Anonymous testing tools contain fixture data only; no private account data or Google permissions now.

Read [MCP baseline](../../research/mcp-2-prototype-baseline.md), [OpenAI UI](https://developers.openai.com/plugins/build/chatgpt-ui), [extensions](https://developers.openai.com/plugins/build/extensions), [connect/test](https://developers.openai.com/plugins/deploy/connect-chatgpt), and [SDK modern support](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28). Fetch current docs before choosing exact APIs.

## Deliverables

1. Minimal screen: fixture track list, tool-result display, accessible play/pause/next controls and error state. Use owned/generated/permitted audio; document provenance.
2. Sidebar launch tool accepting {} and linked through _meta.ui.resourceUri; declare a global entrypoint using current _meta["openai/ui"] metadata. Add one fixture read tool. Data updates must not remount Audio.
3. Discovery/list/call/resource handlers, correct schemas/results/annotations, host initialization, narrow resource/connect CSP, feature detection and model-readable results.
4. Deterministic UI build before web build; declare workspace dependency/build order. Ensure HTML/CSS/JS/audio actually ship in the Next deployment artifact and load in the sandbox. Repository-local files and the Vite dev server are insufficient. Version UI resources against caching.
5. Private custom connection through an approved HTTPS endpoint or supported tunnel. Prefer existing drivebeats infrastructure. Prepare code/package/instructions before necessary external approval; real host testing is required for completion.

## Acceptance and verification

Run root checks and direct MCP Inspector discovery/list/read/UI-resource calls, invalid inputs and resource errors. Then verify actual ChatGPT: sidebar launch, model-selected fixture tool, UI-originated tool call, assets loading without console errors, and audible audio.

Exercise play/pause/next, repeated results, navigation away/back, chat switching and minimize. Document unsupported autoplay/background behavior. Check 320–428px and desktop. Record host/version, SDK/extension/UI package versions, connection method, protocol behavior, fixture provenance, and asset/build approach.

A shell screenshot or simulated tool response does not satisfy host/audio proof. If audio/sidebar is blocked, finish independent work and record exact failure/alternatives; leave task unchecked and resolve host feasibility before account linking. External changes follow current authorization and repository rules.

## Execution notes

Not started. Record tool names/resource URI, build output locations, protocol/package versions, endpoint/tunnel, actual host evidence, audio lifecycle findings and task 3 readiness.
