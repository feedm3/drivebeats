"use client";

import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { FolderEntry } from "@/types";

interface BreadcrumbNavProps {
  folderStack: FolderEntry[];
  onNavigate: (index: number) => void;
  className?: string;
}

export function BreadcrumbNav({
  folderStack,
  onNavigate,
  className,
}: BreadcrumbNavProps) {
  return (
    <Breadcrumb aria-label="Folder navigation" className={className}>
      <BreadcrumbList>
        {folderStack.map((folder, i) => (
          <Fragment key={folder.id}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {i < folderStack.length - 1 ? (
                <BreadcrumbLink
                  className="cursor-pointer"
                  onClick={() => onNavigate(i)}
                >
                  {folder.name}
                </BreadcrumbLink>
              ) : (
                <span className="font-semibold text-foreground">
                  {folder.name}
                </span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
