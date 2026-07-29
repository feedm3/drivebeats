import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth-session";

const testUser: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  picture: null,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * The module keeps the single-flight promise and the failure cooldown in
 * module scope, so every test needs a fresh copy of the store.
 */
async function loadAuthStore() {
  vi.resetModules();
  const { useAuthStore } = await import("@/stores/auth-store");
  return useAuthStore;
}

describe("refreshAccessToken failure handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the session when the server rejects the refresh token with 401", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "No refresh token provided" }),
    );

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      false,
    );

    const state = useAuthStore.getState();
    expect(state.authStatus).toBe("unauthenticated");
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it("clears the session when the server answers 403", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "Forbidden" }));

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      false,
    );
    expect(useAuthStore.getState().authStatus).toBe("unauthenticated");
  });

  it("keeps the session when the request throws (offline device)", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      false,
    );

    const state = useAuthStore.getState();
    expect(state.authStatus).toBe("authenticated");
    expect(state.user).toEqual(testUser);
  });

  it("keeps the session when the server answers 500", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: "Internal Server Error" }),
    );

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      false,
    );

    const state = useAuthStore.getState();
    expect(state.authStatus).toBe("authenticated");
    expect(state.user).toEqual(testUser);
  });

  it("keeps the session when a 200 payload is malformed", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { unexpected: true }));

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      false,
    );
    expect(useAuthStore.getState().authStatus).toBe("authenticated");
  });

  it("stores the new token on success", async () => {
    const useAuthStore = await loadAuthStore();
    const expiresAt = Date.now() + 3_600_000;

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "fresh-token",
        expires_at: expiresAt,
        user: testUser,
      }),
    );

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
      true,
    );

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe("fresh-token");
    expect(state.expiresAt).toBe(expiresAt);
    expect(state.authStatus).toBe("authenticated");
  });

  it("de-duplicates concurrent refreshes into a single request", async () => {
    const useAuthStore = await loadAuthStore();

    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        access_token: "fresh-token",
        expires_at: Date.now() + 3_600_000,
        user: testUser,
      }),
    );

    const results = await Promise.all([
      useAuthStore.getState().refreshAccessToken(),
      useAuthStore.getState().refreshAccessToken(),
      useAuthStore.getState().refreshAccessToken(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out a hung refresh and permits a later successful refresh", async () => {
    vi.useFakeTimers();
    try {
      const useAuthStore = await loadAuthStore();
      useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
      useAuthStore.setState({ user: testUser });

      fetchMock.mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
          }),
      );

      const timedOutRefresh = useAuthStore.getState().refreshAccessToken();
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(timedOutRefresh).resolves.toBe(false);
      expect(useAuthStore.getState().authStatus).toBe("authenticated");

      await vi.advanceTimersByTimeAsync(5_001);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "recovered-token",
          expires_at: Date.now() + 3_600_000,
          user: testUser,
        }),
      );

      await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
        true,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState().accessToken).toBe("recovered-token");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung successful response body and clears the single flight", async () => {
    vi.useFakeTimers();
    try {
      const useAuthStore = await loadAuthStore();
      useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
      useAuthStore.setState({ user: testUser });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => new Promise<never>(() => undefined),
      } as unknown as Response);

      const timedOutRefresh = useAuthStore.getState().refreshAccessToken();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(timedOutRefresh).resolves.toBe(false);

      await vi.advanceTimersByTimeAsync(5_001);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "body-recovered-token",
          expires_at: Date.now() + 3_600_000,
          user: testUser,
        }),
      );

      await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
        true,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate limits retries after a transient failure", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().refreshAccessToken();
    await useAuthStore.getState().refreshAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().authStatus).toBe("authenticated");
  });

  it("retries once the cooldown has elapsed", async () => {
    vi.useFakeTimers();
    try {
      const useAuthStore = await loadAuthStore();
      useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);

      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await useAuthStore.getState().refreshAccessToken();

      vi.advanceTimersByTime(6_000);

      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "recovered-token",
          expires_at: Date.now() + 3_600_000,
          user: testUser,
        }),
      );

      await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe(
        true,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState().accessToken).toBe("recovered-token");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getValidAccessToken", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the cached token while it is still valid", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("valid-token", Date.now() + 3_600_000);

    await expect(useAuthStore.getState().getValidAccessToken()).resolves.toBe(
      "valid-token",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null without clearing the session on a network failure", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);
    useAuthStore.setState({ user: testUser });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      useAuthStore.getState().getValidAccessToken(),
    ).resolves.toBeNull();
    expect(useAuthStore.getState().authStatus).toBe("authenticated");
  });

  it("returns null and clears the session on 401", async () => {
    const useAuthStore = await loadAuthStore();
    useAuthStore.getState().setTokens("stale-token", Date.now() - 1_000);

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "nope" }));

    await expect(
      useAuthStore.getState().getValidAccessToken(),
    ).resolves.toBeNull();
    expect(useAuthStore.getState().authStatus).toBe("unauthenticated");
  });
});
