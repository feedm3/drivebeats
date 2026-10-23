import { AppDataError } from "@/db/appdata-types";
import { appDataAppendSchema } from "@/lib/drive-appdata-schema";

/** Bound client tag/root commands before parsing; collection commands use their own API. */
export async function readAppDataCommand(request: Request, generation: string) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppDataError("appdata_invalid_request");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 512 * 1024) {
        await reader.cancel();
        throw new AppDataError("appdata_request_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppDataError("appdata_invalid_request");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppDataError("appdata_invalid_request");
  const input = value as Record<string, unknown>;
  if (
    input.generation !== generation ||
    !["tags", "roots"].includes(String(input.kind))
  )
    throw new AppDataError("appdata_invalid_request");
  if (input.kind === "roots") {
    const operations = (input.payload as { operations?: unknown } | undefined)
      ?.operations;
    if (
      !Array.isArray(operations) ||
      operations.some(
        (operation) =>
          operation &&
          typeof operation === "object" &&
          "sourceRevision" in operation,
      )
    )
      throw new AppDataError("appdata_invalid_request");
  }
  const { generation: _generation, ...command } = input;
  const result = appDataAppendSchema.safeParse(command);
  if (!result.success) throw new AppDataError("appdata_invalid_request");
  return result.data;
}
