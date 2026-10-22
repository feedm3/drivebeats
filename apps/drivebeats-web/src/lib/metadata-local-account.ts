import { useAuthStore } from "@/stores/auth-store";

const ACCOUNT_KEY = "drivebeats-metadata-local-account";

export function getRememberedMetadataAccountId(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/** Remembered namespaces authorize local offline data, never Drive requests. */
export function getLocalMetadataAccountId(): string | null {
  const auth = useAuthStore.getState();
  if (auth.isLoggingOut) return null;
  if (auth.authStatus === "authenticated" && auth.user) return auth.user.id;
  if (typeof navigator === "undefined" || navigator.onLine !== false)
    return null;
  return getRememberedMetadataAccountId();
}

export function rememberLocalMetadataAccount(accountId: string) {
  const auth = useAuthStore.getState();
  if (
    auth.isLoggingOut ||
    auth.authStatus !== "authenticated" ||
    auth.user?.id !== accountId
  )
    return;
  try {
    localStorage.setItem(ACCOUNT_KEY, accountId);
  } catch {
    /* Optional persistence. */
  }
}

export function forgetLocalMetadataAccount() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* Optional persistence. */
  }
}
