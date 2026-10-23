import { create } from "zustand";
import type { Id3Metadata } from "@/lib/id3-metadata";
import {
  clearMetadataCache,
  loadMetadataCache,
  loadMetadataRecord,
  saveMetadataRecord,
} from "@/lib/metadata-cache-db";
import {
  getMetadataFingerprint,
  getMetadataFreshness,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
  type MetadataDescriptor,
  type MetadataFreshness,
  type MetadataOutcome,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import {
  forgetLocalMetadataAccount,
  getLocalMetadataAccountId,
  getRememberedMetadataAccountId,
  rememberLocalMetadataAccount,
} from "@/lib/metadata-local-account";
import type { MetadataBlobSource } from "@/lib/track-metadata-loader";
import { useAuthStore } from "@/stores/auth-store";

export interface CachedId3Metadata extends Id3Metadata {
  modifiedTime?: string;
  size?: string;
}
interface Id3MetadataState {
  accountId: string | null;
  generation: number;
  hydrated: boolean;
  durable: boolean;
  records: Record<string, MetadataRecord>;
  /** Compatibility display projection; never a membership or version proof. */
  cache: Record<string, CachedId3Metadata>;
  setAccount: (accountId: string | null) => Promise<void>;
  observeDescriptor: (track: MetadataDescriptor) => void;
  getRecord: (
    track: MetadataDescriptor,
    environmentKey?: string,
  ) => { record?: MetadataRecord; freshness: MetadataFreshness };
  peekRecord: (
    track: MetadataDescriptor,
    environmentKey?: string,
  ) => Promise<{ record?: MetadataRecord; freshness: MetadataFreshness }>;
  loadRecord: (
    track: MetadataDescriptor,
    environmentKey?: string,
    isCurrent?: () => boolean,
  ) => Promise<{ record?: MetadataRecord; freshness: MetadataFreshness }>;
  putRecord: (
    track: MetadataDescriptor,
    result: MetadataOutcome,
    expectedGeneration?: number,
  ) => Promise<boolean>;
  restoreRecord: (
    record: MetadataRecord,
    expectedFingerprint?: string,
  ) => Promise<boolean>;
  setMetadata: (fileId: string, metadata: CachedId3Metadata) => void;
  requestMetadata: (
    fileId: string,
    blob: Blob,
    source?: MetadataBlobSource,
  ) => Promise<void>;
  clearAll: (notify?: boolean) => Promise<void>;
  resetCachedMetadata: (notify?: boolean) => Promise<void>;
}

const MAX_MEMORY_RECORDS = 20_000;
const accessedRecords = new Map<string, true>();
const retainedRecords = new Map<string, { count: number }>();
const MAX_RETAINED_RECORDS = 1024;

/** Keep ordinary mounted rows/player controls resident, with a fixed upper bound. */
export function retainCachedMetadataRecord(fileId: string) {
  let entry = retainedRecords.get(fileId);
  if (!entry) {
    if (retainedRecords.size >= MAX_RETAINED_RECORDS) return () => {};
    entry = { count: 0 };
    retainedRecords.set(fileId, entry);
  }
  const owned = entry;
  owned.count += 1;
  return () => {
    if (retainedRecords.get(fileId) !== owned) return;
    owned.count -= 1;
    if (!owned.count) retainedRecords.delete(fileId);
  };
}
const observedFingerprints = new Map<string, string | null>();
let storageEpoch = 0;
let hydrationFlight: Promise<void> | null = null;
let pendingClear: Promise<void> = Promise.resolve();
let sealedAccount: string | null = null;

function clearAccount(accountId: string) {
  const result = pendingClear.then(() => clearMetadataCache(accountId));
  pendingClear = result.then(() => {});
  return result;
}

function notifyClear(accountId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      "drivebeats-metadata-clear",
      JSON.stringify({ accountId, at: Date.now() }),
    );
  } catch {
    /* Storage may be unavailable. */
  }
}

if (typeof window !== "undefined") {
  // The retired unscoped payload cannot prove account or content identity.
  try {
    window.localStorage.removeItem("drivebeats-id3-metadata");
  } catch {
    /* Local storage can be blocked independently of IndexedDB. */
  }
  window.addEventListener("storage", (event) => {
    if (event.key === "drivebeats-metadata-cache-reset" && event.newValue) {
      try {
        const { accountId } = JSON.parse(event.newValue) as {
          accountId?: string;
        };
        if (accountId && useId3MetadataStore.getState().accountId === accountId)
          void useId3MetadataStore.getState().resetCachedMetadata(false);
      } catch {
        /* Ignore malformed local notifications. */
      }
      return;
    }
    if (event.key === "drivebeats-metadata-updated" && event.newValue) {
      try {
        const { accountId, fileId } = JSON.parse(event.newValue) as {
          accountId?: string;
          fileId?: string;
        };
        const state = useId3MetadataStore.getState();
        if (!accountId || !fileId || state.accountId !== accountId) return;
        const generation = state.generation;
        void loadMetadataRecord(accountId, fileId)
          .then((loaded) => {
            const current = useId3MetadataStore.getState();
            if (
              !loaded?.record ||
              loaded.epoch !== storageEpoch ||
              current.accountId !== accountId ||
              current.generation !== generation ||
              (current.records[fileId]?.checkedAt ?? 0) >=
                loaded.record.checkedAt
            )
              return;
            const record = loaded.record;
            const records = boundRecords(
              {
                ...current.records,
                [fileId]: record,
              },
              fileId,
            );
            const cache = { ...current.cache };
            const projected = project(record);
            if (projected) cache[fileId] = projected;
            else delete cache[fileId];
            for (const id of Object.keys(cache))
              if (!records[id]) delete cache[id];
            useId3MetadataStore.setState({ records, cache });
          })
          .catch(() => {});
      } catch {
        /* Ignore malformed local notifications. */
      }
      return;
    }
    if (event.key !== "drivebeats-metadata-clear" || !event.newValue) return;
    try {
      const { accountId } = JSON.parse(event.newValue) as {
        accountId?: string;
      };
      if (accountId && useId3MetadataStore.getState().accountId === accountId) {
        void useId3MetadataStore.getState().clearAll(false);
      }
    } catch {
      /* Ignore malformed events. */
    }
  });
}

function project(record: MetadataRecord): CachedId3Metadata | undefined {
  if (record.status !== "ready") return undefined;
  let modifiedTime: string | undefined;
  let size: string | undefined;
  if (record.fingerprint)
    [modifiedTime, size] = JSON.parse(record.fingerprint) as [string, string];
  return { ...record.tags, modifiedTime, size };
}

function touchRecord(fileId: string) {
  accessedRecords.delete(fileId);
  accessedRecords.set(fileId, true);
}

/** Access recency is independent of content age; old durable hits stay usable. */
function boundRecords(
  records: Record<string, MetadataRecord>,
  accessedId: string,
) {
  const ids = Object.keys(records);
  for (const id of accessedRecords.keys())
    if (!records[id]) accessedRecords.delete(id);
  for (const id of ids)
    if (!accessedRecords.has(id)) accessedRecords.set(id, true);
  touchRecord(accessedId);
  while (accessedRecords.size > MAX_MEMORY_RECORDS) {
    let oldest: string | undefined;
    for (const id of accessedRecords.keys()) {
      if (!retainedRecords.has(id)) {
        oldest = id;
        break;
      }
    }
    if (!oldest) break;
    accessedRecords.delete(oldest);
    delete records[oldest];
  }
  return records;
}

export const useId3MetadataStore = create<Id3MetadataState>((set, get) => ({
  accountId: null,
  generation: 0,
  hydrated: false,
  durable: false,
  records: {},
  cache: {},

  setAccount: (accountId) => {
    if (accountId && accountId === sealedAccount) return Promise.resolve();
    if (accountId) rememberLocalMetadataAccount(accountId);
    const previousAccount = get().accountId;
    if (previousAccount === accountId && (get().hydrated || hydrationFlight))
      return hydrationFlight ?? Promise.resolve();
    const generation = get().generation + 1;
    observedFingerprints.clear();
    accessedRecords.clear();
    retainedRecords.clear();
    storageEpoch = 0;
    set({
      accountId,
      generation,
      records: {},
      cache: {},
      hydrated: !accountId,
      durable: false,
    });
    // An account change cannot retain the previous account's local tags.
    const clear =
      previousAccount && accountId && previousAccount !== accountId
        ? clearAccount(previousAccount)
        : pendingClear;
    if (previousAccount && accountId && previousAccount !== accountId)
      notifyClear(previousAccount);
    if (!accountId) {
      hydrationFlight = null;
      return clear.then(() => {});
    }
    const flight = clear
      .then(() => loadMetadataCache(accountId))
      .then(({ records, epoch, durable }) => {
        if (get().generation !== generation || get().accountId !== accountId)
          return;
        storageEpoch = epoch;
        const byId: Record<string, MetadataRecord> = {};
        const cache: Record<string, CachedId3Metadata> = {};
        for (const record of records) {
          if (record.accountId !== accountId) continue;
          byId[record.fileId] = record;
          touchRecord(record.fileId);
          // Do not expose old schema/parser/policy tags through the legacy UI projection.
          if (
            record.schemaVersion === METADATA_SCHEMA_VERSION &&
            record.parserVersion === METADATA_PARSER_VERSION &&
            record.policyVersion === METADATA_POLICY_VERSION
          ) {
            const metadata = project(record);
            if (metadata) cache[record.fileId] = metadata;
          }
        }
        set({ records: byId, cache, hydrated: true, durable });
      })
      .finally(() => {
        if (hydrationFlight === flight) hydrationFlight = null;
      });
    hydrationFlight = flight;
    return flight;
  },

  observeDescriptor: (track) => {
    observedFingerprints.set(track.id, getMetadataFingerprint(track));
  },

  getRecord: (track, environmentKey) => {
    const record = get().records[track.id];
    return {
      record,
      freshness: getMetadataFreshness(record, track, environmentKey),
    };
  },

  peekRecord: async (track, environmentKey) => {
    const initial = get().getRecord(track, environmentKey);
    if (initial.record) return initial;
    const { accountId, generation } = get();
    if (!accountId) return initial;
    const loaded = await loadMetadataRecord(accountId, track.id);
    if (
      get().generation !== generation ||
      get().accountId !== accountId ||
      !loaded?.record ||
      loaded.epoch !== storageEpoch ||
      loaded.record.accountId !== accountId
    )
      return { freshness: "unknown" };
    return {
      record: loaded.record,
      freshness: getMetadataFreshness(loaded.record, track, environmentKey),
    };
  },

  loadRecord: async (track, environmentKey, isCurrent = () => true) => {
    if (!isCurrent()) return { freshness: "unknown" };
    const observation = observedFingerprints.get(track.id);
    const initial = get().getRecord(track, environmentKey);
    if (initial.record) {
      touchRecord(track.id);
      return initial;
    }
    const { accountId, generation } = get();
    if (!accountId) return initial;
    const loaded = await loadMetadataRecord(accountId, track.id);
    if (
      !isCurrent() ||
      get().accountId !== accountId ||
      get().generation !== generation ||
      !loaded?.record ||
      loaded.epoch !== storageEpoch
    )
      return { freshness: "unknown" };
    const alreadyLoaded = get().records[track.id];
    if (alreadyLoaded) {
      touchRecord(track.id);
      return {
        record: alreadyLoaded,
        freshness: getMetadataFreshness(alreadyLoaded, track, environmentKey),
      };
    }
    if (observedFingerprints.get(track.id) !== observation)
      return { freshness: "unknown" };
    const record = loaded.record;
    if (record.accountId !== accountId) return { freshness: "unknown" };
    set((state) => {
      const records = boundRecords(
        { ...state.records, [track.id]: record },
        track.id,
      );
      const cache = { ...state.cache };
      const projected = project(record);
      if (projected) cache[track.id] = projected;
      for (const id of Object.keys(cache)) if (!records[id]) delete cache[id];
      return { records, cache };
    });
    return {
      record,
      freshness: getMetadataFreshness(record, track, environmentKey),
    };
  },

  putRecord: async (track, result, expectedGeneration = get().generation) => {
    if (hydrationFlight) await hydrationFlight;
    const { accountId, generation } = get();
    if (!accountId || generation !== expectedGeneration) return false;
    const fingerprint = getMetadataFingerprint(track);
    if (
      observedFingerprints.has(track.id) &&
      observedFingerprints.get(track.id) !== fingerprint
    )
      return false;
    const record: MetadataRecord = {
      ...result,
      tags: result.status === "ready" ? result.tags : undefined,
      accountId,
      fileId: track.id,
      fingerprint,
      parserVersion: METADATA_PARSER_VERSION,
      policyVersion: METADATA_POLICY_VERSION,
      schemaVersion: METADATA_SCHEMA_VERSION,
      checkedAt: Date.now(),
      checkedFields: ["title", "artist", "album"],
      mimeType: track.mimeType,
    };
    set((state) => {
      const records = boundRecords(
        { ...state.records, [track.id]: record },
        track.id,
      );
      const cache = { ...state.cache };
      const projected = project(record);
      if (projected) cache[track.id] = projected;
      else delete cache[track.id];
      for (const id of Object.keys(cache)) if (!records[id]) delete cache[id];
      return { records, cache };
    });
    const durable = await saveMetadataRecord(record, storageEpoch);
    if (get().generation !== generation || get().accountId !== accountId)
      return false;
    if (!durable) set({ durable: false });
    else
      try {
        if (typeof localStorage !== "undefined")
          localStorage.setItem(
            "drivebeats-metadata-updated",
            JSON.stringify({
              accountId,
              fileId: track.id,
              checkedAt: record.checkedAt,
            }),
          );
      } catch {
        /* Notifications are optional; persistence remains valid. */
      }
    // The explicit restore lifecycle owns the backup listener. Local cache APIs
    // never import/start a remote transport (including WebMCP cache_only).
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("drivebeats-portable-metadata", { detail: record }),
      );
    return true;
  },

  restoreRecord: async (record, expectedFingerprint) => {
    const { accountId, generation } = get();
    if (!accountId || record.accountId !== accountId) return false;
    if (
      expectedFingerprint !== undefined &&
      expectedFingerprint !== record.fingerprint
    )
      return false;
    const existing = get().records[record.fileId];
    if (
      expectedFingerprint === undefined &&
      existing &&
      existing.parserVersion === record.parserVersion &&
      existing.policyVersion === record.policyVersion &&
      existing.schemaVersion === record.schemaVersion &&
      (existing.status === "ready" || existing.status === "no_target_tags") &&
      (existing.fingerprint ?? "") > (record.fingerprint ?? "")
    )
      return true;
    const durable = await saveMetadataRecord(record, storageEpoch);
    if (get().accountId !== accountId || get().generation !== generation)
      return false;
    set((state) => {
      const records = boundRecords(
        { ...state.records, [record.fileId]: record },
        record.fileId,
      );
      const cache = { ...state.cache };
      const projected = project(record);
      if (projected) cache[record.fileId] = projected;
      else delete cache[record.fileId];
      for (const id of Object.keys(cache)) if (!records[id]) delete cache[id];
      return { records, cache, durable: state.durable && durable };
    });
    return true;
  },

  setMetadata: (fileId, metadata) => {
    const track = {
      id: fileId,
      modifiedTime: metadata.modifiedTime,
      size: metadata.size,
    };
    get().observeDescriptor(track);
    void get().putRecord(track, {
      status: "ready",
      tags: metadata,
      loadedVia: "local_blob",
    });
  },

  requestMetadata: async (fileId, blob, source) => {
    const accountId = getLocalMetadataAccountId();
    // This playback notification must not trigger new reads for unproven audio.
    if (
      !accountId ||
      !source ||
      source.accountId !== accountId ||
      source.fileId !== fileId
    )
      return;
    const capturedSource = { ...source };
    const accountFlight = get().setAccount(accountId);
    const generation = get().generation;
    await accountFlight;
    if (get().generation !== generation || get().accountId !== accountId)
      return;
    // Playback, visible rows and agents share the loader's single flight.
    const [
      { resolveKnownTrack },
      { ensureTrackMetadataFromBlob, isMetadataBlobCurrent },
    ] = await Promise.all([
      import("@/lib/known-track-resolver"),
      import("@/lib/track-metadata-loader"),
    ]);
    if (
      get().generation !== generation ||
      get().accountId !== accountId ||
      getLocalMetadataAccountId() !== accountId
    )
      return;
    const known = resolveKnownTrack(accountId, fileId);
    if (!known || !isMetadataBlobCurrent(known, blob, capturedSource)) return;
    await ensureTrackMetadataFromBlob(known, blob, capturedSource, {
      priority: "playback",
      deadline: Date.now() + 15000,
    });
  },

  resetCachedMetadata: (notify = true) => {
    const accountId = get().accountId;
    const generation = get().generation + 1;
    observedFingerprints.clear();
    accessedRecords.clear();
    retainedRecords.clear();
    set({
      generation,
      records: {},
      cache: {},
      hydrated: !accountId,
      durable: false,
    });
    if (!accountId) return pendingClear;
    let removalError: Error | undefined;
    // The initiating tab advances the shared epoch. Peers only adopt that epoch,
    // so a later peer notification cannot erase newly rebuilt records again.
    const flight = (notify ? clearAccount(accountId) : pendingClear)
      .then((cleared) => {
        if (notify && cleared === false)
          removalError = new Error(
            "Cached metadata could not be removed from this device.",
          );
        return loadMetadataCache(accountId);
      })
      .then(({ records, epoch, durable }) => {
        if (get().generation !== generation || get().accountId !== accountId) {
          if (removalError) throw removalError;
          return;
        }
        if (durable) storageEpoch = epoch;
        const byId: Record<string, MetadataRecord> = {};
        const cache: Record<string, CachedId3Metadata> = {};
        for (const record of records) {
          if (record.accountId !== accountId) continue;
          byId[record.fileId] = record;
          touchRecord(record.fileId);
          const projected = project(record);
          if (projected) cache[record.fileId] = projected;
        }
        set({ records: byId, cache, hydrated: true, durable });
        // Restore usable local state even when deletion failed, so the storage
        // panel can show the retained cache and offer another attempt.
        if (removalError) throw removalError;
        if (notify)
          try {
            localStorage.setItem(
              "drivebeats-metadata-cache-reset",
              JSON.stringify({ accountId, at: Date.now() }),
            );
          } catch {
            /* Durable epoch fencing still protects other tabs. */
          }
      })
      .finally(() => {
        if (hydrationFlight === flight) hydrationFlight = null;
      });
    hydrationFlight = flight;
    return flight;
  },

  clearAll: async (notify = true) => {
    const accountId = get().accountId ?? getRememberedMetadataAccountId();
    sealedAccount = accountId ?? sealedAccount;
    forgetLocalMetadataAccount();
    observedFingerprints.clear();
    accessedRecords.clear();
    retainedRecords.clear();
    hydrationFlight = null;
    set({
      generation: get().generation + 1,
      records: {},
      cache: {},
      accountId: null,
      hydrated: false,
      durable: false,
    });
    // Old unscoped localStorage data cannot prove account or content identity.
    try {
      if (typeof localStorage !== "undefined")
        localStorage.removeItem("drivebeats-id3-metadata");
    } catch {
      /* Optional legacy storage. */
    }
    if (accountId) {
      if (notify) notifyClear(accountId);
      await clearAccount(accountId);
    } else await pendingClear;
  },
}));

useAuthStore.subscribe((state, previous) => {
  if (state.isLoggingOut) {
    void useId3MetadataStore.getState().clearAll();
    return;
  }
  const account =
    state.authStatus === "authenticated" && !state.isLoggingOut
      ? (state.user?.id ?? null)
      : null;
  const oldAccount =
    previous.authStatus === "authenticated" && !previous.isLoggingOut
      ? (previous.user?.id ?? null)
      : null;
  if (account !== oldAccount) {
    if (account) sealedAccount = null;
    void useId3MetadataStore
      .getState()
      .setAccount(account ?? getLocalMetadataAccountId());
  }
});

const localAccount = getLocalMetadataAccountId();
if (localAccount) void useId3MetadataStore.getState().setAccount(localAccount);
