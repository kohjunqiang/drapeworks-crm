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

export const getSession = cache(async (): Promise<SessionData | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await db
    .selectFrom("profiles")
    .select(["id", "email", "full_name", "role", "is_active"])
    .where("id", "=", user.id)
    .executeTakeFirst();

  if (!profile || !profile.is_active) return null;

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile,
  };
});
