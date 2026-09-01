import Link from "next/link";

import { NewLeadForm } from "@/components/leads/phase16-forms";
import { requireRole } from "@/lib/auth/require-role";
import { todayInSingapore } from "@/lib/leads/sg-date";

export const metadata = { title: "New Lead — Drapeworks CRM" };

export default async function Page() {
  await requireRole(["consultant", "admin"]);
  return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8"><Link href="/leads?view=work" className="mb-4 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← Back to Leads</Link><div className="mb-6"><h1 className="text-2xl font-bold">New lead</h1><p className="mt-1 text-sm text-slate-500">Capture the essentials and start the next action.</p></div><NewLeadForm initialInitiatedDate={todayInSingapore()}/></main>;
}
