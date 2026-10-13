// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";

async function policies() {
  const rules = await nextConfig.headers?.();
  const policy = (source: string) =>
    rules
      ?.find((rule) => rule.source === source)
      ?.headers.find((header) => header.key === "Content-Security-Policy")
      ?.value;
  return {
    global: policy("/(.*)"),
    consent: policy("/mcp/connect"),
    rules,
  };
}

describe("OAuth consent form CSP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows configured HTTPS callback origins only on the consent page", async () => {
    vi.stubEnv(
      "MCP_CLIENT_REDIRECT_URIS",
      "https://chatgpt.com/connector_platform_oauth_redirect,https://chatgpt.com/another-callback",
    );
    const { global, consent, rules } = await policies();
    expect(global).toContain("form-action 'self';");
    expect(global).not.toContain("https://chatgpt.com");
    expect(consent).toBe(
      global?.replace(
        "form-action 'self'",
        "form-action 'self' https://chatgpt.com",
      ),
    );
    expect(
      rules
        ?.filter((rule) =>
          rule.headers.some(
            (header) =>
              header.key === "Content-Security-Policy" &&
              header.value.includes("https://chatgpt.com"),
          ),
        )
        .map((rule) => rule.source),
    ).toEqual(["/mcp/connect"]);
  });

  it.each([
    "",
    "http://attacker.example/callback",
    "javascript:alert(1)",
    "https://user:password@attacker.example/callback",
    "https://attacker.example/callback#fragment",
    "https://chatgpt.com/callback,invalid",
    "http://localhost:46123/callback",
    "http://127.0.0.1:46124/callback",
    "http://127.0.0.1:46123/another-callback",
    "http://127.0.0.1:46123/callback?redirect=elsewhere",
  ])(
    "fails closed for an invalid callback allowlist: %s",
    async (callbacks) => {
      vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", callbacks);
      const { global, consent } = await policies();
      expect(consent).toBe(global);
    },
  );
  it("permits only the registered desktop loopback origin on the consent page", async () => {
    vi.stubEnv(
      "MCP_CLIENT_REDIRECT_URIS",
      "https://chatgpt.com/connector_platform_oauth_redirect,http://127.0.0.1:46123/callback",
    );
    const { global, consent } = await policies();
    expect(global).not.toContain("127.0.0.1");
    expect(consent).toContain(
      "form-action 'self' https://chatgpt.com http://127.0.0.1:46123;",
    );
  });
});
