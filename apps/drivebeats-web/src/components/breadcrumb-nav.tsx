"use client";

import { Fragment } from "react";
import type { FolderEntry } from "@/types";

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
