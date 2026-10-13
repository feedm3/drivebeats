// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpGrant } from "@/db/mcp-grants";
import { getMcpGoogleAccessToken } from "./auth";
import { completeMcpImportSelection } from "./import-selection-service";
import {
  consumeMcpMusicImport,
  getMcpMusicImport,
} from "./music-session-service";

vi.mock("@/db/mcp-grants", () => ({ getMcpGrant: vi.fn() }));
vi.mock("./auth", () => ({ getMcpGoogleAccessToken: vi.fn() }));
vi.mock("./music-session-service", () => ({
  consumeMcpMusicImport: vi.fn(),
  getMcpMusicImport: vi.fn(),
}));
const capability = "a".repeat(43);
const user = {
  id: "account",
  email: "music@example.com",
  name: null,
  picture: null,
};
const fetchMock = vi.fn();
function request(
  ids = ["folder", "track"],
  origin = "https://www.drivebeats.app",
) {
  return new Request(
    `https://www.drivebeats.app/api/mcp/import/${capability}`,
    {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ fileIds: ids }),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getMcpMusicImport).mockResolvedValue({ grantId: "grant" } as never);
  vi.mocked(getMcpGrant).mockResolvedValue({
    id: "grant",
    googleUserId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    profile: user,
    scopes: ["library:read"],
  } as never);
  vi.mocked(getMcpGoogleAccessToken).mockResolvedValue(
    "private-provider-token",
  );
  fetchMock.mockImplementation(async (url: URL) => {
    const id = url.pathname.split("/").at(-1);
    return Response.json({
      id,
      name: id === "folder" ? "Music" : "Music.mp3",
      mimeType:
        id === "folder" ? "application/vnd.google-apps.folder" : "audio/mpeg",
    });
  });
});
describe("explicit Picker import handoff", () => {
  it("rejects signed-out and cross-origin submissions before data access", async () => {
    expect(
      (await completeMcpImportSelection(request(), capability, null)).status,
    ).toBe(401);
    expect(
      (
        await completeMcpImportSelection(
          request(undefined, "https://attacker.example"),
          capability,
          user,
        )
      ).status,
    ).toBe(403);
    expect(getMcpMusicImport).not.toHaveBeenCalled();
  });
  it("verifies all selected metadata and consumes only the bounded import once", async () => {
    const response = await completeMcpImportSelection(
      request(),
      capability,
      user,
    );
    expect(response.status).toBe(200);
    expect(consumeMcpMusicImport).toHaveBeenCalledWith(capability, user.id, {
      importedFolderIds: ["folder"],
      standaloneTrackIds: ["track"],
    });
    expect(await response.text()).not.toContain("private-provider-token");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("rejects another account, revoked grants and inaccessible selections without publishing roots", async () => {
    vi.mocked(getMcpGrant).mockResolvedValueOnce({
      googleUserId: "other",
    } as never);
    expect(
      (await completeMcpImportSelection(request(), capability, user)).status,
    ).toBe(409);
    fetchMock.mockResolvedValue(
      Response.json({ error: "denied" }, { status: 404 }),
    );
    expect(
      (await completeMcpImportSelection(request(), capability, user)).status,
    ).toBe(409);
    expect(consumeMcpMusicImport).not.toHaveBeenCalled();
  });
  it("rejects trashed files and unsupported content instead of silently adding it", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "track",
        name: "Music.mp3",
        mimeType: "audio/mpeg",
        trashed: true,
      }),
    );
    expect(
      (await completeMcpImportSelection(request(["track"]), capability, user))
        .status,
    ).toBe(409);
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "track", name: "Notes.txt", mimeType: "text/plain" }),
    );
    expect(
      (await completeMcpImportSelection(request(["track"]), capability, user))
        .status,
    ).toBe(422);
    expect(consumeMcpMusicImport).not.toHaveBeenCalled();
  });
});
