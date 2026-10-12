# MCP baseline for the DriveBeats ChatGPT prototype

Researched 2026-10-12. Primary sources only. Documentation research; no live ChatGPT connection or playback test performed.

## What “MCP 2.0” means

MCP protocol versions use dates. The latest final revision confirmed here is **2026-07-28**; the official planning matrix lists **2026-12-15** as not ready. Separately, the official TypeScript SDK has **v2** packages. These are distinct version axes, and neither is the JSON-RPC 2.0 message format. [Release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [planning matrix](https://plan.modelcontextprotocol.io/matrix), [protocol overview](https://modelcontextprotocol.io/specification/2026-07-28).

SDK v2 splits `@modelcontextprotocol/sdk` into `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, optional adapters and schema helpers; it requires Node 20+. Installing v2 does not automatically enable modern protocol behavior on manually constructed clients or servers. Modern support is explicit, while `createMcpHandler` can serve both modern and legacy requests. [SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2), [revision migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28), [protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions).

## Changes that matter to this prototype

| Area | Confirmed modern behavior | Practical consequence |
| --- | --- | --- |
| Lifecycle | No `initialize` handshake or protocol session ID; each request declares version and client capabilities. `server/discover` advertises server support. | Ordinary HTTP deployment; keep application state explicit. |
| Transport | Single MCP POST endpoint; JSON responses or request-scoped SSE. Version, method and applicable name headers mirror the body. | Use SDK transport rather than hand-written wire handling. |
| Lists | Deterministic tool order recommended; cache freshness/scope fields added. | Keep tool definitions stable. |
| Interaction | Multi Round-Trip Requests (MRTR) replace independent server-to-client requests. | A tool can return `input_required`; the client obtains input and retries with `inputResponses`. |
| Optional features | MCP Apps and Tasks are extensions; roots, sampling and logging are deprecated. | UI is relevant; long-running tasks and model sampling are unnecessary for the first prototype. |

Sources: [protocol changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).

MRTR is a request/retry interaction pattern, not a general playback push channel. Servers may only request input capabilities the client advertises. Any `requestState` that influences authorization or business behavior needs integrity protection. [MRTR requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).

## ChatGPT compatibility and documentation drift

OpenAI's current plugin extensions documentation explicitly requires MRTR for OpenAI-registered MCP servers and links the 2026-07-28 specification. It also documents global sidebar entrypoints for MCP Apps. This is direct evidence that the modern MRTR profile is relevant to the proposed integration. [OpenAI plugin extensions](https://developers.openai.com/plugins/build/extensions).

However, OpenAI's general MCP server guide still installs `@modelcontextprotocol/sdk`, imports v1 paths and discusses initialization. This conflicts with the modern direction; do not copy its package examples unquestioningly. Modern support in the registered profile does not prove the behavior of every custom/development connection. [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [official SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2).

MCP Apps is the UI extension: a tool references a `ui://` HTML resource, the host renders it in a sandbox, and UI/host communication uses JSON-RPC over `postMessage`. Host support and allowed capabilities vary. The core MCP revision alone does not grant persistent audio, browser storage sharing or background playback. [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview).

## Authentication boundary

Protected MCP uses an OAuth 2.1 resource-server model, protected-resource discovery, audience-bound bearer tokens and authorization on every HTTP request. Client ID Metadata Documents are preferred; Dynamic Client Registration remains for compatibility. Clients validate the authorization issuer where present. Servers must reject unrelated tokens and must not accept or transit tokens intended for other services. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

**DriveBeats inference:** ChatGPT should authenticate to DriveBeats with a DriveBeats-scoped grant. Google Drive access remains a separate authorization boundary; a Google access token is not a ChatGPT-to-MCP credential. Never put access tokens in tool results. Preserve the repository's read-only Drive policy and user-selected Library boundary. [OpenAI tool-result guidance](https://developers.openai.com/plugins/build/mcp-server), [repository rules](../../AGENTS.md), [domain glossary](../../GLOSSARY.md).

## Recommended prototype baseline

Use the modern MCP revision with the official SDK v2 adapter, a narrow set of tools and an MCP App registered as a global sidebar entrypoint. Keep playlist operations and playback commands behind existing DriveBeats service boundaries. This is a proposed direction, not an implementation decision already validated.

Before expanding scope, perform one actual ChatGPT connection acceptance test: discovery, tool listing, one read-only tool, UI launch, authenticated call and MRTR if the selected flow needs it. Introduce legacy compatibility only if that test demonstrates a need. The SDK already provides a path to serve both eras. [SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions).

## Unconfirmed and where checked

- **Exact custom/development ChatGPT protocol negotiation:** inspected OpenAI extensions and MCP build guides; documented modern registered-server requirement and older examples coexist. No live handshake captured.
- **Audio lifetime across sidebar navigation, chat switches, minimization and mobile backgrounding:** inspected MCP core transport and MCP Apps overview. No promise of these behaviors found there; needs host-specific documentation and live testing.
- **Existing DriveBeats authentication compatibility:** no auth source audit in this research subtask; MCP OAuth compatibility must be verified separately.
- **SDK/OpenAI extension package interoperability:** documented APIs inspected, no packages installed or compiled. Pin versions only after the first runnable spike verifies them together.
