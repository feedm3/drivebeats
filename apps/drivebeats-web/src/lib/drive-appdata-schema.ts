import { z } from "zod";
import {
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
  METADATA_SCHEMA_VERSION,
} from "@/lib/metadata-cache-types";
import {
  MAX_PLAYLISTS_PER_USER,
  MAX_TRACKS_PER_PLAYLIST,
} from "@/lib/playlist-limits";

export const APPDATA_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const APPDATA_MAX_TAG_BYTES = 256 * 1024;
export const APPDATA_MAX_RESTORE_BYTES = 64 * 1024 * 1024;
export const appDataIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_:.-]+$/);
const name = z.string().max(1024);
const parents = z.array(appDataIdSchema).max(100).optional();
const size = z.string().max(32).regex(/^\d+$/).optional();
const modifiedTime = z.string().max(64).optional();
const mimeType = z.string().max(256).optional();

export const appDataDriveFileSchema = z.strictObject({
  id: appDataIdSchema,
  name,
  mimeType: z.string().min(1).max(256),
  size,
  modifiedTime,
  parents,
  parentFolderName: name.optional(),
});
const trackSchema = z.strictObject({
  fileId: appDataIdSchema,
  fileName: name,
  mimeType,
  size,
  modifiedTime,
  parents,
  parentFolderName: name.optional(),
});
const playlistSchema = z.strictObject({
  id: appDataIdSchema,
  name: z.string().min(1).max(100),
  tracks: z.array(trackSchema).max(MAX_TRACKS_PER_PLAYLIST),
});
const collectionsShape = {
  playlists: z.array(playlistSchema).max(MAX_PLAYLISTS_PER_USER),
  favorites: z.array(trackSchema).max(10000),
};
export const appDataCollectionsSchema = z.strictObject(collectionsShape);
const commandResultSchema = z.strictObject({
  trackCount: z.number().int().nonnegative().optional(),
  addedCount: z.number().int().nonnegative().optional(),
  duplicateCount: z.number().int().nonnegative().optional(),
  skippedCount: z.number().int().nonnegative().optional(),
  reachedTrackLimit: z.boolean().optional(),
});
export const appDataMetadataRecordSchema = z.strictObject({
  accountId: appDataIdSchema,
  fileId: appDataIdSchema,
  fingerprint: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => {
      try {
        const parts = JSON.parse(value);
        return (
          Array.isArray(parts) &&
          parts.length === 2 &&
          typeof parts[0] === "string" &&
          parts[0].length > 0 &&
          typeof parts[1] === "string" &&
          /^\d+$/.test(parts[1])
        );
      } catch {
        return false;
      }
    }),
  parserVersion: z.literal(METADATA_PARSER_VERSION),
  policyVersion: z.literal(METADATA_POLICY_VERSION),
  schemaVersion: z.literal(METADATA_SCHEMA_VERSION),
  checkedAt: z.number().finite().nonnegative(),
  checkedFields: z.tuple([
    z.literal("title"),
    z.literal("artist"),
    z.literal("album"),
  ]),
  status: z.enum(["ready", "no_target_tags"]),
  tags: z
    .strictObject({
      title: z.string().max(500).optional(),
      artist: z.string().max(500).optional(),
      album: z.string().max(500).optional(),
    })
    .optional(),
  loadedVia: z.enum(["local_blob", "drive_range"]),
  mimeType,
});
const rootOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("add"),
    rootKind: z.enum(["folder", "track"]),
    id: appDataIdSchema,
    descriptor: appDataDriveFileSchema,
    sourceRevision: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal("remove"),
    rootKind: z.enum(["folder", "track"]),
    id: appDataIdSchema,
    sourceRevision: z.number().int().positive().optional(),
  }),
]);
export const appDataAppendSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tags"),
    operationId: appDataIdSchema.max(128),
    baseRevision: z.number().int().nonnegative().optional(),
    payload: z.strictObject({
      records: z.array(appDataMetadataRecordSchema).min(1).max(256),
    }),
  }),
  z.strictObject({
    kind: z.literal("roots"),
    operationId: appDataIdSchema.max(128),
    baseRevision: z.number().int().nonnegative(),
    payload: z.strictObject({
      operations: z.array(rootOperationSchema).min(1).max(256),
    }),
  }),
  z.strictObject({
    kind: z.literal("collections"),
    operationId: appDataIdSchema.max(128),
    baseRevision: z.number().int().nonnegative(),
    payload: z.strictObject({
      ...collectionsShape,
      commandHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      result: commandResultSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("migration"),
    operationId: appDataIdSchema.max(128),
    baseRevision: z.number().int().nonnegative(),
    payload: appDataCollectionsSchema,
  }),
]);
export type AppDataAppendInput = z.infer<typeof appDataAppendSchema>;
export type AppDataEnvelope = AppDataAppendInput & {
  format: 1;
  accountId: string;
  generation: string;
  revision: number;
};

export function parseAppDataEnvelope(value: unknown): AppDataEnvelope {
  const header = z
    .object({
      format: z.literal(1),
      accountId: appDataIdSchema,
      generation: z.uuid(),
      revision: z.number().int().positive(),
    })
    .parse(value);
  const { format, accountId, generation, revision, ...command } =
    value as Record<string, unknown>;
  void format;
  void accountId;
  void generation;
  void revision;
  return { ...appDataAppendSchema.parse(command), ...header };
}
