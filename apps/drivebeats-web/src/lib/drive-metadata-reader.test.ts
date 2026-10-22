import { beforeEach, describe, expect, it, vi } from "vitest";
import { rangeError } from "@/lib/drive-metadata-range-service";
import { readDriveTrackMetadata } from "@/lib/drive-metadata-reader";
import { readGoogleDriveFileRange } from "@/lib/google-api";

vi.mock("@/lib/google-api", () => ({ readGoogleDriveFileRange: vi.fn() }));

function syncsafe(value: number) {
  return [
    (value >>> 21) & 127,
    (value >>> 14) & 127,
    (value >>> 7) & 127,
    value & 127,
  ];
}
function fixture(version: 2 | 3 | 4, artwork = 0) {
  const frame = (id: string, text: string | number) => {
    const bytes =
      typeof text === "number"
        ? Buffer.alloc(text, 1)
        : Buffer.from(`\0${text}`, "binary");
    const header = Buffer.alloc(version === 2 ? 6 : 10);
    header.write(id);
    if (version === 2) header.writeUIntBE(bytes.length, 3, 3);
    else if (version === 4) Buffer.from(syncsafe(bytes.length)).copy(header, 4);
    else header.writeUInt32BE(bytes.length, 4);
    return Buffer.concat([header, bytes]);
  };
  const body = Buffer.concat([
    frame(version === 2 ? "TT2" : "TIT2", "Synthetic title"),
    frame(version === 2 ? "TP1" : "TPE1", "Synthetic artist"),
    frame(version === 2 ? "TAL" : "TALB", "Synthetic album"),
    ...(artwork ? [frame(version === 2 ? "PIC" : "APIC", artwork)] : []),
  ]);
  return Buffer.concat([
    Buffer.from([73, 68, 51, version, 0, 0, ...syncsafe(body.length)]),
    body,
    Buffer.alloc(2 * 1024 * 1024 - body.length - 10),
  ]);
}

function setup(bytes: Uint8Array) {
  const ranges: [number, number][] = [];
  vi.mocked(readGoogleDriveFileRange).mockImplementation(
    async (_id, _token, start, end) => {
      ranges.push([start, end]);
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": String(end - start + 1),
        },
      });
    },
  );
  return {
    ranges,
    options: {
      fileId: "known",
      size: bytes.length,
      accessToken: "test",
      signal: new AbortController().signal,
      requestOptions: {},
      assertCurrent: vi.fn(),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("bounded installed-parser adapter", () => {
  it.each([
    [502, "provider_invalid_response", "transport_error", true],
    [503, "service_unavailable", "metadata_setup_error", true],
    [413, "body_too_large", "transport_error", true],
    [400, "invalid_input", "metadata_setup_error", true],
    [415, "invalid_input", "metadata_setup_error", true],
    [502, "incomplete_range", "transport_error", true],
    [503, "provider_unavailable", "transport_error", true],
    [503, "auth_unavailable", "transport_error", true],
    [504, "timeout", "timeout", true],
    [401, "sign_in_required", "metadata_auth_required", true],
    [401, "account_changed", "metadata_auth_required", true],
    [403, "invalid_origin", "metadata_setup_error", true],
    [403, "permission_denied", "permission_denied", true],
    [404, "not_found", "not_found", true],
    [429, "rate_limited", "rate_limited", true],
    [422, "range_unsupported", "range_unsupported", false],
  ] as const)(
    "maps endpoint %i/%s to %s (retryable=%s)",
    async (status, serverCode, code, retryable) => {
      const { options } = setup(fixture(3));
      vi.mocked(readGoogleDriveFileRange).mockResolvedValue(
        rangeError(serverCode, status),
      );
      await expect(readDriveTrackMetadata(options)).rejects.toMatchObject({
        code,
        retryable,
      });
    },
  );
  it("does not duplicate server authentication refresh on a bare endpoint401", async () => {
    const { options } = setup(fixture(3));
    vi.mocked(readGoogleDriveFileRange).mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    );
    const refresh = vi.fn(async () => "refreshed");
    await expect(
      readDriveTrackMetadata({ ...options, refreshAccessToken: refresh }),
    ).rejects.toMatchObject({
      code: "metadata_auth_required",
      retryable: true,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(readGoogleDriveFileRange).toHaveBeenCalledOnce();
  });
  it.each([2, 3, 4] as const)(
    "extracts ID3v2.%i text with sparse requests",
    async (version) => {
      const { ranges, options } = setup(fixture(version));
      await expect(readDriveTrackMetadata(options)).resolves.toMatchObject({
        status: "ready",
        tags: {
          title: "Synthetic title",
          artist: "Synthetic artist",
          album: "Synthetic album",
        },
      });
      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toEqual([0, 15]);
      expect(ranges[1][0]).toBe(16);
      expect(
        ranges.reduce((bytes, [start, end]) => bytes + end - start + 1, 0),
      ).toBeLessThan(1024);
    },
  );
  it("preserves ID3v2.3 global unsynchronization text while skipping the unused tail probe", async () => {
    const frame = Buffer.alloc(10);
    frame.write("TIT2");
    frame.writeUInt32BE(5, 4);
    const physicalBody = Buffer.concat([
      frame,
      Buffer.from([0, 65, 255, 0, 225, 66]),
    ]);
    const bytes = Buffer.concat([
      Buffer.from([73, 68, 51, 3, 0, 128, ...syncsafe(physicalBody.length)]),
      physicalBody,
      Buffer.alloc(65536),
    ]);
    const { options, ranges } = setup(bytes);
    await expect(readDriveTrackMetadata(options)).resolves.toMatchObject({
      status: "ready",
      tags: { title: "AÿáB" },
    });
    expect(ranges).toHaveLength(2);
    expect(ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0)).toBe(
      10 + physicalBody.length,
    );
  });
  it("reads v1 tail tags without fetching intervening audio", async () => {
    const bytes = Buffer.alloc(65536);
    bytes[0] = 255;
    bytes[1] = 251;
    bytes.write("TAG", bytes.length - 128);
    bytes.write("Legacy title", bytes.length - 125);
    const { ranges, options } = setup(bytes);
    await expect(readDriveTrackMetadata(options)).resolves.toMatchObject({
      status: "ready",
      tags: { title: "Legacy title" },
    });
    expect(ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0)).toBe(144);
  });
  it("reports a plausible MPEG file with no supported tag signature as no target tags", async () => {
    const bytes = Buffer.alloc(65536);
    bytes[0] = 255;
    bytes[1] = 251;
    await expect(
      readDriveTrackMetadata(setup(bytes).options),
    ).resolves.toMatchObject({ status: "no_target_tags" });
  });
  it("does not call malformed bytes tagless", async () => {
    await expect(
      readDriveTrackMetadata(setup(Buffer.alloc(65536)).options),
    ).rejects.toMatchObject({ code: "parse_error" });
  });
  it("accounts for artwork transfer despite text-only parser output, without overlapping ranges", async () => {
    const { ranges, options } = setup(fixture(3, 262144));
    await expect(readDriveTrackMetadata(options)).resolves.toMatchObject({
      status: "ready",
    });
    const total = ranges.reduce(
      (sum, [start, end]) => sum + end - start + 1,
      0,
    );
    expect(total).toBeGreaterThan(262144);
    expect(total).toBeLessThan(263000);
    for (let index = 0; index < ranges.length; index++)
      for (const other of ranges.slice(index + 1))
        expect(ranges[index][1] < other[0] || other[1] < ranges[index][0]).toBe(
          true,
        );
  });
  it("allows an ID3v2 tag at the unchanged one MiB boundary without reserving an unused tail", async () => {
    // The automatic detector used another128bytes and made this legacy budget failure.
    const tagBytes = 1024 * 1024;
    const textFrameBytes =
      10 + Buffer.byteLength("\0Synthetic title", "binary");
    const artistFrameBytes =
      10 + Buffer.byteLength("\0Synthetic artist", "binary");
    const albumFrameBytes =
      10 + Buffer.byteLength("\0Synthetic album", "binary");
    const artworkBytes =
      tagBytes - 10 - textFrameBytes - artistFrameBytes - albumFrameBytes - 10;
    const { options, ranges } = setup(fixture(3, artworkBytes));
    await expect(readDriveTrackMetadata(options)).resolves.toMatchObject({
      status: "ready",
      tags: {
        title: "Synthetic title",
        artist: "Synthetic artist",
        album: "Synthetic album",
      },
    });
    expect(ranges).toHaveLength(2);
    expect(ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0)).toBe(
      tagBytes,
    );
  });
  it("rejects oversized declared tags before downloading their payload", async () => {
    const { options, ranges } = setup(fixture(3, 1200000));
    await expect(readDriveTrackMetadata(options)).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    expect(ranges).toEqual([[0, 15]]);
  });
  it("cancels an unexpected full response immediately", async () => {
    const { options } = setup(fixture(3));
    const cancel = vi.fn();
    vi.mocked(readGoogleDriveFileRange).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { status: 200 }),
    );
    await expect(readDriveTrackMetadata(options)).rejects.toMatchObject({
      code: "transport_error",
      retryable: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects inaccessible or mismatched Content-Range instead of consuming it", async () => {
    const { options } = setup(fixture(3));
    const cancel = vi.fn();
    vi.mocked(readGoogleDriveFileRange).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { status: 206 }),
    );
    await expect(readDriveTrackMetadata(options)).rejects.toMatchObject({
      code: "transport_error",
      retryable: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels a stalled body when its consumer deadline expires", async () => {
    const { options } = setup(fixture(3));
    const controller = new AbortController();
    const cancel = vi.fn();
    vi.mocked(readGoogleDriveFileRange).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 206,
        headers: { "Content-Range": `bytes 0-15/${options.size}` },
      }),
    );
    const job = readDriveTrackMetadata({
      ...options,
      signal: controller.signal,
    });
    setTimeout(
      () => controller.abort(new DOMException("Deadline", "TimeoutError")),
      10,
    );
    await expect(job).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
