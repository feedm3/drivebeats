"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IconTooltipProps
  extends Omit<
    React.ComponentProps<typeof TooltipContent>,
    "children" | "content"
  > {
  label: ReactNode;
  children: ReactElement;
}

export function IconTooltip({
  label,
  children,
  ...contentProps
}: IconTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent {...contentProps}>{label}</TooltipContent>
    </Tooltip>
  );
}
