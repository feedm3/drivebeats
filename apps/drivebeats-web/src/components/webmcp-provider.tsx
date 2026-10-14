"use client";

import { useEffect } from "react";
import {
  getWebMcpContext,
  registerWebMcpTools,
} from "@/lib/webmcp-registration";

export function WebMcpProvider() {
  useEffect(() => {
    const context = getWebMcpContext();
    if (!context) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("@/lib/webmcp-tools")
      .then(({ createDriveBeatsTools }) => {
        if (disposed) return;
        cleanup = registerWebMcpTools(context, createDriveBeatsTools());
      })
      .catch(() => {
        if (!disposed) console.warn("DriveBeats WebMCP tools could not load.");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return null;
}
