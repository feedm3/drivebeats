import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border/50 px-4 py-6 text-center text-sm text-muted-foreground">
      {/* Wraps rather than squashing the three links into slivers at 320-390px. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
          rel="noopener"
          className="hover:underline"
        >
          Made by Fabian Dietenberger
        </a>
      </div>
    </footer>
  );
}
