const STORAGE_KEY = "drivebeats-offline-download-diagnostics:v1";
const MAX_EVENTS = 100;
const MAX_SERIALIZED_BYTES = 16 * 1024;

const TRIGGERS = new Set([
  "start",
  "online",
  "pageshow",
  "visibility",
  "cloud-update",
  "auth-ready",
  "retry",
  "collection-enable",
  "collection-remove",
  "remove-all",
]);
const PHASES = new Set([
  "idle",
  "authorizing",
  "fetching",
  "reading",
  "storing",
]);
const ERROR_CATEGORIES = new Set([
  "network",
  "timeout",
  "auth-required",
  "access-denied",
  "missing-file",
  "rate-limited",
  "server",
  "storage-full",
  "storage-unavailable",
  "integrity",
  "unknown",
]);
const OUTCOMES = new Set([
  "queued",
  "started",
  "downloaded",
  "failed",
  "superseded",
  "removed",
  "reconciled",
]);
const PERSISTENCE_STATUSES = new Set([
  "unknown",
  "granted",
  "not-granted",
  "unsupported",
]);

type DiagnosticEvent = Record<string, string | number | boolean>;

function readEvents(): DiagnosticEvent[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (event): event is DiagnosticEvent =>
            typeof event === "object" && event !== null,
        )
      : [];
  } catch {
    return [];
  }
}

function capabilities() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { ios: false, standalone: false };
  }
  return {
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent),
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  };
}

function serialize(events: DiagnosticEvent[]) {
  return JSON.stringify({
    format: "drivebeats-offline-diagnostics-v1",
    capabilities: capabilities(),
    events,
  });
}

function copyEnum(
  target: DiagnosticEvent,
  source: Record<string, unknown>,
  key: string,
  values: ReadonlySet<string>,
) {
  const value = source[key];
  if (typeof value === "string" && values.has(value)) {
    target[key] = value;
  }
}

function copyNumber(
  target: DiagnosticEvent,
  source: Record<string, unknown>,
  key: string,
) {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function sanitize(input: Record<string, unknown>): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp:
      typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
        ? input.timestamp
        : Date.now(),
  };

  copyEnum(event, input, "trigger", TRIGGERS);
  copyEnum(event, input, "phase", PHASES);
  copyEnum(event, input, "errorCategory", ERROR_CATEGORIES);
  copyEnum(event, input, "outcome", OUTCOMES);
  copyEnum(event, input, "storagePersistence", PERSISTENCE_STATUSES);
  for (const key of [
    "generation",
    "attempt",
    "elapsedMs",
    "httpStatusClass",
    "blobSize",
    "storageUsage",
    "storageQuota",
  ]) {
    copyNumber(event, input, key);
  }
  if (typeof input.visible === "boolean") event.visible = input.visible;
  if (
    typeof input.errorName === "string" &&
    [
      "AbortError",
      "QuotaExceededError",
      "UnknownError",
      "TimeoutError",
    ].includes(input.errorName)
  ) {
    event.errorName = input.errorName;
  }

  return event;
}

export async function recordOfflineDownloadDiagnostic(
  input: Record<string, unknown>,
): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    const events = [...readEvents(), sanitize(input)].slice(-MAX_EVENTS);
    while (
      events.length > 0 &&
      serialize(events).length > MAX_SERIALIZED_BYTES
    ) {
      events.shift();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics are best-effort and must never interfere with downloads.
  }
}

export function exportOfflineDownloadDiagnostics(): string {
  return serialize(readEvents());
}

export function clearOfflineDownloadDiagnostics(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function hasOfflineDownloadDiagnostics(): boolean {
  return readEvents().length > 0;
}
