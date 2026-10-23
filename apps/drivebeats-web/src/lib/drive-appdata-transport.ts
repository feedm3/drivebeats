import { AppDataError } from "@/db/appdata-control";
import { APPDATA_MAX_FILE_BYTES } from "@/lib/drive-appdata-schema";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export interface AppDataFile {
  id: string;
  size?: number;
}
export interface AppDataTransport {
  generateId(): Promise<string>;
  list(options?: { forDeletion?: boolean }): Promise<AppDataFile[]>;
  read(fileId: string): Promise<string | null>;
  /** IDs taken from the durable app-data journal, never request input. */
  readKnown?(fileId: string): Promise<string | null>;
  create(fileId: string, json: string): Promise<void>;
  delete(fileId: string): Promise<void>;
}

/** No music-file mutation interface exists: create always uses appDataFolder;
 * read/delete additionally verify appDataFolder membership before access. */
export function createDriveAppDataTransport(
  accessToken: string,
  request: typeof fetch = fetch,
): AppDataTransport {
  const headers = { Authorization: `Bearer ${accessToken}` };
  async function send(url: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await request(url, {
        ...init,
        headers: { ...headers, ...init?.headers },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AppDataError("appdata_provider_uncertain");
    }
    return response;
  }
  async function check(response: Response) {
    if (response.ok) return;
    if (response.status === 403) {
      let reasons: string[] = [];
      try {
        const error = JSON.parse(await boundedText(response));
        if (Array.isArray(error?.error?.errors))
          reasons = error.error.errors
            .map((item: { reason?: string }) => item?.reason)
            .filter((reason: unknown) => typeof reason === "string");
      } catch {
        /* Only fixed categories leave the transport. */
      }
      if (reasons.includes("storageQuotaExceeded"))
        throw new AppDataError("appdata_storage_full");
      if (
        reasons.includes("rateLimitExceeded") ||
        reasons.includes("userRateLimitExceeded")
      )
        throw new AppDataError("appdata_rate_limited");
    }
    const code =
      response.status === 401 || response.status === 403
        ? "appdata_access_required"
        : response.status === 429
          ? "appdata_rate_limited"
          : response.status >= 500
            ? "appdata_provider_unavailable"
            : "appdata_provider_rejected";
    throw new AppDataError(code);
  }
  async function boundedText(response: Response) {
    if (Number(response.headers.get("content-length")) > APPDATA_MAX_FILE_BYTES)
      throw new AppDataError("appdata_file_too_large");
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        throw new AppDataError("appdata_provider_uncertain");
      }
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > APPDATA_MAX_FILE_BYTES) {
        await reader.cancel();
        throw new AppDataError("appdata_file_too_large");
      }
      chunks.push(part.value);
    }
    const result = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) {
      result.set(chunk, position);
      position += chunk.byteLength;
    }
    return new TextDecoder().decode(result);
  }
  async function membership(fileId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId))
      throw new AppDataError("appdata_invalid_file_id");
    const response = await send(
      `${API}/${encodeURIComponent(fileId)}?fields=id,parents,spaces`,
    );
    if (response.status === 404) return false;
    await check(response);
    const metadata = JSON.parse(await boundedText(response));
    if (
      !Array.isArray(metadata.spaces) ||
      !metadata.spaces.includes("appDataFolder")
    )
      throw new AppDataError("appdata_not_hidden");
    return true;
  }
  async function readKnown(fileId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId))
      throw new AppDataError("appdata_invalid_file_id");
    const response = await send(
      `${API}/${encodeURIComponent(fileId)}?alt=media`,
    );
    if (response.status === 404) return null;
    await check(response);
    return boundedText(response);
  }
  return {
    async generateId() {
      const response = await send(
        `${API}/generateIds?count=1&space=appDataFolder&type=files`,
      );
      await check(response);
      const result = JSON.parse(await boundedText(response));
      if (
        !Array.isArray(result.ids) ||
        typeof result.ids[0] !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(result.ids[0])
      )
        throw new AppDataError("appdata_invalid_provider_response");
      return result.ids[0];
    },
    async list(options = {}) {
      const files: AppDataFile[] = [];
      const visited = new Set<string>();
      let pageToken: string | undefined;
      do {
        if (!options.forDeletion && visited.size >= 1000)
          throw new AppDataError("appdata_incomplete_listing");
        const params = new URLSearchParams({
          spaces: "appDataFolder",
          fields: "nextPageToken,incompleteSearch,files(id,size)",
          pageSize: "1000",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await send(`${API}?${params}`);
        await check(response);
        const result = JSON.parse(await boundedText(response));
        if (result.incompleteSearch || !Array.isArray(result.files))
          throw new AppDataError("appdata_incomplete_listing");
        for (const file of result.files) {
          if (
            !file ||
            typeof file.id !== "string" ||
            !/^[A-Za-z0-9_-]+$/.test(file.id)
          )
            throw new AppDataError("appdata_invalid_provider_response");
          files.push({
            id: file.id,
            size: file.size === undefined ? undefined : Number(file.size),
          });
        }
        if (!options.forDeletion && files.length > 10000)
          throw new AppDataError("appdata_compaction_required");
        pageToken = result.nextPageToken;
        if (
          pageToken !== undefined &&
          (typeof pageToken !== "string" || visited.has(pageToken))
        )
          throw new AppDataError("appdata_incomplete_listing");
        if (pageToken) visited.add(pageToken);
      } while (pageToken);
      return files;
    },
    async read(fileId) {
      if (!(await membership(fileId))) return null;
      return readKnown(fileId);
    },
    readKnown,
    async create(fileId, json) {
      if (
        !/^[A-Za-z0-9_-]+$/.test(fileId) ||
        new TextEncoder().encode(json).byteLength > APPDATA_MAX_FILE_BYTES
      )
        throw new AppDataError("appdata_invalid_upload");
      const boundary = `drivebeats_${crypto.randomUUID()}`;
      const metadata = JSON.stringify({
        id: fileId,
        name: `drivebeats-${fileId}.json`,
        mimeType: "application/json",
        parents: ["appDataFolder"],
      });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
      const response = await send(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      if (response.status !== 409) await check(response);
      // A 409 may represent a retry. Only exact readback establishes success.
      let actual: string | null;
      try {
        actual = await this.read(fileId);
      } catch {
        throw new AppDataError("appdata_upload_verification_pending");
      }
      if (actual !== json)
        throw new AppDataError("appdata_upload_verification_failed");
    },
    async delete(fileId) {
      if (!(await membership(fileId))) return;
      const response = await send(`${API}/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
      });
      if (response.status !== 404) await check(response);
    },
  };
}
