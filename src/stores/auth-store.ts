import { create } from "zustand";
import type { AuthUser } from "@/lib/auth-session";

interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  setTokens: (accessToken: string, expiresAt: number) => void;
  clearTokens: () => void;
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

  setTokens: (accessToken, expiresAt) => {
    set({ accessToken, expiresAt });
  },

  clearTokens: () => {
    set({ accessToken: null, expiresAt: null, user: null });
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
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
      });

      if (!res.ok) {
        get().clearTokens();
        return false;
      }

      const data = await res.json();
      set({
        accessToken: data.access_token,
        expiresAt: data.expires_at,
        user: data.user ?? null,
      });
      return true;
    } catch {
      get().clearTokens();
      return false;
    }
  },

  getValidAccessToken: async () => {
    const state = get();
    if (state.accessToken && !state.isTokenExpired()) {
      return state.accessToken;
    }
    const ok = await state.refreshAccessToken();
    return ok ? get().accessToken : null;
  },

  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    get().clearTokens();
  },
}));
