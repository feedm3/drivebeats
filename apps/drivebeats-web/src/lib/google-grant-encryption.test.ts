// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./google-grant-encryption";

afterEach(() => vi.unstubAllEnvs());

it("rejects ciphertext transplanted between accounts, tampering, and a changed key", () => {
  vi.stubEnv("AUTH_SESSION_SECRET", "test-key");
  const encrypted = encryptGoogleRefreshToken(
    "private-refresh-token",
    "account-a",
  );
  expect(decryptGoogleRefreshToken(encrypted, "account-a")).toBe(
    "private-refresh-token",
  );
  expect(encrypted).not.toContain("private-refresh-token");
  expect(
    encryptGoogleRefreshToken("private-refresh-token", "account-a"),
  ).not.toBe(encrypted);
  expect(() => decryptGoogleRefreshToken(encrypted, "account-b")).toThrow();
  const segments = encrypted.split(".");
  segments[3] = Buffer.from("tampered").toString("base64url");
  expect(() =>
    decryptGoogleRefreshToken(segments.join("."), "account-a"),
  ).toThrow();
  vi.stubEnv("AUTH_SESSION_SECRET", "changed-key");
  expect(() => decryptGoogleRefreshToken(encrypted, "account-a")).toThrow();
});
