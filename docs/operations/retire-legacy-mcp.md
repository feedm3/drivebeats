# Legacy MCP table retirement

## Executed on 31 October 2026

The user confirmed the current application was deployed and explicitly
authorized deletion of the eight legacy MCP tables. The remote MCP integration
and its table-query modules were removed in `213fef8` on 14 October, when browser
WebMCP replaced them. Repository inspection found no current runtime consumers.

Migration `0015_retire_legacy_mcp.sql` was applied to Neon project
`old-night-81938469` (`drivebeats`), production branch `br-rapid-mud-agwwmwmp`,
database `neondb`. Read-only verification at 17:21:59 Europe/Berlin
(16:21:59 UTC) confirmed no `mcp_*` tables remain in the public schema.

The explicit drop allowlist was:

- `mcp_authorization_codes`
- `mcp_refresh_tokens`
- `mcp_link_requests`
- `mcp_media_grants`
- `mcp_music_commands`
- `mcp_music_imports`
- `mcp_music_sessions`
- `mcp_grants`

The transaction used a five-second lock timeout, a thirty-second statement
timeout and `RESTRICT`. Preflight found no foreign keys from outside the
allowlist, dependent views or public function bodies mentioning these tables.
The exact migration was rehearsed on isolated branch `br-cold-sunset-agsf4uvk`;
the migration tool deleted that temporary branch after production execution.

Row counts in all seven retained tables matched before and after both rehearsal
and production execution: `users`, `google_oauth_grants`, `appdata_accounts`,
`appdata_operations`, `appdata_rollout`, `appdata_upload_attempts` and
`appdata_recovery_audit`. No Google Drive files were changed.

The MCP preservation instructions in the historical collection-retirement
procedure applied to that separate operation. This later authorization retires
only the eight tables listed above. Applied migrations `0007` through `0009`
remain unchanged; `0015` records their later retirement.

## Recovery and verification limits

Recovery snapshot `snap-mute-dew-aguhy5y2` was created before this operation with
an expiry of 31 October 2026 at 23:30 Europe/Berlin (22:30 UTC), now in the past.
Production's configured history retention was six hours. Recheck current recovery
availability before attempting a restore. Recover on an isolated branch and
review any selective correction before writing to production; a whole-database
rollback could overwrite subsequent app-data saves. Do not roll back to the old
remote MCP integration against the retired schema.

`pnpm test` passed all 954 tests after repairing missing local dependencies with
`pnpm install --frozen-lockfile`. `pnpm lint` and `pnpm build` passed. Lint
reported existing configuration deprecation, broken-symlink and asset-size
warnings. The production homepage returned HTTP 200 after execution.

Authenticated browser verification was not performed: local browser access was
disabled in Work settings. Google sign-in, Drive import, player controls and
WebMCP calls were not manually exercised after deletion. The homepage response
alone does not establish those flows.

## Review on 3 November 2026

A read-only table inventory of the recorded production branch confirmed the
eight legacy MCP tables are absent and all seven retained tables listed above
are present. This review did not independently reproduce the historical row
counts, snapshot creation or execution timestamp recorded above.

A disposable PGlite rehearsal against migrations `0001` through `0013` verified
that an external dependent view blocks retirement atomically. Without that
dependency, the migration removed all eight tables, preserved the seven retained
tables and a synthetic account, and succeeded on a second execution. No SQL was
applied to production during this review. Local synthetic browser checks covered
WebMCP queue ownership and pagination; fresh Google sign-in, Drive import and
audible playback were not rechecked.
