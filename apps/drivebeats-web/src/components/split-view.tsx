"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const KEYBOARD_STEP = 10;

function clampWidth(w: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

interface SplitViewProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function SplitView({ sidebar, children }: SplitViewProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
    return DEFAULT_WIDTH;
  });

  const widthRef = useRef(sidebarWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Keep ref in sync with state
  useEffect(() => {
    widthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Register global mouse listeners once
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = clampWidth(startWidth.current + delta);
      widthRef.current = newWidth;
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -KEYBOARD_STEP;
    else if (e.key === "ArrowRight") delta = KEYBOARD_STEP;
    else return;

    e.preventDefault();
    const newWidth = clampWidth(widthRef.current + delta);
    widthRef.current = newWidth;
    setSidebarWidth(newWidth);
    localStorage.setItem(STORAGE_KEY, String(newWidth));
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <div
        className="hidden shrink-0 overflow-y-auto overscroll-contain md:block"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </div>
      <hr
        className="hidden h-auto w-px shrink-0 cursor-col-resize border-none bg-border transition-colors hover:w-0.5 hover:bg-primary/40 md:block"
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
