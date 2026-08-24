"use server";

import "server-only";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "kysely";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { leadCreateSchema, leadUpdateSchema } from "@/lib/validation/lead";

function nextLeadRef(): string {
  // Manual leads have no Telegram or WhatsApp id to key off. A timestamp keeps
  // refs roughly ordered without a counter table; the random suffix is what
  // keeps them unique. On the timestamp alone, two consultants saving inside
  // the same millisecond collide on the UNIQUE index and the second one gets
  // an unhandled error on submit.
  return `MN-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

export async function createLead(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = leadCreateSchema.parse(input);

  const lead = await db
    .insertInto("leads")
    .values({
      lead_ref: nextLeadRef(),
      source: "manual",
      name: parsed.name,
      mobile: parsed.mobile ?? null,
      development: parsed.development ?? null,
      funnel_stage: parsed.funnel_stage,
      lead_status: parsed.lead_status,
      last_outcome: parsed.last_outcome ?? null,
      action_date: parsed.action_date ?? null,
      action_detail_override: parsed.action_detail_override ?? null,
      interaction_summary: parsed.interaction_summary ?? null,
      latest_quote_cents:
        parsed.latest_quote_sgd === undefined
          ? null
          : Math.round(parsed.latest_quote_sgd * 100),
      buying_readiness: parsed.buying_readiness ?? null,
      keys_status: parsed.keys_status ?? null,
      expected_key_date: parsed.expected_key_date ?? null,
      owner_id: session.user.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

export async function updateLead(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const parsed = leadUpdateSchema.parse(input);

  await db
    .updateTable("leads")
    .set({
      name: parsed.name,
      mobile: parsed.mobile ?? null,
      development: parsed.development ?? null,
      funnel_stage: parsed.funnel_stage,
      lead_status: parsed.lead_status,
      last_outcome: parsed.last_outcome ?? null,
      action_date: parsed.action_date ?? null,
      action_detail_override: parsed.action_detail_override ?? null,
      interaction_summary: parsed.interaction_summary ?? null,
      latest_quote_cents:
        parsed.latest_quote_sgd === undefined
          ? null
          : Math.round(parsed.latest_quote_sgd * 100),
      buying_readiness: parsed.buying_readiness ?? null,
      keys_status: parsed.keys_status ?? null,
      expected_key_date: parsed.expected_key_date ?? null,
      updated_at: new Date(),
    })
    .where("id", "=", parsed.id)
    .execute();

  revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.id}`);
}

/** No hard deletes (rules/data/migrations.md) — archive instead. */
export async function archiveLead(leadId: string): Promise<void> {
  await requireRole(["consultant", "admin"]);
  await db
    .updateTable("leads")
    .set({ is_archived: true, updated_at: new Date() })
    .where("id", "=", leadId)
    .execute();
  revalidatePath("/leads");
}

/** Powers the booking dialog's customer picker. */
export async function searchCustomers(term: string) {
  await requireRole(["consultant", "admin"]);
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  // Mobile formats are mixed: 40 leads store '98439326', 58 store
  // '+6581817358'. A literal LIKE on the raw column misses precisely the
  // duplicate this picker exists to catch, so both sides are reduced to the
  // last 8 digits — the part that actually identifies a Singapore number.
  // The predicate mirrors customers_mobile_last8_idx expression-for-expression
  // so the index can serve it.
  const digits = trimmed.replace(/\D/g, "");
  const last8 = digits.length >= 8 ? digits.slice(-8) : null;
  const like = `%${trimmed}%`;

  return db
    .selectFrom("customers")
    .leftJoin("orders", "orders.customer_id", "customers.id")
    .select((eb) => [
      "customers.id",
      "customers.name",
      "customers.mobile",
      "customers.email",
      eb.fn.count("orders.id").as("order_count"),
    ])
    .where((eb) =>
      eb.or([
        eb("customers.name", "ilike", like),
        ...(last8
          ? [
              eb(
                sql<string>`right(regexp_replace(customers.mobile, '\\D', '', 'g'), 8)`,
                "=",
                last8,
              ),
            ]
          : [eb("customers.mobile", "ilike", like)]),
      ]),
    )
    .groupBy([
      "customers.id",
      "customers.name",
      "customers.mobile",
      "customers.email",
    ])
    .orderBy("customers.name")
    .limit(10)
    .execute();
}
