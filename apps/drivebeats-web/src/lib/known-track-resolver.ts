import { create } from "zustand";
import { playlistTrackToDriveFile } from "@/lib/audio";
import { getLocalMetadataAccountId } from "@/lib/metadata-local-account";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import {
  getLibrarySearchImportsSignature,
  useLibrarySearchStore,
} from "@/stores/library-search-store";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile, FolderEntry, PlaylistTrack } from "@/types";

export interface KnownTrack {
  accountId: string;
  track: DriveFile;
  scopeKey: string;
  source: "catalog" | "standalone" | "folder" | "collection";
  originalMimeType?: string;
}

export const useKnownTrackProofStore = create<{ revision: number }>(() => ({
  revision: 0,
}));
function proofsChanged() {
  useKnownTrackProofStore.setState((state) => ({
    revision: state.revision + 1,
  }));
}
let accountEpoch = 0;
let descriptorRevision = 0;
export function getKnownTrackDescriptorRevision() {
  return descriptorRevision;
}
let verifiedCollections: {
  accountId: string;
  epoch: number;
  playlists: unknown;
  tracks: unknown;
} | null = null;
const folders = new Map<string, { accountId: string; stack: FolderEntry[] }>();
const proofs = new WeakMap<KnownTrack, number>();
const descriptors = new Map<string, DriveFile>();
const trackIndexes = new WeakMap<DriveFile[], Map<string, DriveFile>>();
let importsCache: {
  folders: DriveFile[];
  files: DriveFile[];
  signature: string;
  epoch: number;
} | null = null;
function currentImports() {
  const { rootFolders: folders, rootFiles: files } =
    useImportedDriveStore.getState();
  if (
    !importsCache ||
    importsCache.folders !== folders ||
    importsCache.files !== files
  )
    importsCache = {
      folders,
      files,
      signature: getLibrarySearchImportsSignature(),
      epoch: (importsCache?.epoch ?? 0) + 1,
    };
  return importsCache;
}
let collectionIndex: {
  playlists: unknown;
  tracks: unknown;
  index: Map<string, { track: DriveFile; originalMimeType?: string }>;
} | null = null;
function indexTracks(tracks: DriveFile[]) {
  let index = trackIndexes.get(tracks);
  if (!index) {
    index = new Map(tracks.map((track) => [track.id, track]));
    trackIndexes.set(tracks, index);
  }
  return index;
}
useAuthStore.subscribe((state, previous) => {
  if (
    state.user?.id !== previous.user?.id ||
    state.isLoggingOut !== previous.isLoggingOut ||
    state.authStatus !== previous.authStatus
  ) {
    accountEpoch += 1;
    verifiedCollections = null;
    folders.clear();
    descriptors.clear();
    proofsChanged();
  }
});

function ownsAccount(accountId: string) {
  const auth = useAuthStore.getState();
  return getLocalMetadataAccountId() === accountId && !auth.isLoggingOut;
}

/** Called only after the ordinary cloud bootstrap has verified collection ownership. */
export function verifyKnownCollections(accountId: string) {
  if (
    ownsAccount(accountId) &&
    useAuthStore.getState().authStatus === "authenticated"
  ) {
    const prior = verifiedCollections;
    verifiedCollections = {
      accountId,
      epoch: accountEpoch,
      playlists: usePlaylistStore.getState().playlists,
      tracks: useLibraryStore.getState().tracks,
    };
    if (
      !prior ||
      prior.accountId !== accountId ||
      prior.epoch !== accountEpoch ||
      prior.playlists !== verifiedCollections.playlists ||
      prior.tracks !== verifiedCollections.tracks
    )
      proofsChanged();
  }
}

function provenFolder(accountId: string, stack: FolderEntry[]) {
  if (!ownsAccount(accountId)) return false;
  const roots = useImportedDriveStore.getState().rootFolders;
  const rootIndex = stack.findIndex((entry) =>
    roots.some((root) => root.id === entry.id),
  );
  if (rootIndex < 0) return false;
  for (let index = rootIndex + 1; index < stack.length; index++) {
    const parent = useFolderCacheStore.getState().getFiles(stack[index - 1].id);
    if (
      !parent?.files.some(
        (file) =>
          file.id === stack[index].id &&
          file.mimeType === "application/vnd.google-apps.folder",
      )
    )
      return false;
  }
  return true;
}

export function registerKnownFolder(
  accountId: string,
  stack: FolderEntry[],
  _files?: DriveFile[],
) {
  if (!provenFolder(accountId, stack)) return;
  const folderId = stack.at(-1)?.id;
  if (!folderId) return;
  const prior = folders.get(folderId);
  const changed =
    !prior ||
    prior.accountId !== accountId ||
    prior.stack.length !== stack.length ||
    prior.stack.some((entry, index) => entry.id !== stack[index].id);
  folders.set(folderId, {
    accountId,
    stack: stack.map((entry) => ({ ...entry })),
  });
  if (changed) proofsChanged();
  // A fresh proven folder listing can invalidate an older complete catalog's
  // descriptor without requiring another Library scan.
  const listing = useFolderCacheStore.getState().getFiles(folderId);
  const catalog = useLibrarySearchStore.getState().catalog;
  if (listing && (!catalog || listing.fetchedAt >= catalog.fetchedAt)) {
    for (const file of listing.files) {
      const known = resolveKnownTrack(accountId, file.id);
      if (known && descriptorKey(known.track) !== descriptorKey(file))
        updateKnownTrackDescriptor(known, file);
    }
  }
}

function descriptorKey(track: DriveFile) {
  return JSON.stringify([
    track.id,
    track.name,
    track.mimeType,
    track.modifiedTime ?? null,
    track.size ?? null,
  ]);
}

export function resolveKnownTrack(
  accountId: string,
  id: string,
): KnownTrack | null {
  if (!ownsAccount(accountId)) return null;
  const { signature, epoch: importsEpoch } = currentImports();
  const search = useLibrarySearchStore.getState();
  const catalog = search.catalog;
  let track: DriveFile | undefined;
  let originalMimeType: string | undefined;
  let source: KnownTrack["source"] = "catalog";
  if (
    catalog?.userId === accountId &&
    !search.invalidated &&
    catalog.importsSignature === signature
  )
    track = indexTracks(catalog.tracks).get(id);
  if (!track) {
    source = "standalone";
    track = indexTracks(useImportedDriveStore.getState().rootFiles).get(id);
  }
  if (!track) {
    source = "folder";
    for (const [folderId, folder] of folders) {
      if (
        folder.accountId !== accountId ||
        !provenFolder(accountId, folder.stack)
      )
        continue;
      const files = useFolderCacheStore.getState().getFiles(folderId)?.files;
      track = files ? indexTracks(files).get(id) : undefined;
      if (track?.mimeType === "application/vnd.google-apps.folder")
        track = undefined;
      if (track) break;
    }
  }
  if (
    !track &&
    ((typeof navigator !== "undefined" &&
      !navigator.onLine &&
      !useAuthStore.getState().user &&
      getLocalMetadataAccountId() === accountId) ||
      (verifiedCollections?.accountId === accountId &&
        verifiedCollections.epoch === accountEpoch &&
        verifiedCollections.playlists ===
          usePlaylistStore.getState().playlists &&
        verifiedCollections.tracks === useLibraryStore.getState().tracks &&
        usePlaylistStore.getState().isCloudHydrated &&
        useLibraryStore.getState().isCloudHydrated))
  ) {
    source = "collection";
    const playlists = usePlaylistStore.getState().playlists;
    const tracks = useLibraryStore.getState().tracks;
    if (
      !collectionIndex ||
      collectionIndex.playlists !== playlists ||
      collectionIndex.tracks !== tracks
    ) {
      const saved: PlaylistTrack[] = [
        ...getFavoriteTracks(tracks),
        ...playlists.flatMap((playlist) => playlist.tracks),
      ];
      collectionIndex = {
        playlists,
        tracks,
        index: new Map(
          saved.map((item) => [
            item.fileId,
            {
              track: playlistTrackToDriveFile(item),
              originalMimeType: item.mimeType,
            },
          ]),
        ),
      };
    }
    const saved = collectionIndex.index.get(id);
    originalMimeType = saved?.originalMimeType;
    track = saved?.track;
  }
  if (!track) return null;
  const baseKey = `${accountEpoch}:${importsEpoch}:${descriptorKey(track)}`;
  track = descriptors.get(baseKey) ?? track;
  const known: KnownTrack = {
    accountId,
    track: { ...track },
    scopeKey: `${baseKey}:${descriptorKey(track)}`,
    source,
    originalMimeType: descriptors.has(baseKey)
      ? track.mimeType
      : source === "collection"
        ? originalMimeType
        : track.mimeType,
  };
  proofs.set(known, accountEpoch);
  return known;
}

/** A targeted provider check can strengthen an old collection descriptor. */
export function updateKnownTrackDescriptor(
  known: KnownTrack,
  descriptor: DriveFile,
) {
  if (!assertKnownTrack(known) || known.track.id !== descriptor.id)
    return false;
  const changed = descriptorKey(known.track) !== descriptorKey(descriptor);
  if (changed) descriptorRevision += 1;
  const oldKey = known.scopeKey;
  const baseKey = oldKey.slice(
    0,
    oldKey.lastIndexOf(`:${descriptorKey(known.track)}`),
  );
  descriptors.set(baseKey, descriptor);
  if (descriptors.size > 50000)
    descriptors.delete(descriptors.keys().next().value as string);
  known.track = { ...descriptor };
  known.originalMimeType = descriptor.mimeType;
  known.scopeKey = `${baseKey}:${descriptorKey(descriptor)}`;
  if (changed) proofsChanged();
  return true;
}

export function assertKnownTrack(known: KnownTrack) {
  if (proofs.get(known) !== accountEpoch) return false;
  const current = resolveKnownTrack(known.accountId, known.track.id);
  return Boolean(current && current.scopeKey === known.scopeKey);
}

export async function resolveKnownTracks(
  accountId: string,
  ids: string[],
  options: {
    signal?: AbortSignal;
    verifyCollections?: () => Promise<unknown>;
  } = {},
) {
  options.signal?.throwIfAborted();
  if (
    ids.some((id) => !resolveKnownTrack(accountId, id)) &&
    options.verifyCollections
  ) {
    await options.verifyCollections();
    options.signal?.throwIfAborted();
  }
  return ids.map((id) => resolveKnownTrack(accountId, id));
}

// Once a cloud read established ownership, ordinary local collection mutations
// retain that ownership; a new account still needs its own verified cloud read.
function refreshVerifiedCollections() {
  if (verifiedCollections?.epoch === accountEpoch)
    verifyKnownCollections(verifiedCollections.accountId);
}
usePlaylistStore.subscribe(refreshVerifiedCollections);
useLibraryStore.subscribe(refreshVerifiedCollections);
useImportedDriveStore.subscribe(proofsChanged);
useLibrarySearchStore.subscribe((state, previous) => {
  if (
    state.catalog !== previous.catalog ||
    state.invalidated !== previous.invalidated
  )
    proofsChanged();
});
