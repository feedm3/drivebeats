"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  closeActiveGooglePicker,
  hasActiveGooglePickerSession,
  subscribeToGooglePickerSession,
} from "@/lib/google-picker";

export function GooglePickerCloseButton() {
  const isPickerOpen = useSyncExternalStore(
    subscribeToGooglePickerSession,
    hasActiveGooglePickerSession,
    () => false,
  );

  if (!isPickerOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] flex justify-end p-3 sm:p-4">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="pointer-events-auto shadow-lg"
        onClick={closeActiveGooglePicker}
        aria-label="Close Google Drive picker"
      >
        <X className="size-4" />
        Close picker
      </Button>
    </div>
  );
}
