import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
  const session = await getServerAuthSession({ allowIncomplete: true });

  if (!session) {
    redirect("/");
  }

  return (
    <AppShell
      initialUser={session.user ?? null}
      initialAccountGeneration={session.accountGeneration}
      initialGrantedScopes={session.grantedScopes}
    >
      {children}
    </AppShell>
  );
}
