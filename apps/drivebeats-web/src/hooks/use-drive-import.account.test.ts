import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDriveImport } from "./use-drive-import";

const fixture = vi.hoisted(() => ({
  account: "first",
  callback: null as
    | ((data: { action: string; docs: { id: string }[] }) => Promise<void>)
    | null,
  visible: vi.fn(),
  imported: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(
    (
      select: (state: {
        getValidAccessToken: () => Promise<string>;
      }) => unknown,
    ) => select({ getValidAccessToken: async () => "synthetic-token" }),
    {
      getState: () => ({ user: { id: fixture.account }, isLoggingOut: false }),
    },
  ),
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: (
    select: (state: { upsertItems: typeof fixture.imported }) => unknown,
  ) => select({ upsertItems: fixture.imported }),
}));
vi.mock("@/lib/google-picker", () => ({
  ensureGooglePickerLoaded: async () => {},
  getGooglePickerConfig: () => ({ apiKey: "synthetic-key" }),
  setActiveGooglePickerSession: vi.fn(),
}));
vi.mock("@/lib/google-api", () => ({
  getGoogleDriveFileMetadata: async () => ({
    ok: true,
    json: async () => {
      // The lookups completed, but their account is no longer active.
      fixture.account = "second";
      return { id: "selected", name: "selected.mp3", mimeType: "audio/mpeg" };
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

class View {
  setIncludeFolders() {
    return this;
  }
  setSelectFolderEnabled() {
    return this;
  }
  setMimeTypes() {
    return this;
  }
  setMode() {
    return this;
  }
  setParent() {
    return this;
  }
  setLabel() {
    return this;
  }
}
class Builder {
  addView() {
    return this;
  }
  setDeveloperKey() {
    return this;
  }
  setOAuthToken() {
    return this;
  }
  setOrigin() {
    return this;
  }
  enableFeature() {
    return this;
  }
  setCallback(callback: NonNullable<typeof fixture.callback>) {
    fixture.callback = callback;
    return this;
  }
  build() {
    return { setVisible: fixture.visible };
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Drive Picker account boundary", () => {
  it("settles an obsolete selection without importing into the next account", async () => {
    vi.stubGlobal("google", {
      picker: {
        DocsView: View,
        PickerBuilder: Builder,
        ViewId: { DOCS: "docs" },
        DocsViewMode: { LIST: "list" },
        Feature: { MULTISELECT_ENABLED: "multiple" },
        Action: { PICKED: "picked", CANCEL: "cancel", ERROR: "error" },
      },
    });
    const { result } = renderHook(() => useDriveImport());
    let operation: Promise<void> | undefined;
    act(() => {
      operation = result.current.importFromDrive();
    });
    await waitFor(() => expect(fixture.callback).not.toBeNull());
    await act(async () => {
      await fixture.callback?.({
        action: "picked",
        docs: [{ id: "selected" }],
      });
    });
    await waitFor(() => expect(result.current.isImporting).toBe(false));
    await operation;
    expect(fixture.imported).not.toHaveBeenCalled();
    expect(fixture.visible).toHaveBeenLastCalledWith(false);
  });
});
