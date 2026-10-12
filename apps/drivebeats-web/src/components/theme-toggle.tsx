"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { IconTooltip } from "@/components/ui/icon-tooltip";

const themes = ["system", "light", "dark"] as const;

const options: {
  value: (typeof themes)[number];
  icon: typeof Sun;
  label: string;
}[] = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
];

interface ThemeToggleProps {
  size?: "default" | "menu";
}

export function ThemeToggle({ size = "default" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Placeholder must track the coarse-pointer sizes below or the header jumps
  // on hydration.
  if (!mounted) {
    return (
      <div
        className={
          size === "menu"
            ? "h-9 w-[108px] pointer-coarse:h-13 pointer-coarse:w-[148px]"
            : "h-7 w-[84px] pointer-coarse:h-[50px] pointer-coarse:w-[142px]"
        }
      />
    );
  }

  const shellClass =
    size === "menu"
      ? "inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 p-1 shadow-xs backdrop-blur-sm"
      : "inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/70 p-0.5 shadow-xs backdrop-blur-sm";

  // Segmented control: the three options sit against each other, so an
  // out-of-flow hit area would make each segment steal from its neighbours.
  // These grow with real padding instead, which moves the segments apart as
  // it grows them. Both variants reach a square 44x44 on coarse pointers
  // (16px icon + 2x14px) — padding has to stay symmetric or the segments
  // turn into narrow portrait slivers that read as squashed together. The
  // header variant then measures 140px, which still clears the ~157px the
  // 320px marketing header leaves beside the wordmark.
  const buttonClass =
    size === "menu"
      ? "rounded-full p-1.5 pointer-coarse:p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      : "rounded-full p-1 pointer-coarse:p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  const iconClass =
    size === "menu" ? "size-4" : "size-3.5 pointer-coarse:size-4";

  return (
    <div className={shellClass}>
      {options.map(({ value, icon: Icon, label }) => (
        <IconTooltip key={value} label={label}>
          <button
            type="button"
            onClick={() => setTheme(value)}
            className={`${buttonClass} ${
              theme === value
                ? "bg-primary/12 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
            aria-label={label}
          >
            <Icon className={iconClass} />
          </button>
        </IconTooltip>
      ))}
    </div>
  );
}
