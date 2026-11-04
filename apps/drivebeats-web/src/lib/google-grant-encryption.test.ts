// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  decryptGoogleRefreshToken,
  decryptSessionGoogleGrant,
  encryptGoogleRefreshToken,
  encryptSessionGoogleGrant,
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

it("binds session grants to both the Google account and OAuth client", () => {
  vi.stubEnv("AUTH_SESSION_SECRET", "test-key");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-a");
  const encrypted = encryptSessionGoogleGrant(
    "session-refresh",
    "account-a",
    "session-a",
  );
  expect(decryptSessionGoogleGrant(encrypted, "account-a", "session-a")).toBe(
    "session-refresh",
  );
  expect(encrypted).not.toContain("session-refresh");
  expect(() =>
    decryptSessionGoogleGrant(encrypted, "account-b", "session-a"),
  ).toThrow();
  expect(() =>
    decryptSessionGoogleGrant(encrypted, "account-a", "session-b"),
  ).toThrow();
  expect(() => decryptGoogleRefreshToken(encrypted, "account-a")).toThrow();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-b");
  expect(() =>
    decryptSessionGoogleGrant(encrypted, "account-a", "session-a"),
  ).toThrow();
});
