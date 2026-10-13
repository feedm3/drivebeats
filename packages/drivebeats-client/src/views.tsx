"use client";
import type { DriveFile, FolderEntry } from "@drivebeats/core/types";
import { FOLDER_MIME } from "@drivebeats/core/types";
import {
  Fragment,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  useId,
} from "react";
import { getHighlightedTextParts } from "./file-search";

export function BreadcrumbNav({
  folderStack,
  onNavigate,
  className,
}: {
  folderStack: FolderEntry[];
  onNavigate(index: number): void;
  className?: string;
}) {
  return (
    <nav aria-label="Folder navigation" className={className}>
      <ol className="db-breadcrumbs flex flex-wrap items-center gap-1 text-sm">
        {folderStack.map((folder, index) => (
          <Fragment key={folder.id}>
            {index > 0 ? <li aria-hidden="true">/</li> : null}
            <li>
              {index === folderStack.length - 1 ? (
                <span
                  aria-current="page"
                  className="font-semibold text-foreground"
                >
                  {folder.name}
                </span>
              ) : (
                <button
                  type="button"
                  style={{ minHeight: 44, minWidth: 44 }}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => onNavigate(index)}
                >
                  {folder.name}
                </button>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
export function HighlightedName({
  name,
  searchQuery,
  className,
}: {
  name: string;
  searchQuery: string;
  className?: string;
}) {
  return (
    <span className={className ?? "db-file-name block truncate font-medium"}>
      {getHighlightedTextParts(name, searchQuery).map((part) =>
        part.isMatch ? (
          <mark
            key={part.start}
            className="rounded-sm bg-primary/12 px-0.5 text-foreground"
          >
            {part.value}
          </mark>
        ) : (
          <span key={part.start}>{part.value}</span>
        ),
      )}
    </span>
  );
}
export function FolderTreeRow({
  children,
  depth = 0,
  expanded,
  selected,
  onSelect,
  className,
}: {
  children: ReactNode;
  depth?: number;
  expanded?: boolean;
  selected: boolean;
  onSelect(): void;
  className?: string;
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={selected}
      tabIndex={0}
      className={className ?? "db-folder-row"}
      style={{ minHeight: 44, paddingInlineStart: depth * 16 + 4 }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
    </div>
  );
}
export function FolderTree({
  folders,
  currentId,
  onNavigate,
}: {
  folders: (FolderEntry & { depth?: number })[];
  currentId: string;
  onNavigate(folder: FolderEntry): void;
}) {
  return (
    <div role="tree" aria-label="Imported Folders" className="db-folder-tree">
      {folders.map((folder) => (
        <FolderTreeRow
          key={folder.id}
          depth={folder.depth}
          selected={folder.id === currentId}
          onSelect={() => onNavigate(folder)}
        >
          ▸ {folder.name}
        </FolderTreeRow>
      ))}
    </div>
  );
}
export function SearchInput({
  inputRef,
  onValueChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: Ref<HTMLInputElement>;
  onValueChange(value: string): void;
}) {
  return (
    <input
      {...props}
      ref={inputRef}
      type="search"
      inputMode="search"
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
export function SearchScopeSelect({
  scope,
  onScopeChange,
  canSearchCurrentFolder = true,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  scope: "library" | "folder";
  onScopeChange(scope: "library" | "folder"): void;
  canSearchCurrentFolder?: boolean;
}) {
  return (
    <select
      {...props}
      value={scope}
      onChange={(event) =>
        onScopeChange(event.target.value as "library" | "folder")
      }
    >
      <option value="library">Library</option>
      {canSearchCurrentFolder ? (
        <option value="folder">Current folder</option>
      ) : null}
    </select>
  );
}
export function FileRows({
  files,
  query,
  currentId,
  favorites,
  onFolder,
  onPlay,
  onFavorite,
  metadata,
}: {
  files: DriveFile[];
  query: string;
  currentId?: string | null;
  favorites?: ReadonlySet<string>;
  metadata?: Record<
    string,
    { title?: string; artist?: string; album?: string }
  >;
  onFolder(file: DriveFile): void;
  onPlay(file: DriveFile): void;
  onFavorite?(file: DriveFile): void;
}) {
  return (
    <ul className="db-file-list" aria-label="Files and folders">
      {files.map((file) => (
        <li key={file.id}>
          <button
            className="db-file-row"
            type="button"
            aria-pressed={currentId === file.id}
            onClick={() =>
              file.mimeType === FOLDER_MIME ? onFolder(file) : onPlay(file)
            }
          >
            <span aria-hidden="true">
              {file.mimeType === FOLDER_MIME ? "▸" : "♪"}
            </span>
            <span className="db-row-copy">
              <HighlightedName name={file.name} searchQuery={query} />
              {metadata?.[file.id] ? (
                <span className="db-row-subtitle">
                  {[
                    metadata[file.id].title,
                    metadata[file.id].artist,
                    metadata[file.id].album,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </span>
          </button>
          {onFavorite && file.mimeType !== FOLDER_MIME ? (
            <button
              type="button"
              className="db-favorite"
              aria-label={`${favorites?.has(file.id) ? "Remove" : "Add"} ${file.name} ${favorites?.has(file.id) ? "from" : "to"} favorites`}
              aria-pressed={favorites?.has(file.id) ?? false}
              onClick={() => onFavorite(file)}
            >
              {favorites?.has(file.id) ? "★" : "☆"}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
export function LibrarySearch({
  value,
  onChange,
  scope,
  onScopeChange,
}: {
  value: string;
  onChange(value: string): void;
  scope: "library" | "folder";
  onScopeChange(scope: "library" | "folder"): void;
}) {
  const inputId = useId();
  return (
    <div className="db-search">
      <label htmlFor={inputId}>
        <span className="db-sr-only">
          {scope === "library" ? "Library Search" : "Current Folder Search"}
        </span>
        <SearchInput
          id={inputId}
          placeholder={
            scope === "library" ? "Search your Library" : "Search this folder"
          }
          value={value}
          onValueChange={onChange}
        />
      </label>
      <SearchScopeSelect
        aria-label="Search scope"
        scope={scope}
        onScopeChange={onScopeChange}
      />
    </div>
  );
}
