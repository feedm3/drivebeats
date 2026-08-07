"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

/* Shared row style for popover menus.

   Stacked menu rows cannot use the `touch-target` utility — its overlay is out
   of flow, so adjacent rows would silently swallow each other's taps. Per the
   note in globals.css such groups take real padding instead, which is what
   `pointer-coarse:min-h-11` does here: 44px rows for a finger, unchanged
   compact rows for a mouse. Gated on pointer capability, not viewport width. */
const POPOVER_MENU_ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 pointer-coarse:min-h-11 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-56 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { POPOVER_MENU_ITEM_CLASS, Popover, PopoverContent, PopoverTrigger };
