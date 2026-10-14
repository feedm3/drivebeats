# WebMCP browser control

Checked 14 October 2026. This note concerns tools on the ordinary DriveBeats website.

## Verified host support

OpenAI documents Site tools as WebMCP support in the ChatGPT desktop built-in browser. Open the website there, sign in normally, and ask ChatGPT Work or Codex to act on the same page/session. No separate integration connection is needed. The address bar's Site tools menu lists registrations. Closing or navigating away can remove them.

Current documentation names GPT-5.6 Sol and GPT-6 Sol; GPT-5.6 Luna is disabled. Enterprise needs admin policy approval; Edu is unavailable. Rollout, browser permission and current page tools also affect availability. Older changelog entries differ, so the current Site tools page is the authority here.

ChatGPT discovers top-level JavaScript registrations. It does not discover declarative HTML tools or tools in iframes. Calls receive host safety review; website annotations do not authorize actions. [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp)

## Current registration and result contract

The 13 October draft exposes `document.modelContext` in secure contexts. It is a Community Group draft, not a W3C Standard.

- `registerTool(tool, { signal })` returns `Promise<void>`. Abort that registration signal to remove its tool. The current interface has no `unregisterTool`, `provideContext` or `requestUserInteraction` method.
- Required descriptor fields: `name`, `description`, `execute`. `inputSchema` is a JSON Schema object; optional annotations are `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`.
- `execute(input, { signal })` receives parsed input and cancellation options. Return a JSON-serializable value; an MCP `content` envelope is unnecessary.
- The browser serializes results. Rejected callbacks/unserializable results become `OperationError`; invalid input becomes `DataError`; missing tools become `NotFoundError`; document unloading becomes `AbortError`. Application failures can instead be expressed in result JSON.
- Duplicate/invalid registrations reject. Inputs must still be validated by the application; schema validation is not guaranteed.

The draft specifies no user-activation guarantee for tool execution. [WebMCP specification](https://webmachinelearning.github.io/webmcp/)

Chrome's guide independently documents AbortSignal registration cleanup, cancellation and plain results. Feature-detect the browser API; use the current document entry point rather than older navigator examples. Chrome origin-trial/flag access is distinct from ChatGPT Site tools. [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp)

## DriveBeats implementation recommendations

Register a small static tool set from a client component on the top-level app page. Each execution should read current application state rather than capture login, Library or Playback Queue snapshots. Reuse existing stores and services so tools and touch controls operate the same player, account and Library.

Use narrow object schemas, bounded numbers and strings, and application-side validation. Return plain structured values such as `{ ok: true, player: ... }` or `{ ok: false, code: "sign_in_required", message: ... }`. Describe actual side effects. Do not expose tokens, audio URLs or unrestricted Drive file access. Existing server authorization remains authoritative. Unsupported browsers continue to use the normal UI.

Await registration and report unexpected failures. Remove registrations on component cleanup with an AbortController; serialize cleanup/re-registration if the actual host needs it to avoid duplicate names during React development remounts. Do not install a fake API/polyfill that makes an unsupported host appear supported.

Keep authentication and Drive import as ordinary website interactions. Expose searches/selection only over the user's existing Library; avoid introducing arbitrary Drive traversal or writes. Read-only data tools may contain user-provided filenames, so use `untrustedContentHint` where appropriate.

Google recommends static registration by default, small non-overlapping tool sets, code validation, descriptive failures and UI state updates before claiming completion. [Chrome best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)

## Playback and remaining verification

Audible playback can be blocked by browser autoplay policy. Check the promise from `HTMLMediaElement.play()` and the real player state; request a tap on the website if activation is required. Changing a store's `isPlaying` flag does not prove audio started. [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay/)

Local browser verification on 14 October: the installed in-app browser discovered all eight DriveBeats tools on localhost. Native tool calls returned live signed-out status and `sign_in_required` for Library Search and player control. Reload and ordinary page navigation retained exactly eight registrations. A temporary native registration probe confirmed AbortSignal removes its tool; the probe was then removed. No Google account or cloud data was changed.

Still unconfirmed: this account/model's production rollout eligibility, execution cancellation in the host, whether Site tools invocation grants media activation, Google sign-in, Drive import, audible playback, and cross-session sync inside that browser. Checked official OpenAI docs, the current WebMCP draft, Chrome developer guidance and the installed browser. These require signed-in acceptance on the deployed website.

Acceptance: open DriveBeats in ChatGPT's browser, inspect Available site tools, sign in and import audio normally, call a Library search, select a result, observe real playback and pause/seek/queue changes, then navigate/reload and confirm tools are re-discovered without duplicate registrations. Check a signed-out call and a fresh-session blocked-playback call produce truthful results.
