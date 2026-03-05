import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border/50 py-6 text-center text-sm text-muted-foreground">
      <div className="flex items-center justify-center gap-4">
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
