import { create } from "zustand";
import type { AuthUser } from "@/lib/auth-session";

const REFRESH_FAILURE_COOLDOWN_MS = 5_000;

let refreshAccessTokenPromise: Promise<boolean> | null = null;
let lastRefreshFailureAt = 0;
let logoutPromise: Promise<void> | null = null;

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

    const state = get();
    if (
      state.authStatus === "unauthenticated" &&
      Date.now() - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS
    ) {
      return false;
    }

    refreshAccessTokenPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
        });

        if (!res.ok) {
          lastRefreshFailureAt = Date.now();
          get().clearTokens();
          return false;
        }

        const data = (await res.json()) as Partial<{
          access_token: string;
          expires_at: number;
          user: AuthUser | null;
        }>;

        if (
          typeof data.access_token !== "string" ||
          typeof data.expires_at !== "number"
        ) {
          lastRefreshFailureAt = Date.now();
          get().clearTokens();
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
        lastRefreshFailureAt = Date.now();
        get().clearTokens();
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

    if (
      state.authStatus === "unauthenticated" &&
      Date.now() - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS
    ) {
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
