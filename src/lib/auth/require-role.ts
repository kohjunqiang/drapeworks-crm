import "server-only";

import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  getSessionState,
  type Role,
  type SessionData,
} from "./get-session";

export type { Role, SessionData };

export async function requireSession(): Promise<SessionData> {
  const state = await getSessionState();
  if (state.kind === "session") return state.data;

  if (state.kind === "inactive") {
    // Clear the auth cookie so the user can't loop into the protected
    // routes again. Then send them to /login with an explanatory notice.
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?inactive=1");
  }

  redirect("/login");
}

export async function requireRole(allowed: Role[]): Promise<SessionData> {
  const session = await requireSession();
  if (!allowed.includes(session.profile.role)) {
    notFound();
  }
  return session;
}
