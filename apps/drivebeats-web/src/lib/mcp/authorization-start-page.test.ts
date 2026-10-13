import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORIZATION_START_CSP,
  renderMcpAuthorizationStartPage,
} from "./authorization-start-page";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = "";
});
function mount(
  authorizationUrl: string,
  googleUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=google&state=provider-state",
) {
  document.documentElement.innerHTML = renderMcpAuthorizationStartPage(
    authorizationUrl,
    googleUrl,
  );
  const field = document.querySelector<HTMLTextAreaElement>("#connection-link");
  const button = document.querySelector<HTMLButtonElement>("#copy-link");
  const script = document.querySelector("script")?.textContent;
  if (!field || !button || !script)
    throw new Error("Incomplete authorization page");
  return { field, button, script };
}

describe("authorization start landing page", () => {
  it("escapes selectable URLs and Google href without introducing executable markup", () => {
    const hostile =
      'https://drivebeats.example/api/mcp/oauth/authorize?state=</textarea><script>alert("x")</script>&test="<&';
    const google =
      'https://accounts.google.com/o/oauth2/v2/auth?state=" onmouseover="bad"&nonce=<nonce>';
    const { field } = mount(hostile, google);
    expect(field.value).toBe(hostile);
    expect(field.readOnly).toBe(true);
    expect(
      document.querySelector("#continue-google")?.getAttribute("href"),
    ).toBe(google);
    expect(
      document.querySelector("#continue-google")?.hasAttribute("onmouseover"),
    ).toBe(false);
    expect(document.querySelectorAll("script")).toHaveLength(1);
  });
  it("permits only the fixed copy script by hash, without unsafe-inline script", () => {
    const { script } = mount(
      "https://drivebeats.example/api/mcp/oauth/authorize?state=host-state",
    );
    const digest = createHash("sha256").update(script).digest("base64");
    expect(AUTHORIZATION_START_CSP).toContain(`script-src 'sha256-${digest}'`);
    expect(AUTHORIZATION_START_CSP).not.toContain("script-src 'unsafe-inline'");
    expect(AUTHORIZATION_START_CSP).toContain("default-src 'none'");
  });
  it("copies the original request, not the provider continue URL", async () => {
    const original =
      "https://drivebeats.example/api/mcp/oauth/authorize?state=host-state&code_challenge=pkce";
    const { button, script } = mount(original);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    // Exercise the shipped static script against the same browser DOM nodes.
    new Function(script)();
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#copy-status")?.textContent).toContain(
        "Link copied",
      ),
    );
    expect(writeText).toHaveBeenCalledWith(original);
  });
  it("selects the visible link with useful fallback if clipboard permission fails", async () => {
    const { field, button, script } = mount(
      "https://drivebeats.example/api/mcp/oauth/authorize?state=host-state",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    new Function(script)();
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#copy-status")?.textContent).toContain(
        "Select and copy",
      ),
    );
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});
