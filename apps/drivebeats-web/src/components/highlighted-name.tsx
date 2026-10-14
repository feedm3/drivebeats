"use client";

import { getHighlightedTextParts } from "@/lib/file-search";

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
