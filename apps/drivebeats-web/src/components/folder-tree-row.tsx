"use client";

import type { ReactNode } from "react";

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
