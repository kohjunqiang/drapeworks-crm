import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import {
  UsersTable,
  type UserRow,
} from "@/components/admin/users-table";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";

export const dynamic = "force-dynamic";

export const metadata = { title: "Users — Drapeworks CRM" };

export default async function AdminUsersPage() {
  const session = await requireRole(["admin"]);

  const users = await db
    .selectFrom("profiles")
    .select(["id", "email", "full_name", "role", "is_active", "created_at"])
    .orderBy("created_at", "asc")
    .execute();

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Users
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Invite teammates and manage roles
          </p>
        </div>
        <InviteUserDialog />
      </div>
      <UsersTable
        users={users as UserRow[]}
        currentUserId={session.user.id}
      />
    </main>
  );
}
