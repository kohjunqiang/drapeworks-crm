"use server";
import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "kysely";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { deriveRecommendations } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { archiveLeadSchema, leadCreateSchema, leadDetailsSchema, leadQuickEditSchema, logUpdateSchema, recommendationSchema } from "@/lib/validation/lead";

const nextLeadRef = () => `MN-${Date.now()}-${randomBytes(3).toString("hex")}`;
const revalidateLead = (id: string) => {
  revalidatePath("/queue"); revalidatePath("/leads");
  revalidatePath(`/leads/${id}`); revalidatePath(`/leads/${id}/edit`);
};

export async function createLead(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const p = leadCreateSchema.parse(input);
  const row = await db.insertInto("leads").values({
    lead_ref: nextLeadRef(), name: p.name, mobile: p.mobile ?? null,
    development: p.development ?? null, contact_channel: p.contact_channel,
    source: p.source ?? null, inbound_outbound: p.inbound_outbound ?? null,
    primary_product: p.primary_product ?? null, funnel_stage: p.funnel_stage,
    closure_reason: p.closure_reason ?? null,
    interaction_summary: p.interaction_summary ?? null, owner_id: session.user.id,
  }).returning("id").executeTakeFirstOrThrow();
  revalidateLead(row.id); redirect(`/leads/${row.id}`);
}

export async function logLeadUpdate(input: unknown): Promise<void> {
  const session = await requireRole(["consultant", "admin"]);
  const p = logUpdateSchema.parse(input);
  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom("leads")
      .select(["funnel_stage", "last_outcome", "quote_valid_days"])
      .where("id", "=", p.lead_id).executeTakeFirstOrThrow();
    const quoteDate = p.quotation_sent_date
      ? new Date(`${p.quotation_sent_date}T00:00:00+08:00`) : undefined;
    const recommendationChanged = before.funnel_stage !== p.funnel_stage ||
      before.last_outcome !== p.last_outcome || quoteDate !== undefined ||
      before.quote_valid_days !== p.quote_valid_days;
    await trx.updateTable("leads").set({
      funnel_stage: p.funnel_stage, last_outcome: p.last_outcome,
      next_action_date: p.next_action_date ?? null,
      action_detail: p.action_detail ?? null,
      interaction_summary: p.interaction_summary ?? null,
      ...(p.funnel_stage === "Lost" || p.funnel_stage === "Not Qualified"
        ? { closure_reason: p.closure_reason! } : {}),
      ...(p.latest_quote_sgd !== undefined
        ? { latest_quote_cents: Math.round(p.latest_quote_sgd * 100) } : {}),
      ...(p.quotation_breakdown !== undefined
        ? { quotation_breakdown: p.quotation_breakdown } : {}),
      ...(quoteDate ? { quotation_sent_at: quoteDate } : {}),
      quote_valid_days: p.quote_valid_days,
      ...(recommendationChanged ? { dismissed_recommendations: sql`'{}'::text[]` } : {}),
      updated_at: new Date(),
    }).where("id", "=", p.lead_id).executeTakeFirstOrThrow();
    const interaction = p.last_outcome === "Customer Replied"
      ? { direction: "Inbound" as const, interaction_type: "Customer Message" as const }
      : p.last_outcome === "No Response"
        ? { direction: "Outbound" as const, interaction_type: "Follow-Up" as const }
        : p.last_outcome === "Awaiting Customer"
          ? { direction: "Outbound" as const, interaction_type: "Reply" as const }
          : { direction: p.direction, interaction_type: p.interaction_type };
    await trx.insertInto("lead_interactions").values({
      lead_id: p.lead_id, occurred_at: new Date(), ...interaction,
      note: p.note ?? null, created_by: session.user.id,
    }).execute();
    if (before.funnel_stage !== p.funnel_stage) {
      await trx.insertInto("lead_stage_events").values({
        lead_id: p.lead_id, from_stage: before.funnel_stage,
        to_stage: p.funnel_stage, changed_at: new Date(),
        changed_by: session.user.id, source: "user",
      }).execute();
    }
  });
  revalidateLead(p.lead_id);
}

export async function editLeadDetails(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const p = leadDetailsSchema.parse(input);
  const { id, expected_updated_at, owner_id, ...fields } = p;
  const before = await db.selectFrom("leads").select("move_in_date")
    .where("id", "=", id).executeTakeFirstOrThrow();
  const oldMoveIn = before.move_in_date ? String(before.move_in_date).slice(0, 10) : null;
  const moveInChanged = fields.move_in_date !== undefined && fields.move_in_date !== oldMoveIn;
  const row = await db.updateTable("leads").set({
    ...fields, owner_id, assigned_consultant_id: owner_id,
    ...(moveInChanged ? { dismissed_recommendations: sql`'{}'::text[]` } : {}),
    updated_at: new Date(),
  }).where("id", "=", id).where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${expected_updated_at}`)
    .returning("id").executeTakeFirst();
  if (!row) throw new Error("This lead changed since you opened it. Reload and try again.");
  revalidateLead(id);
}

export async function quickEditLead(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const p = leadQuickEditSchema.parse(input);
  await db.updateTable("leads").set({
    owner_id: p.owner_id, assigned_consultant_id: p.owner_id,
    name: p.name, funnel_stage: p.funnel_stage,
    ...(p.funnel_stage === "Lost" || p.funnel_stage === "Not Qualified" ? { closure_reason: p.closure_reason } : {}),
    next_action_date: p.next_action_date ?? null, move_in_date: p.move_in_date ?? null,
    latest_quote_cents: p.latest_quote_sgd === null ? null : Math.round(p.latest_quote_sgd * 100),
    action_detail: p.action_detail ?? null, mobile: p.mobile ?? null,
    development: p.development ?? null, contact_channel: p.contact_channel,
    source: p.source, primary_product: p.primary_product, updated_at: new Date(),
  }).where("id", "=", p.id).executeTakeFirstOrThrow();
  revalidateLead(p.id);
}

export async function acceptRecommendation(input: unknown): Promise<void> {
  const session = await requireRole(["consultant", "admin"]);
  const p = recommendationSchema.parse(input);
  await db.transaction().execute(async (trx) => {
    const lead = await trx.selectFrom("leads").selectAll()
      .where("id", "=", p.lead_id).executeTakeFirstOrThrow();
    const recommendations = deriveRecommendations({
      ...lead,
      next_action_date: lead.next_action_date ? String(lead.next_action_date).slice(0, 10) as SgDate : null,
      move_in_date: lead.move_in_date ? String(lead.move_in_date).slice(0, 10) as SgDate : null,
      quotation_sent_at: lead.quotation_sent_at ? toSgDate(new Date(lead.quotation_sent_at)) : null,
    }, todayInSingapore());
    const recommendation = recommendations.find((item) => item.code === p.code);
    if (!recommendation?.suggestedStage) throw new Error("This recommendation cannot be accepted.");
    if (recommendation.suggestedStage === "Lost" && !p.closure_reason) {
      throw new Error("Select a closure reason before marking this lead Lost.");
    }
    await trx.updateTable("leads").set({
      funnel_stage: recommendation.suggestedStage,
      ...(recommendation.suggestedStage === "Lost" ? { closure_reason: p.closure_reason } : {}),
      ...(recommendation.clearsOutcome ? { last_outcome: null } : {}),
      dismissed_recommendations: sql`'{}'::text[]`, updated_at: new Date(),
    }).where("id", "=", p.lead_id).execute();
    await trx.insertInto("lead_stage_events").values({
      lead_id: p.lead_id, from_stage: lead.funnel_stage,
      to_stage: recommendation.suggestedStage, changed_at: new Date(),
      changed_by: session.user.id, source: "user",
    }).execute();
  });
  revalidateLead(p.lead_id);
}

export async function dismissRecommendation(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const p = recommendationSchema.parse(input);
  await db.updateTable("leads").set({
    dismissed_recommendations: sql`array_append(dismissed_recommendations, ${p.code})`,
    updated_at: new Date(),
  }).where("id", "=", p.lead_id).execute();
  revalidateLead(p.lead_id);
}

export async function archiveLead(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const p = archiveLeadSchema.parse(typeof input === "string" ? { lead_id: input } : input);
  await db.updateTable("leads").set({ is_archived: true, updated_at: new Date() })
    .where("id", "=", p.lead_id).execute();
  revalidateLead(p.lead_id);
}

export async function searchCustomers(term: string) {
  await requireRole(["consultant", "admin"]);
  const value = term.trim(); if (value.length < 2) return [];
  return db.selectFrom("customers").select([
    "id", "name", "mobile", "email", sql<number>`0`.as("order_count"),
  ]).where("name", "ilike", `%${value.replace(/[%_]/g, "")}%`)
    .orderBy("name").limit(10).execute();
}
