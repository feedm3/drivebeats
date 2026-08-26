"use client";

import { ChevronDown, Info, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type FileSearchScope = "library" | "folder";

interface FolderSearchProps {
  canSearchCurrentFolder: boolean;
  disabled: boolean;
  disabledReason?: string;
  onChange: (value: string) => void;
  onScopeChange: (scope: FileSearchScope) => void;
  scope: FileSearchScope;
  value: string;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function FolderSearch({
  canSearchCurrentFolder,
  disabled,
  disabledReason,
  onChange,
  onScopeChange,
  scope,
  value,
}: FolderSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const disabledReasonId = useId();
  const hasQuery = value.length > 0;
  const label =
    scope === "library" ? "Search Library" : "Search Current Folder";

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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

  return (
    <div className="mt-2 sm:mt-3">
      <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background/80 shadow-xs backdrop-blur-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 sm:min-h-11 sm:flex-row sm:items-center">
        <label htmlFor="file-search-scope" className="sr-only">
          Search scope
        </label>
        <div className="relative w-full shrink-0 border-b border-border/70 sm:w-auto sm:border-r sm:border-b-0">
          <select
            id="file-search-scope"
            name="file-search-scope"
            value={scope}
            disabled={disabled}
            onChange={(event) =>
              onScopeChange(event.target.value as FileSearchScope)
            }
            className="h-11 w-full appearance-none bg-background py-0 pr-9 pl-3 text-sm font-medium text-foreground outline-none disabled:opacity-60 sm:w-auto"
          >
            <option value="library">Library</option>
            {canSearchCurrentFolder ? (
              <option value="folder">Current folder</option>
            ) : null}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center">
          <Search
            aria-hidden="true"
            className="ml-3 size-4 shrink-0 text-muted-foreground"
          />
          <label htmlFor="file-search-input" className="sr-only">
            {label}
          </label>
          <input
            id="file-search-input"
            name="file-search-query"
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={value}
            disabled={disabled}
            aria-describedby={`${descriptionId}${disabledReason ? ` ${disabledReasonId}` : ""}`}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              if (value) {
                event.preventDefault();
                onChange("");
              } else {
                inputRef.current?.blur();
              }
            }}
            placeholder={
              scope === "library"
                ? "Search all imported tracks…"
                : "Search this folder…"
            }
            className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed sm:text-sm"
          />
          <div className="flex shrink-0 items-center gap-1 pr-1 pointer-coarse:gap-3">
            {hasQuery && !disabled ? (
              <IconTooltip label="Clear search">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    onChange("");
                    focusSearch();
                  }}
                  aria-label="Clear search"
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </IconTooltip>
            ) : null}
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    aria-label="Search information"
                  />
                }
              >
                <Info aria-hidden="true" className="size-4" />
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                className="w-64 text-sm"
              >
                Search checks file names only. Enter at least two characters.
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
      <p id={descriptionId} className="sr-only">
        Search checks file names only. Enter at least two characters.
      </p>
      {disabledReason ? (
        <p
          id={disabledReasonId}
          className="mt-1.5 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
