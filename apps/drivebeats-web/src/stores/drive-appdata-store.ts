import { create } from "zustand";

export interface DriveAppDataState {
  accountId: string | null;
  generation: string | null;
  status: "idle" | "restoring" | "ready" | "error";
  savedCount: number;
  pendingCount: number;
  approximateBytes: number;
  lastSavedAt: number | null;
  error: string | null;
  cutoff: string | null;
  migrationVersion: number;
}

/** Counts acknowledge completed server saves, never merely locally queued records. */
export const useDriveAppDataStore = create<DriveAppDataState>(() => ({
  accountId: null,
  generation: null,
  status: "idle",
  savedCount: 0,
  pendingCount: 0,
  approximateBytes: 0,
  lastSavedAt: null,
  error: null,
  cutoff: null,
  migrationVersion: 0,
}));
