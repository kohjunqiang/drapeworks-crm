"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { adminClient } from "@/lib/supabase/admin";
import {
  inviteUserSchema,
  roleUpdateSchema,
  setActiveSchema,
} from "@/lib/validation/user";

export async function inviteUser(input: unknown) {
  await requireRole(["admin"]);
  const parsed = inviteUserSchema.parse(input);

  const admin = adminClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const { data, error } = await admin.auth.admin.inviteUserByEmail(
    parsed.email,
    {
      redirectTo: `${siteUrl}/auth/callback?next=/set-password`,
      data: { full_name: parsed.fullName },
    },
  );
  if (error) throw new Error(error.message);
  const userId = data.user?.id;
  if (!userId) throw new Error("Invite returned no user id");

  // The handle_new_auth_user trigger inserts a profile with default role
  // 'consultant'. Update role + full_name if needed.
  await db
    .updateTable("profiles")
    .set({ role: parsed.role, full_name: parsed.fullName })
    .where("id", "=", userId)
    .execute();

  revalidatePath("/admin/users");
  return { userId };
}

export async function updateUserRole(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = roleUpdateSchema.parse(input);

  if (parsed.userId === session.user.id) {
    throw new Error("Cannot change your own role");
  }

  await db
    .updateTable("profiles")
    .set({ role: parsed.role })
    .where("id", "=", parsed.userId)
    .execute();

  revalidatePath("/admin/users");
}

export async function setUserActive(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = setActiveSchema.parse(input);

  if (parsed.userId === session.user.id) {
    throw new Error("Cannot deactivate yourself");
  }

  await db
    .updateTable("profiles")
    .set({ is_active: parsed.active })
    .where("id", "=", parsed.userId)
    .execute();

  revalidatePath("/admin/users");
}
