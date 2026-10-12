import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineDownloadDiagnostics,
  exportOfflineDownloadDiagnostics,
  recordOfflineDownloadDiagnostic,
} from "@/lib/offline-download-diagnostics";

beforeEach(() => {
  localStorage.clear();
});

describe("offline download diagnostics", () => {
  it("keeps only the newest 100 allowlisted events", async () => {
    for (let index = 0; index < 105; index += 1) {
      await recordOfflineDownloadDiagnostic({
        timestamp: index,
        trigger: "online",
        generation: index,
        outcome: "queued",
      });
    }

    const exported = JSON.parse(exportOfflineDownloadDiagnostics());
    expect(exported.events).toHaveLength(100);
    expect(exported.events[0].generation).toBe(5);
    expect(exportOfflineDownloadDiagnostics().length).toBeLessThanOrEqual(
      64 * 1024,
    );
  });

  it("never exports raw identifiers, filenames, tokens, headers, bodies, or error text", async () => {
    await recordOfflineDownloadDiagnostic({
      timestamp: 1,
      trigger: "pageshow",
      generation: 2,
      phase: "fetching",
      errorCategory: "network",
      rawTrackId: "drive-file-secret-123",
      fileName: "Private Song.mp3",
      token: "ya29.oauth-secret",
      authorization: "Bearer ya29.oauth-secret",
      responseBody: '{"email":"person@example.com"}',
      error: new Error("injected secret message"),
    });

    const exported = exportOfflineDownloadDiagnostics();
    expect(exported).not.toContain("drive-file-secret-123");
    expect(exported).not.toContain("Private Song.mp3");
    expect(exported).not.toContain("ya29");
    expect(exported).not.toContain("Authorization");
    expect(exported).not.toContain("person@example.com");
    expect(exported).not.toContain("injected secret message");
    expect(JSON.parse(exported).events[0]).toEqual({
      timestamp: 1,
      trigger: "pageshow",
      generation: 2,
      phase: "fetching",
      errorCategory: "network",
    });
  });

  it("evicts older events when the serialized-size bound is reached", async () => {
    for (let index = 0; index < 100; index += 1) {
      await recordOfflineDownloadDiagnostic({
        timestamp: index,
        trigger: "collection-enable",
        generation: Number.MAX_VALUE,
        attempt: Number.MAX_VALUE,
        phase: "authorizing",
        elapsedMs: Number.MAX_VALUE,
        httpStatusClass: 500,
        blobSize: Number.MAX_VALUE,
        errorName: "QuotaExceededError",
        errorCategory: "storage-unavailable",
        storagePersistence: "not-granted",
        storageUsage: Number.MAX_VALUE,
        storageQuota: Number.MAX_VALUE,
        visible: true,
        outcome: "superseded",
      });
    }

    const exported = exportOfflineDownloadDiagnostics();
    expect(exported.length).toBeLessThanOrEqual(16 * 1024);
    expect(JSON.parse(exported).events.length).toBeLessThan(100);
  });

  it("clears the local buffer", async () => {
    await recordOfflineDownloadDiagnostic({
      timestamp: 1,
      trigger: "start",
      outcome: "queued",
    });

    clearOfflineDownloadDiagnostics();

    expect(JSON.parse(exportOfflineDownloadDiagnostics()).events).toEqual([]);
  });
});
