// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getServerAuthSession: mocks.auth }));
// A retired endpoint must remain usable even after the old table is removed.
vi.mock("@/db/client", () => ({
  getSql: () => {
    throw new Error("No database access permitted");
  },
}));

beforeEach(() => vi.resetAllMocks());
describe("retired legacy tag upload", () => {
  it("acknowledges old clients without parsing or persisting private tags", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "account" } });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, retired: true });
  });
  it("still requires an authenticated session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
  });
});
