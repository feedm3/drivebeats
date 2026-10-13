# DriveBeats MCP todo

Build a private ChatGPT plugin with the shared DriveBeats UI, full imported Library search/browsing, normal playback, synced Playlists, requested AI actions, and optional DJ Mode.

Each task has an execution brief. A fresh agent can receive: **“Implement task 1 from docs/mcp-todo.md.”** Read [execution context](mcp/context.md), then the linked task; previous chat history is unnecessary. Implement only the assigned task and report its completion criteria individually.

| Status | Task | Execution brief | Prerequisite |
| --- | --- | --- | --- |
| [ ] | 1. Create the monorepo (implemented locally; acceptance pending) | [Task 1](mcp/tasks/01-monorepo.md) | None; no unresolved plugin decision blocks it |
| [x] | 2. Basic MCP App and host/audio test (preview/private plugin and real-host playback accepted) | [Task 2](mcp/tasks/02-basic-mcp-app.md) | Task 1 local checks passed |
| [ ] | 3. Account linking (implemented locally; live acceptance pending) | [Task 3](mcp/tasks/03-account-linking.md) | Task 2 real ChatGPT/audio evidence recorded |
| [ ] | 4. Shared music functionality | [Task 4](mcp/tasks/04-music-functionality.md) | Task 3 real account/Drive read verified |

Task 4 can also be assigned as **4a**, **4b**, **4c**, or **4d**; its brief states dependencies and acceptance checks for each slice.

Task 1's local migration and checks passed, and its Vercel Root Directory is updated and verified. Real-account manual checks remain open in its execution notes, so its acceptance checkbox stays open. Task 2 has a deployed preview/private plugin, passing checks, and real-host playback accepted by the user; detailed background continuity is not guaranteed. Task 3 is implemented and locally verified; remote configuration, migrations and real ChatGPT/Drive acceptance remain pending. Task 4 is unstarted. Updating this plan does not authorize deployment, secret exports, plugin installation, commits, or pushing. Follow the user's authorization when the implementation task is assigned and the repository's existing remote-action rules.

Research: [plugin architecture](research/chatgpt-plugin-prototype.md), [modern MCP baseline](research/mcp-2-prototype-baseline.md). Task briefs own the execution sequence; research notes supply evidence and limitations.
