import { scanMetadataRecords } from "@/lib/metadata-cache-db";

export interface MetadataCacheUsage {
  recordCount: number;
  approximateBytes: number;
}

/** Serialized payload estimate, excluding IndexedDB indexes and browser overhead. */
export async function getMetadataCacheUsage(
  accountId: string,
  signal?: AbortSignal,
): Promise<MetadataCacheUsage | null> {
  const usage = { recordCount: 0, approximateBytes: 0 };
  const encoder = new TextEncoder();
  const available = await scanMetadataRecords(
    accountId,
    (record) => {
      usage.recordCount++;
      usage.approximateBytes += encoder.encode(JSON.stringify(record)).length;
    },
    signal,
  );
  return available ? usage : null;
}
