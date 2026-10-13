# DriveBeats private preview plugin

Source package for the existing personal/private DriveBeats plugin:
`plugins_6accdcd7dcd88191a0beba5e3f94eb63`.

The internal package name remains `drivebeats-fixture-player`; the display name
is DriveBeats. Portable and compatibility manifests are synchronized. The logo
is the existing website's 192px PNG. Account updates preserve the plugin's
identity, audience and existing assets.

The stable preview MCP URL is
`https://drivebeats-mcp-preview-fabian.vercel.app/mcp`. `mcp.json` declares
mixed anonymous/OAuth access with a provided public client, PKCE and no client
secret. The baseline scopes are `profile:read`, `library:read`, `media:read`.
No credential belongs in this package.

Publishing is a guarded update of the existing plugin, not creation or public
submission. Read the current files/release first, package the changed files,
and pass that release to Plugin Creator's `update_plugin`. Omitted files remain
intact. Verify the saved package and the actual installed host separately.

Backend configuration and live acceptance are documented in
[account linking](../../docs/mcp/account-linking.md) and
[task 3](../../docs/mcp/tasks/03-account-linking.md).
