import { Footer } from "@/components/footer";
import { MarketingHeader } from "@/components/marketing-header";
import { Providers } from "@/components/providers";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <MarketingHeader />
        {/* mt-14 clears the fixed header, pt-safe clears the extra height the
            header gained from its own top inset. */}
        <main className="mt-14 flex-1 pt-safe">{children}</main>
        <Footer />
      </div>
    </Providers>
  );
}
