import Image from "next/image";
import Link from "next/link";
import { SignInButton } from "@/components/sign-in-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 z-10 w-full border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Image
            src="/web-app-manifest-192x192.png"
            alt="DriveBeats"
            width={28}
            height={28}
            className="rounded-md"
          />
          DriveBeats
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <SignInButton className="hidden h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex" />
        </div>
      </div>
    </header>
  );
}
