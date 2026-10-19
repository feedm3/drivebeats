import type { WebMCP } from "webmcp-types";

// Zod validates untrusted inputs at execution time. Older hosts may omit the
// execution options, return synchronously, or expose unregisterTool.
export type WebMcpTool = Omit<
  WebMCP.ModelContextTool,
  "inputSchema" | "execute"
> & {
  inputSchema: Record<string, unknown>;
  execute: (
    input: unknown,
    options?: Partial<WebMCP.ToolExecuteCallbackOptions>,
  ) => Promise<Awaited<ReturnType<WebMCP.ToolExecuteCallback>>>;
};

export interface WebMcpContext {
  registerTool: (
    tool: WebMcpTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ) => WebMCP.MaybePromise<void>;
  // Earlier hosts remove registrations explicitly; the current draft uses
  // registration AbortSignals. Never clear tools belonging to another feature.
  unregisterTool?: (name: string) => WebMCP.MaybePromise<void>;
}

export function getWebMcpContext(): WebMcpContext | null {
  const candidates = [
    document.modelContext,
    (navigator as Navigator & { modelContext?: WebMcpContext }).modelContext,
  ];
  return (
    candidates.find((context) => typeof context?.registerTool === "function") ??
    null
  );
}

export function registerWebMcpTools(
  context: WebMcpContext,
  tools: WebMcpTool[],
) {
  const controllers = tools.map(() => new AbortController());
  let disposed = false;
  for (const [index, tool] of tools.entries()) {
    const controller = controllers[index];
    // Even an old host that ignores AbortSignals must not execute stale
    // closures after unmount or during StrictMode's mount/cleanup cycle.
    const registeredTool = {
      ...tool,
      execute: async (
        input: unknown,
        options?: Partial<WebMCP.ToolExecuteCallbackOptions>,
      ) =>
        disposed || controller.signal.aborted
          ? {
              ok: false,
              error: { code: "page_closed", message: "Open DriveBeats again." },
              recovery: webMcpRecovery("page_closed", true),
            }
          : tool.execute(input, {
              signal: options?.signal
                ? AbortSignal.any([controller.signal, options.signal])
                : controller.signal,
            }),
    };
    try {
      Promise.resolve(
        context.registerTool(registeredTool, { signal: controller.signal }),
      ).catch((error: unknown) => {
        if (!disposed)
          console.warn(`WebMCP could not register ${tool.name}`, error);
      });
    } catch (error) {
      console.warn(`WebMCP could not register ${tool.name}`, error);
    }
  }
  return () => {
    if (disposed) return;
    disposed = true;
    for (const [index, tool] of tools.entries()) {
      controllers[index].abort();
      try {
        Promise.resolve(context.unregisterTool?.(tool.name)).catch(
          () => undefined,
        );
      } catch {
        // A disappearing browser context must not break page cleanup.
      }
    }
  };
}

import { webMcpRecovery } from "@/lib/webmcp-recovery";
