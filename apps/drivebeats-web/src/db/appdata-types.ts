export interface AppDataIdentity {
  accountId: string;
  generation: string;
}
export interface AppDataAccount extends AppDataIdentity {
  state: "active" | "deleting" | "deleted";
  source: "legacy" | "migrating" | "drive";
  revision: number;
  migrationVersion: number;
}
export interface AppDataRollout {
  implementedAt: string;
  cleanupDueAt: string;
  legacyRetired: boolean;
}
export interface AppDataOperation extends AppDataIdentity {
  operationId: string;
  revision: number;
  kind: "tags" | "roots" | "collections" | "migration";
  bodyHash: string;
  fileId: string;
  bytes: number;
  status:
    | "reserved"
    | "uploading"
    | "uncertain"
    | "committed"
    | "cancelled"
    | "superseded";
  unresolvedUpload: boolean;
  savedAt: string | null;
  commandHash?: string;
  commandResult?: Record<string, number | boolean>;
}
export interface AppDataReservation {
  coveredSources?: string[];
  operationId: string;
  kind: AppDataOperation["kind"];
  bodyHash: string;
  fileId: string;
  bytes: number;
  baseRevision?: number;
  migrationIsEmpty: boolean;
  commandHash?: string;
  commandResult?: Record<string, number | boolean>;
}
export class AppDataError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface AppDataControl {
  assertIdentity(identity: AppDataIdentity): Promise<AppDataAccount>;
  getRollout(): Promise<AppDataRollout | null>;
  reserve(
    identity: AppDataIdentity,
    input: AppDataReservation,
  ): Promise<AppDataOperation>;
  startUpload(
    identity: AppDataIdentity,
    operationId: string,
    recover?: boolean,
  ): Promise<string | null>;
  finishUpload(
    identity: AppDataIdentity,
    operationId: string,
    attemptId: string,
    unknown: boolean,
  ): Promise<void>;
  complete(
    identity: AppDataIdentity,
    operationId: string,
    uploadSettled?: boolean,
  ): Promise<AppDataOperation>;
  release(identity: AppDataIdentity, operationId: string): Promise<void>;
  list(identity: AppDataIdentity): Promise<AppDataOperation[]>;
  find(
    identity: AppDataIdentity,
    operationId: string,
  ): Promise<AppDataOperation | null>;
  listPending(identity: AppDataIdentity): Promise<AppDataOperation[]>;
  listAccountPending(identity: AppDataIdentity): Promise<AppDataOperation[]>;
  listPrunable(identity: AppDataIdentity): Promise<AppDataOperation[]>;
  markPruned(identity: AppDataIdentity, operationId: string): Promise<void>;
  fence(identity: AppDataIdentity): Promise<void>;
  finishDeletion(identity: AppDataIdentity): Promise<void>;
  resetAccount(identity: AppDataIdentity): Promise<AppDataAccount>;
  prepareReset(identity: AppDataIdentity): Promise<void>;
}
