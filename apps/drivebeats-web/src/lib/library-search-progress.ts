import {
  deleteBackgroundProgress,
  deleteBackgroundProgressPrefix,
  inheritBackgroundProgressFence,
  loadBackgroundProgress,
  saveBackgroundProgress,
} from "@/lib/background-progress-db";
import type {
  LibrarySearchBuildCheckpoint,
  LibrarySearchBuildPage,
} from "@/lib/library-search-drive";
import type { DriveFile } from "@/types";

export const MAX_CATALOG_CHECKPOINT_AGE_MS = 15 * 60_000;
const MAX_PROGRESS_BYTES = 16 * 1024 * 1024;
interface Manifest {
  schema: 1;
  id: string;
  startedAt: number;
  audioChunks: number;
  folderChunks: number;
  bytes: number;
  phase: "audio" | "folders";
  pageToken?: string;
  listingComplete?: boolean;
}

/** Each completed page is stored once. The small manifest advances only after its chunk commits. */
export function createLibrarySearchProgress(
  key: string,
  options: { signal: AbortSignal; isCurrent: () => boolean },
) {
  let manifest: Manifest | undefined;
  let disabled = false;
  const prefix = `${key}:chunks:`;
  const chunkKey = (
    value: Manifest,
    phase: "audio" | "folders",
    index: number,
  ) => `${prefix}${value.id}:${phase}:${index}`;
  async function clear() {
    manifest = undefined;
    disabled = false;
    await deleteBackgroundProgress(key, { preserveFence: true });
    await deleteBackgroundProgressPrefix(prefix);
  }
  async function load(): Promise<LibrarySearchBuildCheckpoint | undefined> {
    const value = await loadBackgroundProgress<Manifest>(key);
    if (!value) return undefined;
    if (
      value.schema !== 1 ||
      typeof value.id !== "string" ||
      value.id.length > 64 ||
      !Number.isFinite(value.startedAt) ||
      value.startedAt > Date.now() ||
      Date.now() - value.startedAt > MAX_CATALOG_CHECKPOINT_AGE_MS ||
      !["audio", "folders"].includes(value.phase) ||
      !Number.isInteger(value.audioChunks) ||
      !Number.isInteger(value.folderChunks) ||
      value.audioChunks < 0 ||
      value.folderChunks < 0 ||
      value.audioChunks + value.folderChunks > 50_000 ||
      !(value.bytes >= 0 && value.bytes <= MAX_PROGRESS_BYTES)
    ) {
      await clear();
      return undefined;
    }
    async function readChunks(phase: "audio" | "folders", count: number) {
      const files: DriveFile[] = [];
      for (let index = 0; index < count; index++) {
        options.signal.throwIfAborted();
        const page = await loadBackgroundProgress<DriveFile[]>(
          chunkKey(value as Manifest, phase, index),
        );
        if (!Array.isArray(page)) return null;
        files.push(...page);
      }
      return files;
    }
    const audioFiles = await readChunks("audio", value.audioChunks);
    const folders = await readChunks("folders", value.folderChunks);
    if (!audioFiles || !folders) {
      await clear();
      return undefined;
    }
    manifest = value;
    return {
      startedAt: value.startedAt,
      listingComplete: value.listingComplete,
      audioFiles,
      folders,
      phase: value.phase,
      pageToken: value.pageToken,
    };
  }
  async function save(
    checkpoint: LibrarySearchBuildCheckpoint,
    page?: LibrarySearchBuildPage,
  ) {
    if (disabled || options.signal.aborted || !options.isCurrent())
      return false;
    const previous = manifest ?? {
      schema: 1 as const,
      id: crypto.randomUUID(),
      startedAt: checkpoint.startedAt,
      audioChunks: 0,
      folderChunks: 0,
      bytes: 0,
      phase: checkpoint.phase,
    };
    const pages = page
      ? [page]
      : [
          ...(checkpoint.audioFiles.length
            ? [{ phase: "audio" as const, files: checkpoint.audioFiles }]
            : []),
          ...(checkpoint.folders.length
            ? [{ phase: "folders" as const, files: checkpoint.folders }]
            : []),
        ];
    const next = {
      ...previous,
      phase: checkpoint.phase,
      pageToken: checkpoint.pageToken,
      listingComplete: checkpoint.listingComplete,
    };
    for (const completedPage of pages) {
      const bytes = new TextEncoder().encode(
        JSON.stringify(completedPage.files),
      ).byteLength;
      if (next.bytes + bytes > MAX_PROGRESS_BYTES) {
        await clear();
        disabled = true;
        return false;
      }
      const countKey =
        completedPage.phase === "audio" ? "audioChunks" : "folderChunks";
      const pageKey = chunkKey(next, completedPage.phase, next[countKey]);
      inheritBackgroundProgressFence(key, pageKey);
      if (
        !(await saveBackgroundProgress(pageKey, completedPage.files, options))
      ) {
        disabled = true;
        return false;
      }
      next[countKey]++;
      next.bytes += bytes;
    }
    if (!(await saveBackgroundProgress(key, next, options))) {
      disabled = true;
      return false;
    }
    manifest = next;
    return true;
  }
  return { load, save, clear };
}
