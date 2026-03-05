import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  setTokens: (
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
  ) => void;
  clearTokens: () => void;
  isAuthenticated: () => boolean;
  isTokenExpired: () => boolean;
  refreshAccessToken: () => Promise<boolean>;
  getValidAccessToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken:
    typeof window !== "undefined"
      ? sessionStorage.getItem("refresh_token")
      : null,
  expiresAt: null,

  setTokens: (accessToken, refreshToken, expiresAt) => {
    sessionStorage.setItem("refresh_token", refreshToken);
    set({ accessToken, refreshToken, expiresAt });
  },

  clearTokens: () => {
    sessionStorage.removeItem("refresh_token");
    set({ accessToken: null, refreshToken: null, expiresAt: null });
  },

  isAuthenticated: () => {
    const { accessToken, refreshToken } = get();
    return !!(accessToken || refreshToken);
  },

  isTokenExpired: () => {
    const { expiresAt } = get();
    if (!expiresAt) return true;
    return Date.now() > expiresAt - 60_000; // 1 min buffer
  },

  refreshAccessToken: async () => {
    const { refreshToken } = get();
    if (!refreshToken) return false;

    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) {
        get().clearTokens();
        return false;
      }

      const data = await res.json();
      set({ accessToken: data.access_token, expiresAt: data.expires_at });
      return true;
    } catch {
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
}));
