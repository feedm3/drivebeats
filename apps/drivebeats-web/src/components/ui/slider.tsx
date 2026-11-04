"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
  className,
  "aria-label": ariaLabel,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  );
  const thumbKeyPrefix = React.useId();
  const thumbKeys = React.useMemo(
    () =>
      Array.from(
        { length: _values.length },
        () => `${thumbKeyPrefix}-${crypto.randomUUID()}`,
      ),
    [thumbKeyPrefix, _values.length],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      aria-label={ariaLabel}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      {/* Base UI hit-tests Control for track presses. Give every pointer a
          44px interaction strip while keeping the visible track slim. Only
          the cross-axis grows, preserving click and drag value mapping. */}
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex w-full cursor-pointer items-center data-[disabled]:cursor-default data-[orientation=horizontal]:h-11 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-11 data-[orientation=vertical]:flex-col"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-muted transition-[height] data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full group-hover:data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:pointer-coarse:h-2 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5 data-[orientation=vertical]:pointer-coarse:w-2",
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
            )}
          />
        </SliderPrimitive.Track>
        {_values.map((_, thumbIndex) => (
          // Two coarse-pointer fixes, both keyed off `pointer: coarse` rather
          // than a viewport width — a narrow desktop window still hovers, a
          // wide tablet still cannot.
          //
          // 1. `pointer-coarse:opacity-100` — the `group-hover` reveal is
          //    wrapped in `@media (hover: hover)` by Tailwind, so on a phone
          //    the playhead handle would never appear at all.
          // 2. `before:-inset-3.5` — a transparent 44x44 grab area (16px dot +
          //    2x14px) centred on the dot. It is a pseudo-element on purpose:
          //    Base UI positions the thumb with `inset-inline-start: <value>%`
          //    plus `translate: -50% -50%` and measures `getBoundingClientRect`
          //    for both the inset-mode offset and the pointer-down grab offset.
          //    A pseudo-element leaves that rect at 16px, so the dot's centre
          //    stays exactly on the value and dragging keeps its grab offset.
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
            key={thumbKeys[thumbIndex]}
            className="block size-4 shrink-0 rounded-full border border-primary bg-primary shadow-sm opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-3.5 pointer-coarse:before:content-[''] transition-[color,box-shadow,opacity] ring-ring/50 hover:ring-4 has-[:focus-visible]:ring-4 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
