"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
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

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-7 w-[84px]" />;

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/70 p-0.5 shadow-xs backdrop-blur-sm">
      {options.map(({ value, icon: Icon, label }) => (
        <IconTooltip key={value} label={label}>
          <button
            type="button"
            onClick={() => setTheme(value)}
            className={`rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              theme === value
                ? "bg-primary/12 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
            aria-label={label}
          >
            <Icon className="size-3.5" />
          </button>
        </IconTooltip>
      ))}
    </div>
  );
}
