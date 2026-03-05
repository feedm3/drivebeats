"use client";

import Link from "next/link";
import { usePlayerStore } from "@/stores/player-store";

export function Footer() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  return (
    <footer
      className={`border-t border-border/50 py-3 text-center text-xs text-muted-foreground ${currentTrack ? "relative z-50 mb-24" : ""}`}
    >
      <div className="flex items-center justify-center gap-3">
        <Link href="/privacy-policy" className="hover:underline">
          Privacy Policy
        </Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/imprint" className="hover:underline">
          Imprint
        </Link>
        <span aria-hidden="true">&middot;</span>
        <a
          href="https://www.dietenberger.me/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          Made by Fabian Dietenberger
        </a>
      </div>
    </footer>
  );
}
