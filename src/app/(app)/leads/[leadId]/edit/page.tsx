import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "kysely";

import { DetailsForm } from "@/components/leads/phase16-forms";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";

export default async function Page({ params }: { params: Promise<{ leadId: string }> }) {
  await requireRole(["consultant", "admin"]);
  const id = (await params).leadId;
  const lead = await db.selectFrom("leads").selectAll().select(sql<string | null>`move_in_date::text`.as("move_in_date_text")).where("id", "=", id).executeTakeFirst();
  if (!lead) notFound();
  const consultants = await db.selectFrom("profiles").select(["id", "full_name"]).where("is_active", "=", true).where("role", "in", ["consultant", "admin"]).execute();
  return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8"><Link href={`/leads/${id}`} className="mb-4 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← Back to lead</Link><div className="mb-6"><h1 className="break-words text-2xl font-bold">Edit {lead.name}</h1><p className="mt-1 text-sm text-slate-500">Update durable customer and ownership details.</p></div><section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><DetailsForm lead={lead} consultants={consultants}/></section></main>;
}
