import Image from "next/image";
import Link from "next/link";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 z-10 w-full border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-4xl items-center px-4">
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
      </div>
    </header>
  );
}
