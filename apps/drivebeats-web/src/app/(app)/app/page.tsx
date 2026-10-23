import { AppPageClient } from "@/components/app-page-client";
import { getServerAuthSession } from "@/lib/server-auth";

export default async function AppPage() {
  const session = await getServerAuthSession({ allowIncomplete: true });

  return <AppPageClient hasServerSession={!!session} />;
}
