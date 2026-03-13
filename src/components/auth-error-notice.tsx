"use client";

import { useSearchParams } from "next/navigation";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  authentication_failed:
    "Google sign-in could not be completed for this account. Try again with an approved test user.",
  invalid_oauth_state: "Your Google sign-in session expired. Please try again.",
  missing_oauth_state: "Your Google sign-in session expired. Please try again.",
  missing_drive_scope:
    "Google sign-in completed, but Google Drive access was not granted. Sign in again and allow file access so the picker can work.",
  missing_refresh_token:
    "Google did not return a reusable session token for this account. Try again with an approved test user.",
  oauth_denied: "Google sign-in was cancelled before access was granted.",
  token_exchange_failed:
    "Google sign-in completed, but the app could not start a Drive session for this account.",
};

export function AuthErrorNotice() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("authError");

  if (!authError) {
    return null;
  }

  const message =
    AUTH_ERROR_MESSAGES[authError] ??
    "Google sign-in could not be completed. Please try again.";

  return (
    <div className="w-full max-w-2xl rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
      {message}
    </div>
  );
}
