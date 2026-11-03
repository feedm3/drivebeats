-- The remote MCP integration was replaced by browser WebMCP in 213fef8.
-- User-authorized retirement on 31 October 2026. Preserve applied migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- One explicit allowlist. RESTRICT rejects dependencies outside this set.
DROP TABLE IF EXISTS
  public.mcp_authorization_codes,
  public.mcp_refresh_tokens,
  public.mcp_link_requests,
  public.mcp_media_grants,
  public.mcp_music_commands,
  public.mcp_music_imports,
  public.mcp_music_sessions,
  public.mcp_grants
RESTRICT;

COMMIT;
