// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AppDataError } from "@/db/appdata-control";
import { appDataFailure } from "./appdata-response";
import { applyCollectionCommand } from "./collection-commands";

describe("backup recovery statuses", () => {
  it("rejects a stale playlist edit definitively so replay can recover", async () => {
    let failure: unknown;
    try {
      applyCollectionCommand(
        { playlists: [], favorites: [] },
        { type: "rename", id: "removed-by-peer", name: "Renamed" },
      );
    } catch (error) {
      failure = error;
    }
    const result = appDataFailure(failure);
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({
      code: "appdata_collection_not_found",
    });
  });
  it("routes missing app-folder approval to the required consent gate", async () => {
    const result = appDataFailure(new AppDataError("appdata_access_required"));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({
      code: "appdata_access_required",
    });
  });
  it("does not disclose provider exceptions or credentials", async () => {
    const result = appDataFailure(
      new Error("provider token must stay private"),
    );
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("provider token");
  });
});
