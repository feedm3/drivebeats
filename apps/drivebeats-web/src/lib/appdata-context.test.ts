// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppDataContext } from "./appdata-context";
import { appDataFailure } from "./appdata-response";
import { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_SCOPE } from "./google-scopes";

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  refresh: vi.fn(),
  service: vi.fn(),
}));
vi.mock("@/db/google-oauth-grants", () => ({
  getGoogleOAuthGrant: mocks.grant,
}));
vi.mock("@/lib/server-auth", () => ({
  getServerAuthSession: async () => ({
    user: { id: "account" },
    accountGeneration: "generation",
    grantedScopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.appdata",
    ],
  }),
}));
vi.mock("@/lib/google-grant-encryption", () => ({
  decryptGoogleRefreshToken: () => "opaque-test-refresh",
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
  mocks.grant.mockResolvedValue("encrypted-test-fixture");
  mocks.refresh.mockResolvedValue({
    access_token: "opaque-test-access",
    scope: `${GOOGLE_DRIVE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`,
  });
});
describe("backup grant recovery", () => {
  it.each(["missing", "revoked", "scope"])(
    "requires reconnection for a %s grant",
    async (kind) => {
      if (kind === "missing") mocks.grant.mockResolvedValue(null);
      if (kind === "revoked")
        mocks.refresh.mockResolvedValue({ error: "invalid_grant" });
      if (kind === "scope")
        mocks.refresh.mockResolvedValue({
          access_token: "opaque-test-access",
          scope: GOOGLE_DRIVE_SCOPE,
        });
      const result = await getAppDataContext(user).catch((error) =>
        appDataFailure(error),
      );
      expect((result as Response).status).toBe(403);
      expect(await (result as Response).json()).toMatchObject({
        code: "appdata_access_required",
      });
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
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
});
