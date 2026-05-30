import type { Role } from "@/lib/auth/get-session";

const STYLES: Record<Role, string> = {
  admin: "bg-red-100 text-red-700",
  ops: "bg-blue-100 text-blue-700",
  consultant: "bg-teal-100 text-teal-700",
};

const LABELS: Record<Role, string> = {
  admin: "Admin",
  ops: "Ops",
  consultant: "Consultant",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STYLES[role]}`}
    >
      {LABELS[role]}
    </span>
  );
}
