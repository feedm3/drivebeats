import { create } from "zustand";
import type { AuthUser } from "@/lib/auth-session";

const REFRESH_FAILURE_COOLDOWN_MS = 5_000;
// Keep the module-level single-flight owner recoverable when WebKit leaves a
// refresh request unresolved during suspension or a network transition.
const REFRESH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * `/api/auth/refresh` answers with these statuses only when the session itself
 * is no longer usable: missing/invalid auth session cookie, missing Drive
 * scope, or a refresh token Google rejected. Every other failure (5xx, 429,
 * a thrown fetch, a malformed payload) is transient and must not sign the user
 * out of an installed PWA.
 */
const INVALID_SESSION_STATUSES = new Set([401, 403]);

let refreshAccessTokenPromise: Promise<boolean> | null = null;
let lastRefreshFailureAt = 0;
let logoutPromise: Promise<void> | null = null;

/**
 * Rate limits refresh attempts after any failure, transient or authoritative,
 * so a broken connection cannot turn into a tight retry loop. It expires on its
 * own after `REFRESH_FAILURE_COOLDOWN_MS` and is reset on every success, so it
 * can never permanently wedge a session that is still valid.
 */
function isWithinRefreshCooldown() {
  return (
    lastRefreshFailureAt !== 0 &&
    Date.now() - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS
  );
}

async function fetchRefreshWithTimeout(): Promise<{
  response: Response;
  data?: unknown;
}> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Refresh request timed out", "TimeoutError"));
    }, REFRESH_REQUEST_TIMEOUT_MS);
  });
  const request = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      signal: controller.signal,
    });
    // Keep the same deadline through successful body consumption. Fetch can
    // resolve after headers while WebKit leaves the body stream suspended.
    const data = response.ok ? await response.json() : undefined;
    return { response, data };
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  authStatus: AuthStatus;
  isLoggingOut: boolean;
  hydrateServerSession: (user: AuthUser | null) => void;
  setTokens: (accessToken: string, expiresAt: number) => void;
  setLoggingOut: (isLoggingOut: boolean) => void;
  clearTokens: () => void;
  hasSession: () => boolean;
  isAuthenticated: () => boolean;
  isTokenExpired: () => boolean;
  refreshAccessToken: () => Promise<boolean>;
  getValidAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  expiresAt: null,
  user: null,
  authStatus: "unknown",
  isLoggingOut: false,

  hydrateServerSession: (user) => {
    if (!user) {
      return;
    }

    set((state) => {
      if (
        state.authStatus === "authenticated" &&
        state.user?.id === user.id &&
        state.user.email === user.email &&
        state.user.name === user.name &&
        state.user.picture === user.picture
      ) {
        return state;
      }

      return {
        user,
        authStatus: "authenticated",
        isLoggingOut: false,
      };
    });
  },

  setTokens: (accessToken, expiresAt) => {
    lastRefreshFailureAt = 0;
    set({
      accessToken,
      expiresAt,
      authStatus: "authenticated",
      isLoggingOut: false,
    });
  },

  setLoggingOut: (isLoggingOut) => {
    set({ isLoggingOut });
  },

  clearTokens: () => {
    set({
      accessToken: null,
      expiresAt: null,
      user: null,
      authStatus: "unauthenticated",
    });
  },

  hasSession: () => {
    return get().authStatus === "authenticated" && !!get().user;
  },

  isAuthenticated: () => {
    return !!get().accessToken && !get().isTokenExpired();
  },

  isTokenExpired: () => {
    const { expiresAt } = get();
    if (!expiresAt) return true;
    return Date.now() > expiresAt - 60_000; // 1 min buffer
  },

  refreshAccessToken: async () => {
    if (refreshAccessTokenPromise) {
      return refreshAccessTokenPromise;
    }

    if (isWithinRefreshCooldown()) {
      return false;
    }

    refreshAccessTokenPromise = (async () => {
      try {
        const { response: res, data: rawData } =
          await fetchRefreshWithTimeout();

        // Only an authoritative rejection ends the session.
        if (INVALID_SESSION_STATUSES.has(res.status)) {
          lastRefreshFailureAt = Date.now();
          get().clearTokens();
          return false;
        }

        // 5xx, 429, and anything else: transient, keep the session intact.
        if (!res.ok) {
          lastRefreshFailureAt = Date.now();
          return false;
        }

        const data = rawData as Partial<{
          access_token: string;
          expires_at: number;
          user: AuthUser | null;
        }>;

        // A malformed 200 payload is a server problem, not an invalid session.
        if (
          typeof data.access_token !== "string" ||
          typeof data.expires_at !== "number"
        ) {
          lastRefreshFailureAt = Date.now();
          return false;
        }

        lastRefreshFailureAt = 0;
        set({
          accessToken: data.access_token,
          expiresAt: data.expires_at,
          user: data.user ?? null,
          authStatus: "authenticated",
          isLoggingOut: false,
        });
        return true;
      } catch {
        // Offline or a network-layer failure. Never a session verdict.
        lastRefreshFailureAt = Date.now();
        return false;
      } finally {
        refreshAccessTokenPromise = null;
      }
    })();

    return refreshAccessTokenPromise;
  },

  getValidAccessToken: async () => {
    const state = get();
    if (state.accessToken && !state.isTokenExpired()) {
      return state.accessToken;
    }

    if (isWithinRefreshCooldown()) {
      return null;
    }

    const ok = await state.refreshAccessToken();
    return ok ? get().accessToken : null;
  },

  logout: async () => {
    if (logoutPromise) {
      return logoutPromise;
    }

    lastRefreshFailureAt = Date.now();
    get().setLoggingOut(true);
    get().clearTokens();

    logoutPromise = fetch("/api/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        logoutPromise = null;
      });

    await logoutPromise;
  },
}));
