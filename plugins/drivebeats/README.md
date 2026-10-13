# DriveBeats production plugin source

Prepared release: **1.0.0**, display name DriveBeats. The immutable internal package identifier remains
`drivebeats-fixture-player`: the account plugin service rejects renaming an
existing plugin. This compatibility identifier carries no demo behavior.
Update the existing personal/private plugin ID
`plugins_6accdcd7dcd88191a0beba5e3f94eb63`; preserve its ownership and audience.
The production MCP endpoint is `https://www.drivebeats.app/mcp`, with the
preconfigured public OAuth client `drivebeats-chatgpt`.

The baseline scopes are `profile:read`, `library:read`, `library:write`,
`media:read`. Google Drive remains `drive.file` and strictly read-only.
Saved Playlists and favorites can change only through requested DriveBeats
operations; OAuth consent describes those permissions. Existing preview grants
need a new connection to the production issuer. No credential belongs in this
package.

The installed desktop loader requires the compatibility package: include only
`.codex-plugin/plugin.json`, `.mcp.json` and the referenced PNG assets in the
release archive. Portable `plugin.json` and `mcp.json` are source references for
clients supporting that format. Do not include both formats in the desktop
archive. `scripts/verify-plugin.py` checks the exact archive with the bundled
CLI in isolated temporary state, without touching the user's installation.

The sidebar launches `drivebeats_open_player`. Every other data operation stays
separate from UI rendering so tools do not replace the active Audio element.
Anonymous users see the account-connection shell. No sample audio or demo tools
are included. Full Library/catalog/audio/player state stays device-local;
Playlists, favorites and their metadata use the existing cloud account.
DJ Mode requires the host's supported sampling capability and explicit start.

See [production activation](../../docs/mcp/production-release.md) for the exact
configuration, migration and live verification required before release. Source
preparation and loader verification do not constitute a published plugin.
