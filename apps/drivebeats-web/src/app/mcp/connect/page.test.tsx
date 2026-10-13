import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getMcpConsentSession } from "@/lib/mcp/oauth-service";
import McpConnectPage from "./page";

vi.mock("@/lib/mcp/oauth-service", () => ({ getMcpConsentSession: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows verified identity and requested access with bound consent choices", async () => {
  vi.mocked(getMcpConsentSession).mockResolvedValue({
    profile: {
      id: "account",
      name: "Alex",
      email: "alex@example.test",
      picture: null,
    },
    scopes: ["profile:read", "library:read", "library:write", "media:read"],
    csrf: "request-bound-csrf",
  });
  const { container } = render(await McpConnectPage());
  expect(screen.getByText("alex@example.test")).toBeInTheDocument();
  expect(screen.getByText(/Read your imported Library/)).toBeInTheDocument();
  expect(
    screen.getByText(/Save Playlists and update favorites/),
  ).toBeInTheDocument();
  expect(container.querySelector("form")).toHaveAttribute(
    "action",
    "/api/mcp/oauth/authorize",
  );
  expect(container.querySelector('input[name="csrf"]')).toHaveValue(
    "request-bound-csrf",
  );
  expect(
    screen.getByRole("button", { name: "Allow connection" }),
  ).toHaveAttribute("value", "approve");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
    "value",
    "cancel",
  );
});
it.each([null, new Error("credential_do_not_expose")])(
  "asks to reconnect missing or failed consent safely: %s",
  async (value) => {
    if (value instanceof Error)
      vi.mocked(getMcpConsentSession).mockRejectedValue(value);
    else vi.mocked(getMcpConsentSession).mockResolvedValue(value);
    const { container } = render(await McpConnectPage());
    expect(
      screen.getByRole("heading", { name: "Start your connection again" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Return to ChatGPT/)).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("credential_do_not_expose");
  },
);
