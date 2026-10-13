export const CONNECT_TOOL = "drivebeats_connect_account";
export const PROFILE_TOOL = "drivebeats_get_profile";
export const CLOUD_LIBRARY_TOOL = "drivebeats_get_cloud_library";
export const DISCONNECT_TOOL = "drivebeats_disconnect";

export interface AccountProfile {
  id: string;
  email: string | null;
  name: string | null;
}

export interface CloudLibrarySummary {
  playlists: { id: string; name: string; trackCount: number }[];
  favoriteCount: number;
}

export interface AccountState {
  status: "signed_out" | "connected" | "sign_in_required" | "scope_required";
  available: boolean;
  loading: boolean;
  profile: AccountProfile | null;
  library: CloudLibrarySummary | null;
  error: string | null;
  notice: string | null;
}

export interface PreparedMedia {
  fileId: string;
  fileName: string;
  mimeType: string;
  expiresAt: string;
  mediaUrl: string;
}

export interface AccountBridge {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AccountState;
  connect(): Promise<boolean>;
  reconnect(): Promise<boolean>;
  refresh(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  prepareMedia(fileId: string): Promise<PreparedMedia | null>;
}

interface ToolCaller {
  callServerTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function profileFrom(value: unknown): AccountProfile | null {
  const profile = record(value);
  if (!profile || typeof profile.id !== "string" || !profile.id) return null;
  if (
    (profile.email != null && typeof profile.email !== "string") ||
    (profile.name != null && typeof profile.name !== "string")
  )
    return null;
  return {
    id: profile.id,
    email: typeof profile.email === "string" ? profile.email : null,
    name: typeof profile.name === "string" ? profile.name : null,
  };
}

function libraryFrom(
  value: Record<string, unknown>,
): CloudLibrarySummary | null {
  if (!Array.isArray(value.playlists) || !Array.isArray(value.favorites))
    return null;
  const playlists: CloudLibrarySummary["playlists"] = [];
  for (const item of value.playlists) {
    const playlist = record(item);
    if (
      !playlist ||
      typeof playlist.id !== "string" ||
      typeof playlist.name !== "string" ||
      !Array.isArray(playlist.tracks)
    )
      return null;
    playlists.push({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.tracks.length,
    });
  }
  return { playlists, favoriteCount: value.favorites.length };
}

// The host owns all OAuth credentials. This store retains display data only.
export function createAccountBridge(
  caller: ToolCaller | null,
  mediaOrigin: string | null = null,
): AccountBridge & {
  setAvailable(available: boolean): void;
  receive(result: unknown): boolean;
  dispose(): void;
} {
  let state: AccountState = {
    status: "signed_out",
    available: false,
    loading: false,
    profile: null,
    library: null,
    error: null,
    notice: null,
  };
  let disposed = false;
  let revision = 0;
  let acceptAccountResults = true;
  let phase: "idle" | "disconnecting" | "connecting" = "idle";
  const listeners = new Set<() => void>();
  function update(changes: Partial<AccountState>) {
    if (disposed) return;
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }
  function receive(result: unknown, directResult = false): boolean {
    if (disposed) return false;
    const envelope = record(result);
    const content = record(envelope?.structuredContent);
    if (
      !content ||
      (typeof content.id !== "string" &&
        ![
          "connected",
          "disconnected",
          "sign_in_required",
          "scope_required",
          "error",
        ].includes(String(content.status)))
    )
      return false;
    if (content.status === "disconnected" && !envelope?.isError) {
      // A delayed host broadcast from an earlier revocation cannot clear a fresh grant.
      if (!directResult && phase !== "disconnecting") return true;
      revision += 1;
      acceptAccountResults = false;
      update({
        status: "signed_out",
        profile: null,
        library: null,
        error: null,
        notice: "Disconnected. Your saved Playlists and favorites are kept.",
      });
      return true;
    }
    if (
      content.status === "sign_in_required" ||
      content.status === "scope_required"
    ) {
      revision += 1;
      acceptAccountResults = false;
      update({
        status: content.status,
        profile: null,
        library: null,
        notice: null,
        error:
          content.status === "scope_required"
            ? "Reconnect DriveBeats to allow access to your saved music."
            : "Finish connecting in ChatGPT, then try again. If you canceled, you can connect when ready.",
      });
      return true;
    }
    if (content.status === "error" || envelope?.isError) {
      update({ error: "Your account data could not be loaded. Try again." });
      return true;
    }
    if ("id" in content) {
      // During account operations, only their resolved tool call may establish identity.
      if (!directResult && (!acceptAccountResults || phase !== "idle"))
        return true;
      const profile = profileFrom(content);
      if (!profile) return false;
      acceptAccountResults = true;
      const changed = state.profile?.id !== profile.id;
      if (changed) revision += 1;
      update({
        status: "connected",
        profile,
        library: changed ? null : state.library,
        error: null,
        notice: null,
      });
      return true;
    }
    if (content.status !== "connected") return false;
    const library = libraryFrom(content);
    if (!library || !state.profile) return false;
    if (record(envelope?._meta)?.accountId !== state.profile.id) return false;
    update({ library, error: null, notice: "Saved music refreshed" });
    return true;
  }
  async function call(name: string): Promise<boolean> {
    if (!caller || disposed) return false;
    const requestRevision = revision;
    const result = await caller.callServerTool({ name, arguments: {} });
    if (disposed) return false;
    if (name === CONNECT_TOOL && phase === "connecting") {
      // The host may broadcast an auth challenge before its OAuth flow resolves.
      // The result of this serialized connect call is authoritative for the new grant.
      if (!receive(result, true)) {
        update({
          error: "DriveBeats returned unexpected account data. Try again.",
        });
        return false;
      }
      return (
        state.status === "connected" && state.profile !== null && !state.error
      );
    }
    if (requestRevision !== revision) {
      // Some hosts broadcast the same response before resolving the UI call.
      const envelope = record(result);
      const content = record(envelope?.structuredContent);
      return (
        !envelope?.isError &&
        (name === PROFILE_TOOL || name === CONNECT_TOOL
          ? state.profile !== null && content?.id === state.profile.id
          : name === DISCONNECT_TOOL &&
            state.status === "signed_out" &&
            content?.status === "disconnected")
      );
    }
    if (receive(result, true)) {
      return name === DISCONNECT_TOOL
        ? state.status === "signed_out"
        : state.status === "connected" && !state.error;
    }
    update({
      error: "DriveBeats returned unexpected account data. Try again.",
    });
    return false;
  }
  async function run(operation: () => Promise<boolean>) {
    if (!state.available || state.loading || disposed) return false;
    update({ loading: true, error: null, notice: null });
    try {
      return await operation();
    } catch {
      update({
        error:
          "The connection could not be completed. Try again in ChatGPT or reopen DriveBeats.",
      });
      return false;
    } finally {
      update({ loading: false });
    }
  }
  async function connectAccount() {
    phase = "connecting";
    acceptAccountResults = true;
    try {
      if (!(await call(CONNECT_TOOL))) return false;
      return await call(CLOUD_LIBRARY_TOOL);
    } finally {
      phase = "idle";
      if (!state.profile) acceptAccountResults = false;
    }
  }
  async function disconnectAccount() {
    phase = "disconnecting";
    try {
      return await call(DISCONNECT_TOOL);
    } finally {
      phase = "idle";
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    setAvailable(available) {
      update({ available });
    },
    receive,
    connect: () => run(connectAccount),
    reconnect: () =>
      run(async () => {
        // A canceled prior reconnect has already revoked its grant. Asking to
        // disconnect again would start OAuth merely to revoke the new grant.
        if (
          state.status === "connected" &&
          state.profile &&
          !(await disconnectAccount())
        )
          return false;
        return connectAccount();
      }),
    refresh: () => run(() => call(CLOUD_LIBRARY_TOOL)),
    disconnect: () => run(disconnectAccount),
    async prepareMedia(fileId) {
      let prepared: PreparedMedia | null = null;
      await run(async () => {
        if (
          !caller ||
          !state.profile ||
          !mediaOrigin ||
          !fileId ||
          fileId.length > 256
        )
          return false;
        const requestRevision = revision;
        const envelope = record(
          await caller.callServerTool({
            name: "drivebeats_prepare_media",
            arguments: { fileId },
          }),
        );
        if (disposed || revision !== requestRevision) return false;
        const content = record(envelope?.structuredContent);
        const metadata = record(envelope?._meta);
        if (content?.status !== "ready" || envelope?.isError) {
          receive(envelope);
          update({
            error:
              state.error ??
              "This track could not be prepared. Reconnect or select another track.",
          });
          return false;
        }
        if (
          content.fileId !== fileId ||
          typeof content.fileName !== "string" ||
          typeof content.mimeType !== "string" ||
          !content.mimeType.startsWith("audio/") ||
          typeof content.expiresAt !== "string" ||
          Date.parse(content.expiresAt) <= Date.now() ||
          !Number.isFinite(Date.parse(content.expiresAt)) ||
          typeof metadata?.mediaUrl !== "string"
        ) {
          update({
            error:
              "DriveBeats returned unexpected media access. Select another track.",
          });
          return false;
        }
        const url = new URL(metadata.mediaUrl);
        if (
          url.origin !== mediaOrigin ||
          !/^\/api\/mcp\/media\/[A-Za-z0-9_-]{43}$/.test(url.pathname) ||
          url.search ||
          url.hash ||
          url.username ||
          url.password
        ) {
          update({
            error:
              "DriveBeats returned unexpected media access. Select another track.",
          });
          return false;
        }
        // The scoped capability stays in this app caller's memory, never account state or model-readable output.
        prepared = {
          fileId,
          fileName: content.fileName,
          mimeType: content.mimeType,
          expiresAt: content.expiresAt,
          mediaUrl: url.href,
        };
        return true;
      });
      return prepared;
    },
    dispose() {
      disposed = true;
      revision += 1;
      listeners.clear();
      state = { ...state, profile: null, library: null, loading: false };
    },
  };
}
