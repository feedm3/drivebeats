import { AppDataError } from "@/db/appdata-types";
import { getSql } from "@/db/client";
export async function appDataRows(
  strings: TemplateStringsArray,
  ...values: unknown[]
) {
  return (await getSql()(strings, ...values)) as Record<string, unknown>[];
}
export async function appDataStep<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppDataError) throw error;
    const message = error instanceof Error ? error.message : "";
    throw new AppDataError(
      message.match(/appdata_[a-z_]+/)?.[0] ?? "appdata_control_unavailable",
    );
  }
}
