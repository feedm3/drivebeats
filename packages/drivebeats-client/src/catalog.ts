import { isSupportedAudioFile } from "@drivebeats/core/audio";
import { type DriveFile, FOLDER_MIME } from "@drivebeats/core/types";
import { filterFilesBySearch } from "./file-search";

export interface CatalogEntry extends DriveFile {
  parentId: string;
  path: string;
}
export interface CatalogGeneration {
  id: string;
  accountId: string;
  rootIds: string[];
  standaloneIds: string[];
  entries: CatalogEntry[];
}
export interface LibraryReader {
  readItem(id: string): Promise<DriveFile>;
  readFolder(
    id: string,
    pageToken?: string,
  ): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
}

/** Build privately; publish only after every page of every imported subtree succeeds. */
export async function buildCatalog(
  accountId: string,
  rootIds: string[],
  standaloneIds: string[],
  reader: LibraryReader,
  signal?: AbortSignal,
): Promise<CatalogGeneration> {
  const entries = new Map<string, CatalogEntry>();
  const visited = new Set<string>();
  const pending: CatalogEntry[] = [];
  const check = () => signal?.throwIfAborted();
  for (const id of rootIds) {
    check();
    const file = await reader.readItem(id);
    if (file.mimeType !== FOLDER_MIME)
      throw new Error("An Imported Folder is unavailable. Import it again.");
    const entry = { ...file, parentId: "root", path: file.name };
    entries.set(id, entry);
    pending.push(entry);
  }
  for (const id of standaloneIds) {
    check();
    const file = await reader.readItem(id);
    if (!isSupportedAudioFile(file))
      throw new Error("A Standalone Track is unavailable.");
    entries.set(id, { ...file, parentId: "root", path: file.name });
  }
  while (pending.length) {
    check();
    const folder = pending.shift();
    if (!folder || visited.has(folder.id)) continue;
    visited.add(folder.id);
    let token: string | undefined;
    const pageTokens = new Set<string>();
    do {
      check();
      const page = await reader.readFolder(folder.id, token);
      for (const file of page.files) {
        if (file.mimeType !== FOLDER_MIME && !isSupportedAudioFile(file))
          continue;
        const existing = entries.get(file.id);
        // Explicit imported roots retain their root location even when nested imports overlap.
        const entry = existing ?? {
          ...file,
          parentId: folder.id,
          path: `${folder.path}/${file.name}`,
        };
        entries.set(file.id, entry);
        if (file.mimeType === FOLDER_MIME && !visited.has(file.id))
          pending.push(entry);
      }
      token = page.nextPageToken;
      if (token && pageTokens.has(token))
        throw new Error(
          "Google Drive returned an incomplete folder listing. Try rebuilding your Library.",
        );
      if (token) pageTokens.add(token);
    } while (token);
  }
  check();
  return {
    id: crypto.randomUUID(),
    accountId,
    rootIds: [...rootIds],
    standaloneIds: [...standaloneIds],
    entries: [...entries.values()].sort(
      (a, b) =>
        a.path.localeCompare(b.path, undefined, {
          numeric: true,
          sensitivity: "base",
        }) || a.id.localeCompare(b.id),
    ),
  };
}

export function catalogPage(
  generation: CatalogGeneration,
  options: {
    query?: string;
    folderId?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const limit = Number.isSafeInteger(options.limit)
    ? Math.max(1, Math.min(100, options.limit ?? 50))
    : 50;
  const query =
    options.folderId !== undefined
      ? ""
      : (options.query ?? "").trim().toLocaleLowerCase().split(/\s+/).join(" ");
  const folderId = options.folderId ?? null;
  if (query.length > 200 || (folderId?.length ?? 0) > 256)
    throw new Error("The search request is too long.");
  function cursorFor(offset: number) {
    const bytes = new TextEncoder().encode(
      JSON.stringify([query, folderId, offset]),
    );
    return `${generation.id}:${btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")}`;
  }
  let offset = 0;
  if (options.cursor) {
    try {
      const [id, encoded, extra] = options.cursor.split(":");
      if (
        id !== generation.id ||
        !encoded ||
        extra !== undefined ||
        options.cursor.length > 2048
      )
        throw new Error();
      const values: unknown = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
            (char) => char.charCodeAt(0),
          ),
        ),
      );
      if (
        !Array.isArray(values) ||
        values.length !== 3 ||
        values[0] !== query ||
        values[1] !== folderId ||
        !Number.isSafeInteger(values[2]) ||
        values[2] < 0
      )
        throw new Error();
      offset = values[2];
    } catch {
      throw new Error(
        "Library changed or this cursor belongs to another search. Start this search again.",
      );
    }
  }
  const files =
    options.folderId !== undefined
      ? generation.entries.filter((file) => file.parentId === options.folderId)
      : filterFilesBySearch(
          generation.entries.filter((file) => file.mimeType !== FOLDER_MIME),
          options.query ?? "",
        );
  if (offset > files.length)
    throw new Error("The search cursor is outside this result set.");
  const items: {
    id: string;
    name: string;
    mimeType: string;
    path: string;
    parentId: string;
  }[] = [];
  const encoder = new TextEncoder();
  let bytes = 512;
  for (const file of files.slice(offset, offset + limit)) {
    const item = {
      id: file.id,
      name: file.name.slice(0, 500),
      mimeType: file.mimeType,
      path: file.path.slice(0, 1024),
      parentId: file.parentId,
    };
    const itemBytes = encoder.encode(JSON.stringify(item)).byteLength + 1;
    if (bytes + itemBytes > 20_000) break;
    bytes += itemBytes;
    items.push(item);
  }
  return {
    generationId: generation.id,
    items,
    nextCursor:
      offset + items.length < files.length
        ? cursorFor(offset + items.length)
        : null,
    total: files.length,
  };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("drivebeats-mcp-library", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("accounts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function localOperation<T>(
  accountId: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("accounts", mode);
      const request = operation(transaction.objectStore("accounts"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error(`Local Library for ${accountId} could not be saved.`),
        );
    });
  } finally {
    db.close();
  }
}
export const loadCatalog = (accountId: string) =>
  localOperation<CatalogGeneration | undefined>(
    accountId,
    "readonly",
    (store) => store.get(accountId),
  );
export const saveCatalog = (generation: CatalogGeneration) =>
  localOperation(generation.accountId, "readwrite", (store) =>
    store.put(generation, generation.accountId),
  );
export const clearCatalog = (accountId: string) =>
  localOperation(accountId, "readwrite", (store) => store.delete(accountId));
