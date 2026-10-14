// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("lets Google reuse an existing approval when signing in after logout", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://drivebeats.test");
  const response = await GET(
    new NextRequest("https://drivebeats.test/api/auth/login"),
  );
  const authorization = new URL(response.headers.get("location") ?? "");
  expect(authorization.searchParams.get("prompt")).toBeNull();
  expect(authorization.searchParams.get("access_type")).toBe("offline");
  expect(authorization.searchParams.get("state")).toBe(
    response.cookies.get("oauth_state")?.value,
  );
});
