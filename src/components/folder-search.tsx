"use client";

import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";

interface FolderSearchProps {
  value: string;
  onChange: (value: string) => void;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function FolderSearch({ value, onChange }: FolderSearchProps) {
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const hasQuery = value.trim().length > 0;
  const [isMobileOpen, setIsMobileOpen] = useState(hasQuery);

  const focusInput = useCallback((input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, []);

  const focusSearch = useCallback(() => {
    const isDesktopViewport = window.matchMedia("(min-width: 640px)").matches;

    if (isDesktopViewport) {
      focusInput(desktopInputRef.current);
      return;
    }

    setIsMobileOpen(true);
  }, [focusInput]);

  const clearSearch = useCallback(() => {
    onChange("");
    if (window.matchMedia("(min-width: 640px)").matches) {
      focusInput(desktopInputRef.current);
      return;
    }

    setIsMobileOpen(false);
  }, [focusInput, onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      focusSearch();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  useEffect(() => {
    if (hasQuery) {
      setIsMobileOpen(true);
    }
  }, [hasQuery]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    focusInput(mobileInputRef.current);
  }, [focusInput, isMobileOpen]);

  return (
    <>
      <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 shadow-xs backdrop-blur-sm sm:flex sm:max-w-xs">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <label htmlFor="folder-search-desktop" className="sr-only">
          Search this folder
        </label>
        <input
          id="folder-search-desktop"
          ref={desktopInputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }

            if (value) {
              event.preventDefault();
              clearSearch();
              return;
            }

            desktopInputRef.current?.blur();
          }}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
        />
        {hasQuery ? (
          <IconTooltip label="Clear search">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-muted-foreground hover:text-foreground"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>

      <div className="flex items-center sm:hidden">
        <IconTooltip label="Open search">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "rounded-full text-muted-foreground transition-all hover:text-foreground",
              isMobileOpen && "opacity-0 pointer-events-none w-0 px-0",
            )}
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open search"
          >
            <Search className="size-4" />
          </Button>
        </IconTooltip>
      </div>

      <div
        className={cn(
          "absolute inset-0 z-10 flex items-center bg-background sm:hidden transition-opacity duration-200 ease-out",
          isMobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <div className="flex w-full items-center gap-2 rounded-full border border-border/70 bg-background/82 px-3 py-1.5 shadow-xs backdrop-blur-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <label htmlFor="folder-search-mobile" className="sr-only">
            Search this folder
          </label>
          <input
            id="folder-search-mobile"
            ref={mobileInputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }

              event.preventDefault();
              if (value) {
                clearSearch();
                return;
              }

              setIsMobileOpen(false);
            }}
            onBlur={() => {
              if (!value) {
                setIsMobileOpen(false);
              }
            }}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
          />
          <IconTooltip label={hasQuery ? "Clear search" : "Close search"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (value) {
                  clearSearch();
                  return;
                }

                setIsMobileOpen(false);
              }}
              aria-label={hasQuery ? "Clear search" : "Close search"}
            >
              <X className="size-4" />
            </Button>
          </IconTooltip>
        </div>
      </div>
    </>
  );
}
