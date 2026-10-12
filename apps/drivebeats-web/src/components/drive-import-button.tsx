"use client";

import { FolderPlus, Loader2, Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { useDriveImport } from "@/hooks/use-drive-import";

type DriveImportButtonProps = ComponentProps<typeof Button> & {
  iconOnly?: boolean;
};

export function DriveImportButton({
  children,
  disabled,
  iconOnly,
  ...props
}: DriveImportButtonProps) {
  const { importFromDrive, isImporting } = useDriveImport();

  const iconSize = iconOnly ? "size-3.5" : "size-4";

  return (
    <Button
      type="button"
      onClick={() => void importFromDrive()}
      disabled={disabled || isImporting}
      {...props}
    >
      {isImporting ? (
        <Loader2 className={`${iconSize} animate-spin`} />
      ) : iconOnly ? (
        <Plus className={iconSize} />
      ) : (
        <FolderPlus className={iconSize} />
      )}
      {!iconOnly && (children ?? "Add from Drive")}
    </Button>
  );
}
