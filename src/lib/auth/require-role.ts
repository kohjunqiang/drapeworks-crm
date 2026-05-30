import "server-only";

import { notFound, redirect } from "next/navigation";

import { getSession, type Role, type SessionData } from "./get-session";

export type { Role, SessionData };

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(allowed: Role[]): Promise<SessionData> {
  const session = await requireSession();
  if (!allowed.includes(session.profile.role)) {
    notFound();
  }
  return session;
}
