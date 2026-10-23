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

const restore = vi.hoisted(() => vi.fn());
const deferRestore = vi.hoisted(() => vi.fn());
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
  expect(deferRestore).toHaveBeenCalledWith(user.id, "generation-a");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(user.id);
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
  expect(deferRestore).toHaveBeenCalledWith(user.id, "generation-a");
  expect(refresh).not.toHaveBeenCalled();
});
it("invalidates offline readiness on an authoritative consent rejection", async () => {
  saveVerifiedAppDataReadiness(user.id, "generation-a", 1);
  fetchMock.mockResolvedValue(
    Response.json({ code: "appdata_consent_required" }, { status: 403 }),
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
  await screen.findByRole("button", { name: "Approve access with Google" });
  expect(screen.queryByText("Downloaded player")).not.toBeInTheDocument();
  expect(
    hasVerifiedAppDataReadiness(user.id, "generation-a", requiredScopes),
  ).toBe(false);
  expect(deferRestore).not.toHaveBeenCalled();
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
