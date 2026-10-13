// The installed desktop client needs a fixed loopback listener for its
// pre-registered public client. Never permit arbitrary HTTP callbacks.
export const MCP_DESKTOP_CALLBACK = "http://127.0.0.1:46123/callback";

export function isMcpClientCallback(url: URL) {
  if (url.username || url.password || url.hash) return false;
  return url.protocol === "https:" || url.href === MCP_DESKTOP_CALLBACK;
}
