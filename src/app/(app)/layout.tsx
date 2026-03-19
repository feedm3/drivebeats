import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getServerAuthSession } from "@/lib/server-auth";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerAuthSession();

  return <AppShell initialUser={session?.user ?? null}>{children}</AppShell>;
}
