"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/nav/role-badge";
import { setUserActive, updateUserRole } from "@/lib/actions/users";
import type { Role } from "@/lib/auth/get-session";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: Date | string;
};

type Props = {
  users: UserRow[];
  currentUserId: string;
};

const SG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(d: Date | string): string {
  return SG_DATE.format(new Date(d));
}

const INPUT_CLS =
  "px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-500 bg-white";

export function UsersTable({ users, currentUserId }: Props) {
  const [pending, startTransition] = useTransition();

  function onRoleChange(userId: string, role: Role) {
    startTransition(async () => {
      try {
        await updateUserRole({ userId, role });
        toast.success("Role updated");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  function onToggleActive(userId: string, active: boolean) {
    if (!confirm(active ? "Reactivate user?" : "Deactivate user?")) return;
    startTransition(async () => {
      try {
        await setUserActive({ userId, active });
        toast.success(active ? "User reactivated" : "User deactivated");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <>
      <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.full_name ?? "—"}
                    {isSelf && (
                      <span className="ml-2 text-xs text-slate-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <RoleBadge role={u.role} />
                    ) : (
                      <select
                        value={u.role}
                        disabled={pending}
                        onChange={(e) =>
                          onRoleChange(u.id, e.target.value as Role)
                        }
                        className={INPUT_CLS}
                      >
                        <option value="consultant">Consultant</option>
                        <option value="ops">Ops</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onToggleActive(u.id, !u.is_active)}
                        className="text-xs text-slate-600 hover:text-red-600 disabled:opacity-50"
                      >
                        {u.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <div
              key={u.id}
              className="bg-white rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {u.full_name ?? "—"}
                    {isSelf && (
                      <span className="ml-2 text-xs text-slate-400">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {u.email}
                  </div>
                </div>
                {u.is_active ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 flex-shrink-0">
                    Active
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 flex-shrink-0">
                    Inactive
                  </span>
                )}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                {isSelf ? (
                  <RoleBadge role={u.role} />
                ) : (
                  <select
                    value={u.role}
                    disabled={pending}
                    onChange={(e) =>
                      onRoleChange(u.id, e.target.value as Role)
                    }
                    className={INPUT_CLS}
                  >
                    <option value="consultant">Consultant</option>
                    <option value="ops">Ops</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                {!isSelf && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onToggleActive(u.id, !u.is_active)}
                    className="text-xs text-slate-600 hover:text-red-600 disabled:opacity-50"
                  >
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
