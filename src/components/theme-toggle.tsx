"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "@/hooks/use-theme";

const options: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
];

export function ThemeToggle() {
  const { theme, setTheme, mounted } = useTheme();

  if (!mounted) return <div className="h-7 w-[84px]" />;

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/70 p-0.5 shadow-xs backdrop-blur-sm">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={`rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            theme === value
              ? "bg-primary/12 text-primary shadow-sm"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
