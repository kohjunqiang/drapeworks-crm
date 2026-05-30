import { ConsultationForm } from "@/components/orders/consultation-form";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";

export const dynamic = "force-dynamic";

export const metadata = { title: "New Consultation — Drapeworks CRM" };

export default async function NewConsultationPage() {
  await requireRole(["consultant", "admin"]);

  const fabrics = await db
    .selectFrom("fabrics")
    .select(["code", "name", "type"])
    .where("status", "=", "Active")
    .orderBy("code", "asc")
    .execute();

  const today = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            New Consultation
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Capture measurements and fabric details on-site
          </p>
        </div>
        <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded px-3 py-2 sm:text-right">
          <div>Date: <span className="font-medium text-slate-700">{today}</span></div>
        </div>
      </div>
      <ConsultationForm mode="create" fabrics={fabrics} />
    </main>
  );
}
