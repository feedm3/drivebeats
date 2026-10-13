# DriveBeats private preview plugin

Source package for the existing personal/private DriveBeats plugin:
`plugins_6accdcd7dcd88191a0beba5e3f94eb63`.

The internal package name remains `drivebeats-fixture-player`; the display name
is DriveBeats. Presentation and version metadata are synchronized. The logo is
the existing website's 192px PNG. Account updates preserve the plugin's
identity, audience and existing assets.

The stable preview MCP URL is
`https://drivebeats-mcp-preview-fabian.vercel.app/mcp`. `mcp.json` declares
mixed anonymous/OAuth access with a provided public client, PKCE and no client
secret. The baseline scopes are `profile:read`, `library:read`, `media:read`.
No credential belongs in this package.

## Installed desktop compatibility

The installed desktop CLI `0.162.0-alpha.17.2` rejects the portable MCP server's
`extensions` field. Keeping portable `plugin.json` also prevents fallback to
`.mcp.json`; removing only the unsupported fields drops the provided OAuth
client and incorrectly attempts dynamic registration.

The private release therefore uses only `.codex-plugin/plugin.json`,
`.mcp.json` and packaged PNG assets. Both presentation references use
`assets/drivebeats-icon.png`; the previous asset remains in saved releases.
The portable files remain repository
references for clients supporting the current format; exclude them from this
release archive and remove the old portable files from the saved release with
Plugin Creator's guarded `delete_paths`. The legacy MCP config declares the
same provided public client and a fixed desktop loopback listener at
`http://127.0.0.1:46123/callback`. The server must explicitly allow that exact
callback alongside the existing HTTPS ChatGPT callback. It still requires
S256 PKCE, issuer/resource binding and the same scoped grants.

Verify the package with the actual desktop binary before publishing. Schema
validation alone did not catch this incompatibility. The server also supports
the desktop's `2025-06-18` handshake through the MCP SDK's stateless adapter,
preserving security declarations for both legacy SSE and modern JSON responses.

Publishing is a guarded update of the existing plugin, not creation or public
submission. Read the current files/release first, package the changed files,
and pass that release to Plugin Creator's `update_plugin`. Omitted files remain
intact unless explicitly deleted; omitting the portable files from the ZIP is
insufficient. Verify the saved package and the actual installed host separately.

Backend configuration and live acceptance are documented in
[account linking](../../docs/mcp/account-linking.md) and
[task 3](../../docs/mcp/tasks/03-account-linking.md).
