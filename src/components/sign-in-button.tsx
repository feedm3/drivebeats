"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";

interface SignInButtonProps {
  className: string;
}

export function SignInButton({ className }: SignInButtonProps) {
  const router = useRouter();
  const getValidAccessToken = useAuthStore(
    (state) => state.getValidAccessToken,
  );
  const [checkingSession, setCheckingSession] = useState(false);

  const onSignIn = async () => {
    if (checkingSession) {
      return;
    }

    setCheckingSession(true);
    const token = await getValidAccessToken();

    if (token) {
      router.push("/app");
      router.refresh();
      return;
    }

    window.location.href = "/api/auth/login";
  };

  return (
    <button
      type="button"
      className={className}
      onClick={onSignIn}
      disabled={checkingSession}
    >
      {checkingSession ? "Checking session..." : "Sign in with Google"}
    </button>
  );
}
