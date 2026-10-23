// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAppDataCommand } from "./appdata-request";
import { appDataFailure } from "./appdata-response";

const input = () => ({
  generation: "generation",
  operationId: "remove-root",
  kind: "roots",
  baseRevision: 4,
  payload: { operations: [{ type: "remove", rootKind: "folder", id: "root" }] },
});
const request = (body: unknown) =>
  new Request("http://localhost/api/appdata", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("public portable backup commands", () => {
  it("accepts root intent after matching the signed incarnation", async () => {
    const command = await readAppDataCommand(request(input()), "generation");
    expect(command).toEqual({
      operationId: "remove-root",
      kind: "roots",
      baseRevision: 4,
      payload: input().payload,
    });
    await expect(
      readAppDataCommand(request(input()), "other-generation"),
    ).rejects.toThrow("appdata_invalid_request");
  });
  it("rejects client-forged compaction revisions and collection snapshot writes", async () => {
    const forged = input();
    Object.assign(forged.payload.operations[0], { sourceRevision: 1000 });
    await expect(
      readAppDataCommand(request(forged), "generation"),
    ).rejects.toThrow("appdata_invalid_request");
    await expect(
      readAppDataCommand(
        request({
          ...input(),
          kind: "collections",
          payload: { playlists: [], favorites: [] },
        }),
        "generation",
      ),
    ).rejects.toThrow("appdata_invalid_request");
  });
  it("rejects malformed bodies with a definitive validation response", async () => {
    for (const body of [
      null,
      [],
      { ...input(), payload: { operations: "forged" } },
    ]) {
      const failure = await readAppDataCommand(
        request(body),
        "generation",
      ).catch((error) => appDataFailure(error));
      expect(failure).toBeInstanceOf(Response);
      expect((failure as Response).status).toBe(400);
    }
  });
  it("cancels an oversized stream before parsing or accepting its command", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const incoming = { body } as Request;
    const failure = await readAppDataCommand(incoming, "generation").catch(
      (error) => appDataFailure(error),
    );
    expect((failure as Response).status).toBe(413);
    expect(cancelled).toBe(true);
  });
});
