import "server-only";

import { cache } from "react";

import { db } from "@/lib/db/kysely";
import { createClient } from "@/lib/supabase/server";

export type Role = "consultant" | "ops" | "admin";

export type SessionData = {
  user: { id: string; email: string };
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    role: Role;
    is_active: boolean;
  };
};

export type SessionState =
  | { kind: "session"; data: SessionData }
  | { kind: "inactive" }
  | { kind: "none" };

export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };

  const profile = await db
    .selectFrom("profiles")
    .select(["id", "email", "full_name", "role", "is_active"])
    .where("id", "=", user.id)
    .executeTakeFirst();

  if (!profile) return { kind: "none" };
  if (!profile.is_active) return { kind: "inactive" };

  return {
    kind: "session",
    data: {
      user: { id: user.id, email: user.email ?? "" },
      profile,
    },
  };
});

export async function getSession(): Promise<SessionData | null> {
  const state = await getSessionState();
  return state.kind === "session" ? state.data : null;
}
