import type { DriveRequestOptions } from "@/lib/drive-request-scheduler";
import { readGoogleDriveFileRange } from "@/lib/google-api";
import type { MetadataOutcome } from "@/lib/metadata-cache-types";

export class MetadataReadError extends Error {
  constructor(
    public code: string,
    public retryable = false,
  ) {
    super(code);
    this.name = "MetadataReadError";
  }
}

export function metadataEnvironmentKey() {
  return typeof location === "undefined"
    ? "server"
    : `${location.origin}:${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}:same-origin-range-v1`;
}

interface RangeReaderOptions {
  fileId: string;
  size: number;
  accessToken: string;
  signal: AbortSignal;
  requestOptions: DriveRequestOptions;
  assertCurrent: () => void;
  maxBytes?: number;
  maxRequests?: number;
  refreshAccessToken?: () => Promise<string | null>;
}

/** Sparse custom reader: no XHR, HEAD, or full-file fallback. */
export async function readDriveTrackMetadata(
  options: RangeReaderOptions,
): Promise<MetadataOutcome> {
  const { signal, size } = options;
  if (!Number.isSafeInteger(size) || size < 16)
    throw new MetadataReadError("parse_error");
  const maxBytes = Math.min(options.maxBytes ?? 1024 * 1024, 1024 * 1024);
  const maxRequests = Math.min(options.maxRequests ?? 4, 4);
  let bytesRead = 0;
  let requests = 0;
  let failure: unknown;
  let chain = Promise.resolve();
  const chunks: { start: number; bytes: Uint8Array }[] = [];
  const [
    { default: MediaFileReader },
    { default: tags },
    { default: ID3v2TagReader },
  ] = await Promise.all([
    import("jsmediatags/build2/MediaFileReader"),
    import("jsmediatags"),
    import("jsmediatags/build2/ID3v2TagReader"),
  ]);
  function byteAt(offset: number): number {
    const chunk = chunks.find(
      (item) => offset >= item.start && offset < item.start + item.bytes.length,
    );
    if (!chunk) throw new MetadataReadError("parse_error");
    return chunk.bytes[offset - chunk.start];
  }
  async function fetchRange(start: number, end: number) {
    signal.throwIfAborted();
    options.assertCurrent();
    const length = end - start + 1;
    if (requests >= maxRequests || bytesRead + length > maxBytes)
      throw new MetadataReadError("budget_exceeded");
    requests += 1;
    let response: Response;
    try {
      response = await readGoogleDriveFileRange(
        options.fileId,
        options.accessToken,
        start,
        end,
        signal,
        {
          ...options.requestOptions,
          fileSize: size,
          maxAttempts: 1,
          maxBytes: length,
        },
      );
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TypeError)
        throw new MetadataReadError("transport_error", true);
      throw error;
    }
    const cancel = async () => {
      await response.body?.cancel().catch(() => {});
    };
    if (response.status !== 206) {
      await cancel();
      const proxyError = response.headers.get("X-DriveBeats-Range-Error");
      if (
        proxyError === "invalid_origin" ||
        proxyError === "invalid_input" ||
        proxyError === "service_unavailable"
      )
        throw new MetadataReadError("metadata_setup_error", true);
      if (
        proxyError === "sign_in_required" ||
        proxyError === "account_changed" ||
        response.status === 401
      )
        throw new MetadataReadError("metadata_auth_required", true);
      if (proxyError === "timeout")
        throw new MetadataReadError("timeout", true);
      if (proxyError === "incomplete_range")
        throw new MetadataReadError("transport_error", true);
      if (
        proxyError === "provider_unavailable" ||
        proxyError === "auth_unavailable"
      )
        throw new MetadataReadError("transport_error", true);
      if (
        proxyError === "provider_invalid_response" ||
        proxyError === "body_too_large"
      )
        throw new MetadataReadError("transport_error", true);
      if (response.headers.get("X-DriveBeats-Rate-Limited") === "true")
        throw new MetadataReadError("rate_limited", true);
      if (response.status === 403)
        throw new MetadataReadError("permission_denied", true);
      if (response.status === 404)
        throw new MetadataReadError("not_found", true);
      if (response.status === 429)
        throw new MetadataReadError("rate_limited", true);
      if (response.status === 416)
        throw new MetadataReadError("version_changed", true);
      if (response.status === 422 && proxyError === "range_unsupported")
        throw new MetadataReadError("range_unsupported");
      if (response.status >= 500)
        throw new MetadataReadError("transport_error", true);
      throw new MetadataReadError("transport_error", true);
    }
    const expectedRange = `bytes ${start}-${end}/${size}`;
    const declaredLength = response.headers.get("Content-Length");
    if (
      response.headers.get("Content-Range") !== expectedRange ||
      (declaredLength !== null && Number(declaredLength) !== length) ||
      !response.body
    ) {
      await cancel();
      throw new MetadataReadError("transport_error", true);
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(length);
    let offset = 0;
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        bytesRead += next.value.byteLength;
        if (offset + next.value.byteLength > length)
          throw new MetadataReadError("transport_error", true);
        if (bytesRead > maxBytes)
          throw new MetadataReadError("budget_exceeded");
        bytes.set(next.value, offset);
        offset += next.value.byteLength;
      }
      if (offset !== length)
        throw new MetadataReadError("transport_error", true);
      options.assertCurrent();
      chunks.push({ start, bytes });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TypeError)
        throw new MetadataReadError("transport_error", true);
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async function load(start: number, end: number) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= size
    )
      throw new MetadataReadError("parse_error");
    for (let cursor = start; cursor <= end; ) {
      const covering = chunks.find(
        (chunk) =>
          cursor >= chunk.start && cursor < chunk.start + chunk.bytes.length,
      );
      if (covering) {
        cursor = covering.start + covering.bytes.length;
        continue;
      }
      const nextChunk = chunks
        .filter((chunk) => chunk.start > cursor)
        .sort((a, b) => a.start - b.start)[0];
      const missingEnd = Math.min(end, nextChunk ? nextChunk.start - 1 : end);
      await fetchRange(cursor, missingEnd);
      cursor = missingEnd + 1;
    }
  }
  await load(0, 15);
  const id3 = byteAt(0) === 73 && byteAt(1) === 68 && byteAt(2) === 51;
  if (id3) {
    if (
      ![2, 3, 4].includes(byteAt(3)) ||
      [6, 7, 8, 9].some((offset) => byteAt(offset) > 127)
    )
      throw new MetadataReadError("parse_error");
    const tagLength =
      10 + (byteAt(6) << 21) + (byteAt(7) << 14) + (byteAt(8) << 7) + byteAt(9);
    if (tagLength > size) throw new MetadataReadError("parse_error");
    if (tagLength > maxBytes) throw new MetadataReadError("budget_exceeded");
  }
  class SparseReader extends MediaFileReader {
    constructor() {
      super();
      this._size = size;
      this._isInitialized = true;
    }
    loadRange(
      range: [number, number],
      callbacks: {
        onSuccess: () => void;
        onError: (error: { type: string; info: string }) => void;
      },
    ) {
      const job = chain.then(() => load(range[0], range[1]));
      chain = job.catch(() => {});
      void job.then(callbacks.onSuccess, (error) => {
        failure = error;
        callbacks.onError({ type: "range", info: "Bounded read failed" });
      });
    }
    getByteAt(offset: number) {
      return byteAt(offset);
    }
  }
  return new Promise<MetadataOutcome>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    const parser = new tags.Reader(null)
      .setFileReader(SparseReader)
      .setTagsToRead(["title", "artist", "album"]);
    // A validated leading ID3v2 header already proves the parser choice.
    // Avoid the automatic format detector's otherwise unused ID3v1 tail read.
    if (id3) parser.setTagReader(ID3v2TagReader);
    parser.read({
      onSuccess(result) {
        signal.removeEventListener("abort", onAbort);
        const fields = Object.fromEntries(
          ["title", "artist", "album"].flatMap((key) => {
            const value = result.tags[key];
            return typeof value === "string" && value.trim()
              ? [[key, value.trim().slice(0, 500)]]
              : [];
          }),
        );
        resolve({
          status: Object.keys(fields).length ? "ready" : "no_target_tags",
          tags: fields,
          loadedVia: "drive_range",
        });
      },
      onError(error) {
        signal.removeEventListener("abort", onAbort);
        if (failure) {
          reject(failure);
          return;
        }
        // Both supported tag locations were inspected by the parser. A plausible
        // MPEG frame avoids classifying an arbitrary invalid file as tagless.
        if (
          !id3 &&
          error.type === "tagFormat" &&
          byteAt(0) === 255 &&
          (byteAt(1) & 224) === 224
        )
          resolve({ status: "no_target_tags", loadedVia: "drive_range" });
        else reject(new MetadataReadError("parse_error"));
      },
    });
  });
}
