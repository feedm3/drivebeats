import { track } from "@vercel/analytics";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerWebMcpTools,
  type WebMcpContext,
  type WebMcpTool,
} from "@/lib/webmcp-registration";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

function tool(execute = vi.fn(async () => ({ ok: true }))): WebMcpTool {
  return {
    name: "drivebeats_test",
    description: "Test",
    inputSchema: { type: "object" },
    execute,
  };
}
describe("native WebMCP registration", () => {
  beforeEach(() => {
    vi.mocked(track).mockReset();
  });

  it("releases exactly its own tools through abort for StrictMode remounts", async () => {
    const registered = new Map<string, WebMcpTool>();
    const unrelated = tool();
    unrelated.name = "unrelated";
    registered.set(unrelated.name, unrelated);
    const context: WebMcpContext = {
      registerTool: vi.fn((descriptor, options) => {
        if (registered.has(descriptor.name)) throw new Error("Duplicate");
        registered.set(descriptor.name, descriptor);
        options?.signal?.addEventListener(
          "abort",
          () => registered.delete(descriptor.name),
          { once: true },
        );
      }),
    };
    const execute = vi.fn(async () => ({ ok: true }));
    const cleanup = registerWebMcpTools(context, [tool(execute)]);
    const stale = registered.get("drivebeats_test");
    cleanup();
    cleanup();
    expect(registered.has("unrelated")).toBe(true);
    expect(registered.has("drivebeats_test")).toBe(false);
    expect(await stale?.execute({})).toMatchObject({
      ok: false,
      error: { code: "page_closed" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    const cleanupAgain = registerWebMcpTools(context, [tool(execute)]);
    expect(await registered.get("drivebeats_test")?.execute({})).toEqual({
      ok: true,
    });
    cleanupAgain();
  });

  it("keeps tool inputs and results out of analytics and tolerates analytics failure", async () => {
    let registered: WebMcpTool | undefined;
    const input = { query: "Private library search" };
    const result = { ok: false, error: { code: "sign_in_required" } };
    const execute = vi.fn(async () => result);
    const cleanup = registerWebMcpTools(
      {
        registerTool: (descriptor) => {
          registered = descriptor;
        },
      },
      [tool(execute)],
    );
    expect(track).not.toHaveBeenCalled();
    expect(await registered?.execute(input)).toEqual(result);
    expect(track).toHaveBeenCalledExactlyOnceWith("webmcp_tool_used", {
      tool: "drivebeats_test",
    });
    vi.mocked(track).mockImplementationOnce(() => {
      throw new Error("Analytics unavailable");
    });
    expect(await registered?.execute(input)).toEqual(result);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(input, {
      signal: expect.any(AbortSignal),
    });
    cleanup();
  });

  it("forwards host cancellation and aborts in-flight executions on page cleanup", async () => {
    let registered: WebMcpTool | undefined;
    const context: WebMcpContext = {
      registerTool: (descriptor) => {
        registered = descriptor;
      },
    };
    let executionSignal: AbortSignal | undefined;
    const descriptor: WebMcpTool = {
      ...tool(),
      execute: async (_input, options) => {
        executionSignal = options?.signal;
        return {};
      },
    };
    const cleanup = registerWebMcpTools(context, [descriptor]);
    const host = new AbortController();
    await registered?.execute({}, { signal: host.signal });
    host.abort();
    expect(executionSignal?.aborted).toBe(true);
    await registered?.execute({});
    expect(executionSignal?.aborted).toBe(false);
    cleanup();
    expect(executionSignal?.aborted).toBe(true);
  });

  it("handles rejected registration promises without an unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cleanup = registerWebMcpTools(
      {
        registerTool: async () => {
          throw new Error("Unavailable");
        },
      },
      [tool()],
    );
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    cleanup();
    warn.mockRestore();
  });
});
