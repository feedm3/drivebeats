// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppDataContext } from "./appdata-context";
import { appDataFailure } from "./appdata-response";
import { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_SCOPE } from "./google-scopes";

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  refresh: vi.fn(),
  service: vi.fn(),
  decryptSession: vi.fn(),
  session: {
    user: { id: "account" },
    accountGeneration: "generation",
    sessionId: undefined as string | undefined,
    grantedScopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.appdata",
    ],
  },
  sessionGrant: undefined as string | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "google_appdata_grant" && mocks.sessionGrant !== undefined
        ? { value: mocks.sessionGrant }
        : undefined,
  }),
}));
vi.mock("@/db/google-oauth-grants", () => ({
  getGoogleOAuthGrant: mocks.grant,
}));
vi.mock("@/lib/server-auth", () => ({
  getServerAuthSession: async () => mocks.session,
}));
vi.mock("@/lib/google-grant-encryption", () => ({
  GOOGLE_SESSION_GRANT_COOKIE: "google_appdata_grant",
  decryptGoogleRefreshToken: () => "opaque-test-refresh",
  decryptSessionGoogleGrant: mocks.decryptSession,
}));
vi.mock("@/lib/google", async () => ({
  ...(await import("./google-scopes")),
  refreshAccessToken: mocks.refresh,
}));
vi.mock("@/lib/drive-appdata-service", () => ({
  getDriveAppDataService: mocks.service,
}));
const user = {
  id: "account",
  email: "test@example.com",
  name: null,
  picture: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionGrant = undefined;
  mocks.session.sessionId = undefined;
  mocks.decryptSession.mockReturnValue("opaque-session-refresh");
  mocks.grant.mockResolvedValue("encrypted-test-fixture");
  mocks.refresh.mockResolvedValue({
    access_token: "opaque-test-access",
    scope: `${GOOGLE_DRIVE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`,
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("backup grant recovery", () => {
  it.each(["missing", "revoked", "other-client", "scope"])(
    "recovers the browser connection for a %s legacy saved grant",
    async (kind) => {
      if (kind === "missing") mocks.grant.mockResolvedValue(null);
      if (kind === "revoked")
        mocks.refresh.mockResolvedValue({ error: "invalid_grant" });
      if (kind === "other-client")
        mocks.refresh.mockResolvedValue({ error: "unauthorized_client" });
      if (kind === "scope")
        mocks.refresh.mockResolvedValue({
          access_token: "opaque-test-access",
          scope: GOOGLE_DRIVE_SCOPE,
        });
      const result = await getAppDataContext(user).catch((error) =>
        appDataFailure(error),
      );
      expect((result as Response).status).toBe(503);
      expect(await (result as Response).json()).toMatchObject({
        code: "appdata_connection_recovery_required",
      });
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it("keeps the verified session connected when another client replaces the saved grant", async () => {
    mocks.sessionGrant = "encrypted-session-fixture";
    mocks.refresh.mockImplementation(async (token) =>
      token === "opaque-session-refresh"
        ? { access_token: "session-access" }
        : { error: "unauthorized_client" },
    );
    await getAppDataContext(user);
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith("opaque-session-refresh");
    expect(mocks.service).toHaveBeenCalledWith("session-access");
  });
  it("rejects an unreadable session grant without falling back to another connection", async () => {
    mocks.sessionGrant = "wrong-session-grant";
    mocks.decryptSession.mockImplementation(() => {
      throw new Error("unreadable");
    });
    const response = (await getAppDataContext(user).catch(
      appDataFailure,
    )) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "appdata_connection_recovery_required",
    });
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["network", "provider"])(
    "preserves consent for a temporary %s failure",
    async (kind) => {
      if (kind === "network")
        mocks.refresh.mockRejectedValue(new TypeError("offline"));
      else
        mocks.refresh.mockResolvedValue({ error: "temporarily_unavailable" });
      const result = await getAppDataContext(user).catch((error) =>
        appDataFailure(error),
      );
      expect((result as Response).status).toBe(503);
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );

  it("preserves a queued collection edit through failed startup replay until the browser grant recovers", async () => {
    const storage: Record<string, string> = {};
    Object.defineProperties(storage, {
      getItem: { value: (key: string) => storage[key] ?? null },
      setItem: {
        value: (key: string, value: string) => {
          storage[key] = value;
        },
      },
      removeItem: {
        value: (key: string) => {
          delete storage[key];
        },
      },
    });
    vi.stubGlobal("window", {
      localStorage: storage,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, action: () => unknown) => action(),
      },
    });
    const { useDriveAppDataStore } = await import(
      "@/stores/drive-appdata-store"
    );
    useDriveAppDataStore.setState({
      accountId: "account",
      generation: "generation",
      status: "restoring",
    });
    mocks.refresh.mockImplementation(async (token) =>
      token === "opaque-session-refresh"
        ? { access_token: "session-access" }
        : { error: "unauthorized_client" },
    );
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      try {
        await getAppDataContext(user);
        return Response.json(
          init?.method ? { ok: true } : { playlists: [], favorites: [] },
        );
      } catch (error) {
        return appDataFailure(error);
      }
    });
    vi.stubGlobal("fetch", fetcher);
    const api = await import("./cloud-library-api");
    await expect(
      api.renameCloudPlaylist("playlist", "Preserved edit"),
    ).rejects.toThrow();
    expect(Object.keys(storage)).toHaveLength(1);
    const [key] = Object.keys(storage);
    const queued = storage[key];
    await expect(api.fetchCloudLibrarySync()).rejects.toThrow();
    expect(storage[key]).toBe(queued);
    mocks.sessionGrant = "recovered-session-grant";
    expect(await api.fetchCloudLibrarySync()).toEqual({
      playlists: [],
      favorites: [],
    });
    expect(Object.keys(storage)).toHaveLength(0);
    const writes = fetcher.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(writes).toHaveLength(3);
    expect(
      new Set(
        writes.map(([, init]) =>
          new Headers(init?.headers).get("X-DriveBeats-Operation"),
        ),
      ).size,
    ).toBe(1);
  });

  it.each(["invalid_grant"])(
    "requires reconnection for a rejected current session grant (%s)",
    async (error) => {
      mocks.sessionGrant = "bound-grant";
      mocks.refresh.mockResolvedValue({ error });
      const response = (await getAppDataContext(user).catch(
        appDataFailure,
      )) as Response;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "appdata_access_required",
      });
    },
  );
  it("keeps a bound connection retryable when Google rejects the OAuth client", async () => {
    mocks.sessionGrant = "bound-grant";
    mocks.refresh.mockResolvedValue({ error: "unauthorized_client" });
    const response = (await getAppDataContext(user).catch(
      appDataFailure,
    )) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "appdata_provider_unavailable",
    });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([undefined, "current-sign-in"])(
    "passes the verified identity binding when reading a grant (%s)",
    async (sessionId) => {
      mocks.session.sessionId = sessionId;
      mocks.sessionGrant = "bound-grant";
      await getAppDataContext(user);
      expect(mocks.decryptSession).toHaveBeenCalledWith(
        "bound-grant",
        "account",
        sessionId ?? "legacy",
      );
    },
  );
});
