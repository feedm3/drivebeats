import { MarketingHeader } from "@/components/marketing-header";
import { Footer } from "@/components/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />
      <main className="mt-14 flex-1">{children}</main>
      <Footer />
    </div>
  );
}
