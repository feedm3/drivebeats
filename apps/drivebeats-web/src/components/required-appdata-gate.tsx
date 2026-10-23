"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppLoadingShell } from "@/components/app-loading-shell";
import { LogoutConfirmationDialog } from "@/components/logout-confirmation-dialog";
import { StorageDialog } from "@/components/storage-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearVerifiedAppDataReadiness,
  hasVerifiedAppDataReadiness,
  saveVerifiedAppDataReadiness,
} from "@/lib/appdata-readiness";
import type { AuthUser } from "@/lib/auth-session";
import {
  deferDriveAppDataRestore,
  restoreDriveAppData,
} from "@/lib/drive-appdata-client";
import { hasRequiredGoogleScopes } from "@/lib/google-scopes";
import { useAuthStore } from "@/stores/auth-store";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import { usePlayerStore } from "@/stores/player-store";

const cutoffFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

interface RequiredAppDataGateProps {
  initialUser: AuthUser | null;
  initialAccountGeneration?: string;
  initialGrantedScopes?: string[];
  children: React.ReactNode;
}

/** First migration gates normal use; verified returning visits restore in the background. */
export function RequiredAppDataGate({
  initialUser,
  initialAccountGeneration,
  initialGrantedScopes,
  children,
}: RequiredAppDataGateProps) {
  const consentRequired = useAuthStore((state) => state.appDataConsentRequired);
  const currentAccountId = useAuthStore((state) => state.user?.id);
  const ready = useAuthStore((state) => state.appDataReady);
  const [status, setStatus] = useState<"loading" | "consent" | "error">(
    "loading",
  );
  const [phase, setPhase] = useState<"checking" | "restoring">("checking");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [legacyUnavailable, setLegacyUnavailable] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryAttempts = useRef(0);
  const checking = useRef(false);
  const lastVerifiedAt = useRef(0);
  const [checkingLocalReadiness, setCheckingLocalReadiness] = useState(
    initialUser !== null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit user-requested retry.
  useEffect(() => {
    if (!initialUser) return;
    let disposed = false;
    checking.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const recheckLater = () => {
      if (!navigator.onLine || disposed) return;
      retryTimer = setTimeout(
        () => setAttempt((value) => value + 1),
        Math.min(2000 * 2 ** retryAttempts.current++, 30_000),
      );
    };
    const controller = new AbortController();
    const withinDeadline = async <T,>(
      operation: Promise<T>,
      milliseconds: number,
    ): Promise<T> => {
      const timeout = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          controller.abort();
          reject(
            new DOMException("Backup preparation timed out", "TimeoutError"),
          );
        }, milliseconds);
      });
      try {
        return await Promise.race([operation, timeout]);
      } finally {
        clearTimeout(deadlineTimer);
      }
    };
    const canResume =
      !!initialAccountGeneration &&
      hasVerifiedAppDataReadiness(
        initialUser.id,
        initialAccountGeneration,
        initialGrantedScopes,
      ) &&
      !useAuthStore.getState().appDataConsentRequired;
    if (!canResume) {
      useAuthStore.getState().setAppDataReady(false);
      setCheckingLocalReadiness(false);
    }
    setStatus("loading");
    setPhase("checking");
    setMessage(null);
    const blockPlayback = () => {
      const auth = useAuthStore.getState();
      const wasReady = auth.appDataReady;
      auth.setAppDataReady(false);
      // Audio survives a component unmount, including this gate closing.
      if (wasReady && auth.user?.id === initialUser.id)
        usePlayerStore.getState().pause();
    };
    const resumeVerified = async (reason: "offline" | "revalidating") => {
      if (
        !initialAccountGeneration ||
        !hasVerifiedAppDataReadiness(
          initialUser.id,
          initialAccountGeneration,
          initialGrantedScopes,
        ) ||
        useAuthStore.getState().appDataConsentRequired
      )
        return false;
      await deferDriveAppDataRestore(
        initialUser.id,
        initialAccountGeneration,
        reason,
      );
      if (!disposed) {
        useAuthStore.getState().hydrateServerSession(initialUser);
        useAuthStore.getState().setAppDataReady(true, true);
        setCheckingLocalReadiness(false);
      }
      return true;
    };
    let receivedResponse = false;
    void (async () => {
      try {
        const resumed = canResume
          ? await resumeVerified(navigator.onLine ? "revalidating" : "offline")
          : false;
        if (disposed) return;
        setCheckingLocalReadiness(false);
        if (!navigator.onLine && resumed) return;
        const { response, result } = await withinDeadline(
          (async () => {
            const response = await fetch("/api/appdata/bootstrap", {
              method: "POST",
              signal: controller.signal,
            });
            receivedResponse = true;
            const result = await response.json().catch(() => ({}));
            return { response, result };
          })(),
          45_000,
        );
        if (disposed) return;
        if (
          typeof result.cutoff === "string" &&
          Number.isFinite(Date.parse(result.cutoff))
        )
          setCutoff(result.cutoff);
        if (
          [
            "appdata_deletion_in_progress",
            "appdata_saved_file_missing",
            "appdata_cleanup_pending",
          ].includes(result.code)
        ) {
          clearVerifiedAppDataReadiness(initialUser.id);
          blockPlayback();
          setStatus("error");
          setMessage(
            result.code === "appdata_saved_file_missing"
              ? "The saved backup is missing from Google Drive. Open Storage & data to reset the backup and start again. Your music files are unchanged."
              : "Backup cleanup is incomplete. Open Storage & data for recovery. An interrupted save may require support to verify cleanup. Your music files are unchanged.",
          );
          return;
        }
        if (response.status === 401 || response.status === 403) {
          clearVerifiedAppDataReadiness(initialUser.id);
          blockPlayback();
          setStatus("consent");
          return;
        }
        if (!response.ok || result.ready !== true) {
          if (resumed) {
            if ([400, 413, 422].includes(response.status)) {
              useDriveAppDataStore.setState({
                status: "error",
                error: "backup_needs_attention",
              });
              toast.error("Your Google Drive backup needs attention.", {
                id: `backup-attention:${initialUser.id}`,
                description:
                  "Open Storage & data to recover it. You can keep listening.",
                duration: Number.POSITIVE_INFINITY,
                action: {
                  label: "Storage & data",
                  onClick: () => setStorageOpen(true),
                },
              });
            } else recheckLater();
            return;
          }
          blockPlayback();
          throw new Error(
            "Your Google Drive backup could not be prepared. Check your connection and retry.",
          );
        }
        retryAttempts.current = 0;
        lastVerifiedAt.current = Date.now();
        toast.dismiss(`backup-attention:${initialUser.id}`);
        const returning =
          resumed && result.generation === initialAccountGeneration;
        const replacing =
          !!initialAccountGeneration &&
          typeof result.generation === "string" &&
          result.generation !== initialAccountGeneration;
        if (replacing) {
          clearVerifiedAppDataReadiness(initialUser.id);
          blockPlayback();
        }
        if (
          result.generation === initialAccountGeneration &&
          typeof result.generation === "string" &&
          hasRequiredGoogleScopes(initialGrantedScopes) &&
          result.source === "drive" &&
          Number.isInteger(result.migrationVersion) &&
          result.migrationVersion >= 1
        ) {
          saveVerifiedAppDataReadiness(
            initialUser.id,
            result.generation,
            result.migrationVersion,
          );
        }
        setLegacyUnavailable(result.legacyUnavailable === true);
        // A restore error defers missing-tag extraction in the portable cache.
        // It must not stop playback after the account migration is complete.
        setPhase("restoring");
        const restoring = restoreDriveAppData(
          initialUser.id,
          typeof result.generation === "string" ? result.generation : undefined,
        );
        if (returning) useAuthStore.getState().setAppDataReady(true);
        await withinDeadline(restoring, 60_000).catch((error) => {
          if (replacing) throw error;
        });
        // The UI deadline releases playback after verified bootstrap. The
        // existing restore keeps running; its store still defers extraction.
        if (!disposed) useAuthStore.getState().setAppDataReady(true);
      } catch (error) {
        // A network-first shell can be served offline while navigator.onLine
        // still says true. Only a missing response may reuse earlier proof;
        // server rejection or migration failure must remain gated.
        if (
          !disposed &&
          !receivedResponse &&
          (await resumeVerified("offline").catch(() => false))
        ) {
          recheckLater();
          return;
        }
        if (!disposed) {
          setCheckingLocalReadiness(false);
          setStatus("error");
          setMessage(
            error instanceof DOMException && error.name === "TimeoutError"
              ? "Backup preparation took too long. Retry this step. Your existing data is preserved."
              : "Your Google Drive backup could not be prepared. Check your connection and retry. Your existing data is preserved.",
          );
        }
      }
    })().finally(() => {
      if (!disposed) checking.current = false;
    });
    return () => {
      disposed = true;
      checking.current = false;
      clearTimeout(retryTimer);
      clearTimeout(deadlineTimer);
      controller.abort();
    };
  }, [initialUser, initialAccountGeneration, initialGrantedScopes, attempt]);

  useEffect(() => {
    if (ready || status !== "loading" || !initialUser) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );

    return () => clearInterval(timer);
  }, [ready, status, initialUser]);

  useEffect(() => {
    const revalidate = () => {
      const auth = useAuthStore.getState();
      if (
        checking.current ||
        (auth.appDataReady &&
          !auth.appDataOfflineReady &&
          Date.now() - lastVerifiedAt.current < 60_000)
      )
        return;
      setAttempt((value) => value + 1);
    };
    window.addEventListener("online", revalidate);
    return () => window.removeEventListener("online", revalidate);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (
    initialUser &&
    ready &&
    !consentRequired &&
    currentAccountId === initialUser.id
  )
    return (
      <>
        {children}
        <StorageDialog
          open={storageOpen}
          onOpenChange={setStorageOpen}
          recoveryGeneration={initialAccountGeneration}
        />
        <Dialog open={legacyUnavailable} onOpenChange={setLegacyUnavailable}>
          <DialogContent className="w-[calc(100%_-_2rem)]">
            <DialogTitle>Start fresh with your collections</DialogTitle>
            <DialogDescription>
              The migration deadline has passed. Your old playlists and
              favorites were not moved before the global cutoff and are no
              longer available. Create them again here. Your music files are
              unchanged.
            </DialogDescription>
            <Button
              className="min-h-11"
              onClick={() => setLegacyUnavailable(false)}
            >
              Continue to Library
            </Button>
          </DialogContent>
        </Dialog>
      </>
    );

  // Server rendering cannot read the account-scoped browser proof. Use a
  // neutral shell until it is checked, rather than flashing migration copy.
  if (initialUser && checkingLocalReadiness && !consentRequired)
    return (
      <div className="h-dvh">
        <AppLoadingShell />
      </div>
    );

  const needsSignIn = !initialUser;
  const needsConsent =
    !needsSignIn && (status === "consent" || consentRequired);
  return (
    <main className="flex min-h-dvh items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground">
        <h1 className="text-xl font-semibold">
          {needsSignIn
            ? "Sign in to DriveBeats"
            : needsConsent
              ? "Connect Google Drive backup"
              : status === "loading"
                ? phase === "restoring"
                  ? "Restoring your Library"
                  : "Preparing your Library"
                : "Backup needs attention"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {needsSignIn
            ? "Sign in with Google to restore your Library and playlists. Your music files stay unchanged."
            : needsConsent
              ? "Approve the required app-folder access to continue. DriveBeats saves your playlists, favorites, imported choices and music tags in its hidden Google Drive folder. Your music files are never changed."
              : phase === "restoring"
                ? "Restoring your saved Library choices and music tags on this browser. A large Library may take a minute or more."
                : "DriveBeats moves existing playlists and favorites once, then restores your saved Library choices and music tags. A large Library may take a minute or more."}
        </p>
        {cutoff && phase === "checking" && (
          <p className="text-sm text-muted-foreground">
            Old playlists and favorites must be moved by{" "}
            {cutoffFormatter.format(new Date(cutoff))} (Europe/Berlin).
            Unmigrated collections are permanently removed then.
          </p>
        )}
        {message && (
          <p role="alert" className="text-sm">
            {message}
          </p>
        )}
        {needsSignIn ? (
          <Button
            className="min-h-11"
            onClick={() => window.location.assign("/api/auth/login")}
          >
            Sign in with Google
          </Button>
        ) : status === "loading" && !needsConsent ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {phase === "checking"
              ? "Checking Google Drive backup…"
              : "Restoring saved Library choices and music tags…"}
          </p>
        ) : needsConsent ? (
          <Button
            className="min-h-11"
            onClick={() =>
              window.location.assign("/api/auth/login?reconnect=1")
            }
          >
            Approve access with Google
          </Button>
        ) : (
          <Button className="min-h-11" onClick={retry}>
            Retry backup
          </Button>
        )}
        {!needsSignIn && status === "loading" && elapsedSeconds >= 10 && (
          <p aria-hidden="true" className="text-sm text-muted-foreground">
            Elapsed: {elapsedSeconds} seconds
          </p>
        )}
        {!needsSignIn && status === "loading" && elapsedSeconds >= 20 && (
          <p className="text-sm text-muted-foreground">
            Still working. Keep this page open while your backup is prepared.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setStorageOpen(true)}
          >
            Storage &amp; data
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setLogoutOpen(true)}
          >
            Sign out
          </Button>
          <Link
            className="inline-flex min-h-11 items-center px-3 text-sm underline"
            href="/privacy-policy"
          >
            Privacy policy
          </Link>
        </div>
        <StorageDialog
          open={storageOpen}
          onOpenChange={setStorageOpen}
          recoveryGeneration={initialAccountGeneration}
        />
        <LogoutConfirmationDialog
          open={logoutOpen}
          onOpenChange={setLogoutOpen}
          accountId={initialUser?.id}
          generation={initialAccountGeneration}
        />
      </div>
    </main>
  );
}
