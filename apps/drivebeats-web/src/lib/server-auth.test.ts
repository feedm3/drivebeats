// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppDataError } from "@/db/appdata-types";
import { serializeAuthSession } from "@/lib/auth-session";
import { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_SCOPE } from "@/lib/google";
import { getServerAuthSession } from "@/lib/server-auth";

const fixture = vi.hoisted(() => ({
  cookie: "",
  read: vi.fn(),
  assert: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: fixture.cookie }) }),
}));
vi.mock("@/db/appdata-control", () => ({
  getAppDataAccount: fixture.read,
  assertAppDataIdentity: fixture.assert,
}));
const user = {
  id: "account-a",
  email: "a@example.test",
  name: null,
  picture: null,
};
const active = { generation: "current", state: "active", source: "drive" };
beforeEach(() => {
  vi.stubEnv("AUTH_SESSION_SECRET", "test-secret");
  fixture.cookie = serializeAuthSession({
    user,
    accountGeneration: "current",
    grantedScopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_APPDATA_SCOPE],
  });
  fixture.assert.mockReset().mockResolvedValue(active);
  fixture.read.mockReset().mockResolvedValue(active);
});
afterEach(() => vi.unstubAllEnvs());

it("requires both signed scopes and completed migration for ordinary APIs", async () => {
  expect(await getServerAuthSession()).toMatchObject({ user });
  fixture.assert.mockResolvedValueOnce({ ...active, source: "migrating" });
  expect(await getServerAuthSession()).toBeNull();
  fixture.cookie = serializeAuthSession({
    user,
    accountGeneration: "current",
    grantedScopes: [GOOGLE_DRIVE_SCOPE],
  });
  expect(await getServerAuthSession()).toBeNull();
  expect(await getServerAuthSession({ allowIncomplete: true })).toMatchObject({
    user,
  });
});
it("permits cleanup retry for a deleting account but never a stale or deleted incarnation", async () => {
  fixture.read.mockResolvedValueOnce({ ...active, state: "deleting" });
  expect(await getServerAuthSession({ allowIncomplete: true })).toMatchObject({
    user,
  });
  fixture.read.mockResolvedValueOnce({ ...active, generation: "replacement" });
  expect(await getServerAuthSession({ allowIncomplete: true })).toBeNull();
  fixture.read.mockResolvedValueOnce({ ...active, state: "deleted" });
  expect(await getServerAuthSession({ allowIncomplete: true })).toBeNull();
});
it("makes legacy sessions reconnect without initializing accounts from a stale cookie", async () => {
  fixture.cookie = serializeAuthSession({
    user,
    grantedScopes: [GOOGLE_DRIVE_SCOPE],
  });
  expect(await getServerAuthSession()).toBeNull();
  expect(await getServerAuthSession({ allowIncomplete: true })).toMatchObject({
    user,
  });
  expect(fixture.assert).not.toHaveBeenCalled();
  expect(fixture.read).not.toHaveBeenCalled();
});

it("preserves signed rendering identity during a control outage without authorizing ordinary APIs", async () => {
  fixture.read.mockRejectedValueOnce(
    new AppDataError("appdata_control_unavailable"),
  );
  expect(await getServerAuthSession({ allowIncomplete: true })).toMatchObject({
    user,
    accountGeneration: "current",
  });
  fixture.assert.mockRejectedValueOnce(
    new AppDataError("appdata_control_unavailable"),
  );
  await expect(getServerAuthSession()).rejects.toMatchObject({
    code: "appdata_control_unavailable",
  });
});
it("still rejects authoritative stale identity instead of disguising it as an outage", async () => {
  fixture.assert.mockRejectedValueOnce(
    new AppDataError("appdata_stale_session"),
  );
  expect(await getServerAuthSession()).toBeNull();
});
