import { cookies } from "next/headers";
import {
  AUTH_SESSION_COOKIE,
  type AuthSession,
  parseAuthSession,
} from "@/lib/auth-session";

export async function getServerAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  return parseAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
}
