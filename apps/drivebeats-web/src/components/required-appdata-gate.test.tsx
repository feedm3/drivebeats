import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthBootstrap } from "@/components/auth-bootstrap";
import { RequiredAppDataGate } from "@/components/required-appdata-gate";
import {
  hasVerifiedAppDataReadiness,
  saveVerifiedAppDataReadiness,
} from "@/lib/appdata-readiness";
import { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_SCOPE } from "@/lib/google-scopes";
import { useAuthStore } from "@/stores/auth-store";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import { usePlayerStore } from "@/stores/player-store";

const restore = vi.hoisted(() => vi.fn());
const deferRestore = vi.hoisted(() => vi.fn());
const backupToast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: backupToast }));
const requiredScopes = [GOOGLE_DRIVE_SCOPE, GOOGLE_APPDATA_SCOPE];
vi.mock("@/lib/drive-appdata-client", () => ({
  restoreDriveAppData: restore,
  deferDriveAppDataRestore: deferRestore,
}));
const storage = vi.hoisted(() =>
  vi.fn((_props: { open: boolean; recoveryGeneration?: string }) => null),
);
vi.mock("@/components/storage-dialog", () => ({ StorageDialog: storage }));
vi.mock("@/lib/clear-local-data", () => ({ logoutAndRedirect: vi.fn() }));
const user = {
  id: "account-a",
  email: "a@example.test",
  name: null,
  picture: null,
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  useAuthStore.setState({
    user,
    appDataReady: false,
    appDataOfflineReady: false,
    appDataConsentRequired: false,
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  restore.mockReset().mockResolvedValue(undefined);
  deferRestore.mockReset().mockResolvedValue(undefined);
  backupToast.error.mockClear();
  backupToast.dismiss.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not mount player and tool consumers until migration and restore finish", async () => {
  let finishMigration!: (response: Response) => void;
  let finishRestore!: () => void;
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      finishMigration = resolve;
    }),
  );
  restore.mockReturnValue(
    new Promise<void>((resolve) => {
      finishRestore = resolve;
    }),
  );
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  expect(screen.queryByText("Player and tools")).not.toBeInTheDocument();
  await act(async () => finishMigration(Response.json({ ready: true })));
  expect(restore).toHaveBeenCalledWith(user.id, undefined);
  expect(screen.queryByText("Player and tools")).not.toBeInTheDocument();
  await act(async () => finishRestore());
  expect(await screen.findByText("Player and tools")).toBeInTheDocument();
});

it("keeps partial consent gated with explicit grant, privacy and account recovery actions", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ code: "appdata_consent_required" }, { status: 403 }),
  );
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  expect(
    await screen.findByRole("button", { name: "Approve access with Google" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Privacy policy" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Storage & data" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Player and tools")).not.toBeInTheDocument();
  expect(restore).not.toHaveBeenCalled();
});

it("requires a user retry after migration failure and allows playback on deferred tag restore", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ready: true }));
  restore.mockRejectedValue(new Error("offline"));
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry backup" }));
  expect(await screen.findByText("Player and tools")).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

it("records readiness only after verified migrated bootstrap and reuses it offline without refresh", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      ready: true,
      generation: "generation-a",
      source: "drive",
      migrationVersion: 1,
    }),
  );
  const first = render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Downloaded player</p>
    </RequiredAppDataGate>,
  );
  await screen.findByText("Downloaded player");
  expect(
    hasVerifiedAppDataReadiness(user.id, "generation-a", requiredScopes),
  ).toBe(true);
  first.unmount();
  useAuthStore.setState({
    user: null,
    authStatus: "unknown",
    appDataReady: false,
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fetchMock.mockClear();
  const refresh = vi.spyOn(useAuthStore.getState(), "refreshAccessToken");
  render(
    <>
      <AuthBootstrap initialUser={user} />
      <RequiredAppDataGate
        initialUser={user}
        initialAccountGeneration="generation-a"
        initialGrantedScopes={requiredScopes}
      >
        <p>Downloaded player</p>
      </RequiredAppDataGate>
    </>,
  );
  expect(await screen.findByText("Downloaded player")).toBeInTheDocument();
  expect(deferRestore).toHaveBeenCalledWith(user.id, "generation-a", "offline");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(user.id);
});

it("keeps a verified returning Library visible while bootstrap and tag restore are pending", async () => {
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  let finishBootstrap!: (response: Response) => void;
  let finishRestore!: () => void;
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      finishBootstrap = resolve;
    }),
  );
  restore.mockReturnValue(
    new Promise<void>((resolve) => {
      finishRestore = resolve;
    }),
  );
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Returning Library</p>
    </RequiredAppDataGate>,
  );
  await act(async () => {});
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  expect(useAuthStore.getState().appDataOfflineReady).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("heading", { name: "Preparing your Library" }),
  ).not.toBeInTheDocument();
  await act(async () =>
    finishBootstrap(
      Response.json({
        ready: true,
        generation: "generation-a",
        source: "drive",
        migrationVersion: 1,
      }),
    ),
  );
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  expect(useAuthStore.getState().appDataOfflineReady).toBe(false);
  fireEvent.online(window);
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  await act(async () => finishRestore());
});

it.each(["absent", "other-account", "other-generation", "missing-consent"])(
  "waits for online verification with %s readiness",
  async (scenario) => {
    if (scenario !== "absent")
      saveVerifiedAppDataReadiness(
        scenario === "other-account" ? "account-b" : user.id,
        scenario === "other-generation" ? "old-generation" : "generation-a",
        1,
      );
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(
      <RequiredAppDataGate
        initialUser={user}
        initialAccountGeneration="generation-a"
        initialGrantedScopes={
          scenario === "missing-consent" ? [GOOGLE_DRIVE_SCOPE] : requiredScopes
        }
      >
        <p>Returning Library</p>
      </RequiredAppDataGate>,
    );
    await act(async () => {});
    expect(screen.queryByText("Returning Library")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deferRestore).not.toHaveBeenCalled();
  },
);

it("closes the cached Library if the server reports a replacement account generation", async () => {
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockResolvedValue(
    Response.json({ ready: true, generation: "replacement-generation" }),
  );
  let finishRestore!: () => void;
  restore.mockReturnValue(
    new Promise<void>((resolve) => {
      finishRestore = resolve;
    }),
  );
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Returning Library</p>
    </RequiredAppDataGate>,
  );
  await screen.findByRole("heading", { name: "Restoring your Library" });
  expect(screen.queryByText("Returning Library")).not.toBeInTheDocument();
  expect(
    hasVerifiedAppDataReadiness(user.id, "generation-a", requiredScopes),
  ).toBe(false);
  await act(async () => finishRestore());
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
});

it.each(["absent", "other-account", "other-generation", "missing-consent"])(
  "does not unlock offline playback with %s readiness",
  async (scenario) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    if (scenario !== "absent")
      saveVerifiedAppDataReadiness(
        scenario === "other-account" ? "account-b" : user.id,
        scenario === "other-generation" ? "generation-old" : "generation-a",
        1,
      );
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render(
      <RequiredAppDataGate
        initialUser={user}
        initialAccountGeneration="generation-a"
        initialGrantedScopes={
          scenario === "missing-consent" ? [GOOGLE_DRIVE_SCOPE] : requiredScopes
        }
      >
        <p>Downloaded player</p>
      </RequiredAppDataGate>,
    );
    await screen.findByRole("button", { name: "Retry backup" });
    expect(screen.queryByText("Downloaded player")).not.toBeInTheDocument();
    expect(deferRestore).not.toHaveBeenCalled();
  },
);

it("does not persist failed migration as offline permission", async () => {
  fetchMock.mockResolvedValue(Response.json({ ready: false }, { status: 503 }));
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Downloaded player</p>
    </RequiredAppDataGate>,
  );
  await screen.findByRole("button", { name: "Retry backup" });
  expect(
    hasVerifiedAppDataReadiness(user.id, "generation-a", requiredScopes),
  ).toBe(false);
});

it("uses verified local playback when the network fails despite an online browser hint", async () => {
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockRejectedValue(new TypeError("network unavailable"));
  const refresh = vi.spyOn(useAuthStore.getState(), "refreshAccessToken");
  render(
    <>
      <AuthBootstrap initialUser={user} />
      <RequiredAppDataGate
        initialUser={user}
        initialAccountGeneration="generation-a"
        initialGrantedScopes={requiredScopes}
      >
        <p>Downloaded player</p>
      </RequiredAppDataGate>
    </>,
  );
  expect(await screen.findByText("Downloaded player")).toBeInTheDocument();
  expect(deferRestore).toHaveBeenCalledWith(user.id, "generation-a", "offline");
  expect(refresh).not.toHaveBeenCalled();
});
it("invalidates offline readiness on an authoritative consent rejection", async () => {
  const pause = vi
    .spyOn(usePlayerStore.getState(), "pause")
    .mockImplementation(() => {});
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  let rejectAccess!: (response: Response) => void;
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      rejectAccess = resolve;
    }),
  );
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Downloaded player</p>
    </RequiredAppDataGate>,
  );
  expect(await screen.findByText("Downloaded player")).toBeInTheDocument();
  await act(async () =>
    rejectAccess(
      Response.json({ code: "appdata_consent_required" }, { status: 403 }),
    ),
  );
  await screen.findByRole("button", { name: "Approve access with Google" });
  expect(screen.queryByText("Downloaded player")).not.toBeInTheDocument();
  expect(
    hasVerifiedAppDataReadiness(user.id, "generation-a", requiredScopes),
  ).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalledOnce();
});

it("keeps returning playback available through a temporary bootstrap failure and retries", async () => {
  vi.useFakeTimers();
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  const pause = vi
    .spyOn(usePlayerStore.getState(), "pause")
    .mockImplementation(() => {});
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ code: "appdata_provider_unavailable" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({ ready: true, generation: "generation-a" }),
    );
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Returning Library</p>
    </RequiredAppDataGate>,
  );
  await act(async () => {});
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  expect(pause).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(restore).toHaveBeenCalledOnce();
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
});

it("reports a permanently invalid backup without pausing cached playback or silently retrying", async () => {
  vi.useFakeTimers();
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockResolvedValue(
    Response.json({ code: "appdata_invalid_saved_file" }, { status: 400 }),
  );
  const pause = vi
    .spyOn(usePlayerStore.getState(), "pause")
    .mockImplementation(() => {});
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Returning Library</p>
    </RequiredAppDataGate>,
  );
  await act(async () => {});
  expect(screen.getByText("Returning Library")).toBeInTheDocument();
  expect(backupToast.error).toHaveBeenCalledOnce();
  const options = backupToast.error.mock.calls[0][1];
  expect(options.action.label).toBe("Storage & data");
  await act(async () => options.action.onClick());
  expect(storage.mock.calls.at(-1)?.[0]).toMatchObject({
    open: true,
    recoveryGeneration: "generation-a",
  });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(pause).not.toHaveBeenCalled();
});

it("keeps a replacement-generation Library gated if its restore fails", async () => {
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockResolvedValue(
    Response.json({ ready: true, generation: "generation-b" }),
  );
  restore.mockRejectedValue(new Error("network unavailable"));
  render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Old Library</p>
    </RequiredAppDataGate>,
  );
  expect(
    await screen.findByRole("heading", { name: "Backup needs attention" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Old Library")).not.toBeInTheDocument();
});

it("offers sign-in in a clean cached shell without mounting the player or bootstrapping", () => {
  useAuthStore.setState({
    user: null,
    authStatus: "unknown",
    appDataReady: false,
  });
  render(
    <RequiredAppDataGate initialUser={null}>
      <p>Downloaded player</p>
    </RequiredAppDataGate>,
  );
  expect(
    screen.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
  expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
    "href",
    "/privacy-policy",
  );
  expect(screen.queryByText("Preparing backup…")).not.toBeInTheDocument();
  expect(screen.queryByText("Downloaded player")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows preparation phases and elapsed time when bootstrap uses most of its deadline", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(Response.json({ ready: true })), 40_000),
      ),
  );
  restore.mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, 10_000)),
  );
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking Google Drive backup…",
  );
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByText("Elapsed: 10 seconds")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Restoring saved Library choices and music tags…",
  );
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByText("Player and tools")).toBeInTheDocument();
});
it("opens playback after the restore UI deadline while the existing restore continues", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(Response.json({ ready: true }));
  restore.mockImplementation(() => {
    useDriveAppDataStore.setState({ accountId: user.id, status: "restoring" });
    return new Promise(() => {});
  });
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  await act(() => vi.advanceTimersByTimeAsync(60_001));
  expect(screen.getByText("Player and tools")).toBeInTheDocument();
  expect(useDriveAppDataStore.getState().status).toBe("restoring");
  expect(restore).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each([
  "appdata_deletion_in_progress",
  "appdata_saved_file_missing",
  "appdata_cleanup_pending",
])(
  "offers account recovery rather than a consent loop for %s",
  async (code) => {
    saveVerifiedAppDataReadiness(user.id, "signed-generation", 1);
    fetchMock.mockResolvedValue(
      Response.json(
        { code },
        { status: code === "appdata_deletion_in_progress" ? 403 : 503 },
      ),
    );
    render(
      <RequiredAppDataGate
        initialUser={user}
        initialAccountGeneration="signed-generation"
        initialGrantedScopes={requiredScopes}
      >
        <p>Player and tools</p>
      </RequiredAppDataGate>,
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Approve access with Google" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Storage & data" }));
    expect(storage.mock.calls.at(-1)?.[0]).toMatchObject({
      open: true,
      recoveryGeneration: "signed-generation",
    });
    expect(screen.queryByText("Player and tools")).not.toBeInTheDocument();
    expect(
      hasVerifiedAppDataReadiness(user.id, "signed-generation", requiredScopes),
    ).toBe(false);
  },
);

it("ends the checking phase with a retry even if a suspended request ignores abort", async () => {
  vi.useFakeTimers();
  fetchMock.mockReturnValue(new Promise(() => {}));
  render(
    <RequiredAppDataGate initialUser={user}>
      <p>Player and tools</p>
    </RequiredAppDataGate>,
  );
  await act(() => vi.advanceTimersByTimeAsync(45_001));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Backup preparation took too long",
  );
  expect(screen.getByRole("button", { name: "Retry backup" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("clears the deadline and elapsed timers when a suspended bootstrap unmounts", () => {
  vi.useFakeTimers();
  fetchMock.mockReturnValue(new Promise(() => {}));
  const view = render(
    <RequiredAppDataGate initialUser={user}>
      <p>Library</p>
    </RequiredAppDataGate>,
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not retry a transient bootstrap failure after the returning Library unmounts", async () => {
  vi.useFakeTimers();
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockResolvedValue(
    Response.json({ code: "appdata_provider_unavailable" }, { status: 503 }),
  );
  const view = render(
    <RequiredAppDataGate
      initialUser={user}
      initialAccountGeneration="generation-a"
      initialGrantedScopes={requiredScopes}
    >
      <p>Library</p>
    </RequiredAppDataGate>,
  );
  await act(async () => {});
  expect(screen.getByText("Library")).toBeInTheDocument();
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
