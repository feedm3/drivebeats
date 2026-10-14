"use client";

import type { SelectHTMLAttributes } from "react";

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
