"use client";

import type { FolderEntry } from "@/types";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment } from "react";

interface BreadcrumbNavProps {
  folderStack: FolderEntry[];
  onNavigate: (index: number) => void;
}

export function BreadcrumbNav({ folderStack, onNavigate }: BreadcrumbNavProps) {
  return (
    <Breadcrumb aria-label="Folder navigation">
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
