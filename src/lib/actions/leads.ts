"use server";
import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sql } from "kysely";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { deriveRecommendations, deriveBuyingReadiness, deriveDaysToMoveIn, deriveActionRequired, deriveDueStatus } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { unsyncAppointment } from "@/lib/calendar/sync";
import { isCalendarConfigured } from "@/lib/calendar/google";
import { archiveLeadSchema, leadCreateSchema, leadDetailsSchema, leadQuickEditSchema, logUpdateSchema, recommendationSchema } from "@/lib/validation/lead";

const nextLeadRef = () => `MN-${Date.now()}-${randomBytes(3).toString("hex")}`;
const revalidateLead = (id: string) => {
  revalidatePath("/queue"); revalidatePath("/leads");
  revalidatePath(`/leads/${id}`); revalidatePath(`/leads/${id}/edit`);
};

export async function getLeadModalData(id: string) {
  await requireRole(["consultant", "admin"]);
  archiveLeadSchema.parse({ lead_id: id });
  const lead = await db.selectFrom("leads").selectAll().select([
    sql<string | null>`next_action_date::text`.as("next_action_date_text"),
    sql<string | null>`move_in_date::text`.as("move_in_date_text"),
  ]).where("id", "=", id).executeTakeFirstOrThrow();
  const [interactions, profiles, appointment] = await Promise.all([
    db.selectFrom("lead_interactions").leftJoin("profiles", "profiles.id", "lead_interactions.created_by")
      .select(["lead_interactions.id", "occurred_at", "interaction_type", "direction", "channel", "note", "profiles.full_name"])
      .where("lead_id", "=", id).orderBy("occurred_at", "desc").orderBy("lead_interactions.id", "desc").execute(),
    db.selectFrom("profiles").select(["id", "full_name", "is_active", "role"]).execute(),
    db.selectFrom("appointments")
      .leftJoin("orders", join => join
        .onRef("orders.lead_id", "=", "appointments.lead_id")
        .on("orders.is_draft", "=", true))
      .selectAll("appointments")
      .select("orders.id as draft_order_id")
      .where("appointments.lead_id", "=", id)
      .orderBy("appointments.created_at", "desc")
      .executeTakeFirst(),
  ]);
  const date = (value: Date | string | null) => value ? toSgDate(new Date(value)) : null;
  const actionRequired = deriveActionRequired({ ...lead, next_action_date: lead.next_action_date_text }, todayInSingapore());
  return { lead: { ...lead,
    created_date_text: date(lead.created_at), initiated_date_text: date(lead.first_initiated_at),
    last_contact_date_text: date(lead.last_contact_at), last_response_date_text: date(lead.last_customer_response_at),
    buying_readiness: deriveBuyingReadiness(lead.funnel_stage),
    days_to_move_in: deriveDaysToMoveIn(lead.move_in_date_text, todayInSingapore()),
    action_required: actionRequired, due_status: deriveDueStatus(actionRequired, lead.next_action_date_text, todayInSingapore()),
  }, interactions, appointment: appointment ?? null, calendarConfigured: isCalendarConfigured(), ownerName: profiles.find(person => person.id === (lead.assigned_consultant_id ?? lead.owner_id))?.full_name ?? "Unassigned",
    consultants: profiles.filter(person => person.is_active && (person.role === "admin" || person.role === "consultant")),
  };
}

export async function createLead(input: unknown): Promise<{ id: string }> {
  const session = await requireRole(["consultant", "admin"]);
  const p = leadCreateSchema.parse(input);
  const row = await db.insertInto("leads").values({
    lead_ref: nextLeadRef(), name: p.name, mobile: p.mobile ?? null,
    first_initiated_at: new Date(`${p.first_initiated_date}T00:00:00+08:00`),
    // Required by the schema; the before-insert trigger immediately derives
    // the authoritative value from the funnel fields.
    lead_status: "Active",
    development: p.development ?? null, contact_channel: p.contact_channel,
    source: p.source ?? null, inbound_outbound: p.inbound_outbound ?? null,
    primary_product: p.primary_product ?? null, funnel_stage: p.funnel_stage,
    closure_reason: p.closure_reason ?? null,
    interaction_summary: p.interaction_summary ?? null, owner_id: session.user.id,
  }).returning("id").executeTakeFirstOrThrow();
  revalidateLead(row.id);
  return { id: row.id };
}

export async function logLeadUpdate(input: unknown): Promise<void> {
  const session = await requireRole(["consultant", "admin"]);
  const p = logUpdateSchema.parse(input);
  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom("leads")
      .select(["funnel_stage", "last_outcome", "quote_valid_days"])
      .where("id", "=", p.lead_id).forUpdate().executeTakeFirstOrThrow();
    const quoteDate = p.quotation_sent_date
      ? new Date(`${p.quotation_sent_date}T00:00:00+08:00`) : undefined;
    const recommendationChanged = before.funnel_stage !== p.funnel_stage ||
      before.last_outcome !== p.last_outcome || quoteDate !== undefined ||
      before.quote_valid_days !== p.quote_valid_days;
    const updated = await trx.updateTable("leads").set({
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
    }).where("id", "=", p.lead_id)
      .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${p.expected_updated_at}`)
      .returning("id").executeTakeFirst();
    if (!updated) throw new Error("This lead changed since you opened it. Close and reopen it before saving.");
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
  const session = await requireRole(["consultant", "admin"]);
  const p = leadQuickEditSchema.parse(input);
  await db.transaction().execute(async (trx) => {
  const before = await trx.selectFrom("leads").select(["funnel_stage", "last_outcome", sql<string | null>`move_in_date::text`.as("move_in_date")])
    .where("id", "=", p.id).forUpdate().executeTakeFirstOrThrow();
  const row = await trx.updateTable("leads").set({
    ...(before.funnel_stage !== p.funnel_stage || before.move_in_date !== (p.move_in_date ?? null) || (p.last_outcome !== undefined && before.last_outcome !== p.last_outcome)
      ? { dismissed_recommendations: sql`'{}'::text[]` } : {}),
    owner_id: p.owner_id, assigned_consultant_id: p.owner_id,
    name: p.name, funnel_stage: p.funnel_stage,
    ...(p.last_outcome !== undefined ? { last_outcome: p.last_outcome } : {}),
    ...(p.keys_collected !== undefined ? { keys_collected: p.keys_collected } : {}),
    ...(p.interaction_summary !== undefined ? { interaction_summary: p.interaction_summary } : {}),
    ...(p.latest_quote_note !== undefined ? { latest_quote_note: p.latest_quote_note } : {}),
    ...(p.quotation_breakdown !== undefined ? { quotation_breakdown: p.quotation_breakdown } : {}),
    ...(p.historical_summary !== undefined ? { historical_summary: p.historical_summary } : {}),
    ...(p.funnel_stage === "Lost" || p.funnel_stage === "Not Qualified" ? { closure_reason: p.closure_reason } : {}),
    next_action_date: p.next_action_date ?? null, move_in_date: p.move_in_date ?? null,
    latest_quote_cents: p.latest_quote_sgd === null ? null : Math.round(p.latest_quote_sgd * 100),
    action_detail: p.action_detail ?? null, mobile: p.mobile ?? null,
    development: p.development ?? null, contact_channel: p.contact_channel,
    source: p.source, primary_product: p.primary_product, updated_at: new Date(),
  }).where("id", "=", p.id)
    .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${p.expected_updated_at}`)
    .returning("id").executeTakeFirst();
  if (!row) throw new Error("This lead changed since you opened it. Close and reopen it before saving.");
  await trx.insertInto("lead_interactions").values({
    lead_id: p.id, occurred_at: new Date(), direction: null,
    interaction_type: "Note", note: "Lead details saved", created_by: session.user.id,
  }).execute();
  if (before.funnel_stage !== p.funnel_stage) {
    await trx.insertInto("lead_stage_events").values({
      lead_id: p.id, from_stage: before.funnel_stage, to_stage: p.funnel_stage,
      changed_at: new Date(), changed_by: session.user.id, source: "user",
    }).execute();
  }
  });
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
  await db.transaction().execute(async trx => {
    const lead = await trx.selectFrom("leads").select(["id", "is_archived"])
      .where("id", "=", p.lead_id).forUpdate().executeTakeFirst();
    if (!lead || lead.is_archived) {
      throw new Error("This lead is already archived or no longer exists.");
    }
    const scheduled = await trx.selectFrom("appointments").select("id")
      .where("lead_id", "=", p.lead_id).where("status", "=", "scheduled")
      .executeTakeFirst();
    if (scheduled) throw new Error("Complete or cancel the scheduled appointment before archiving this lead.");
    const archived = await trx.updateTable("leads").set({ is_archived: true, updated_at: new Date() })
      .where("id", "=", p.lead_id).where("is_archived", "=", false)
      .returning("id").executeTakeFirst();
    if (!archived) throw new Error("This lead is already archived or no longer exists.");
  });
  revalidateLead(p.lead_id);
}

export async function deleteLead(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const p = archiveLeadSchema.parse(typeof input === "string" ? { lead_id: input } : input);
  // Make the lead unavailable first. Booking takes the same lead-row lock and
  // checks is_archived, so no appointment can appear after this snapshot while
  // Calendar cleanup runs outside the transaction.
  const appointments = await db.transaction().execute(async trx => {
    const lead = await trx.selectFrom("leads").select("id")
      .where("id", "=", p.lead_id).forUpdate().executeTakeFirst();
    if (!lead) throw new Error("This lead no longer exists.");
    await trx.updateTable("leads").set({
      is_archived: true,
      updated_at: new Date(),
    }).where("id", "=", p.lead_id).execute();
    return trx.selectFrom("appointments").select("id")
      .where("lead_id", "=", p.lead_id).orderBy("id").execute();
  });

  const cleanup = await Promise.all(
    appointments.map(appointment => unsyncAppointment(appointment.id)),
  );
  const failed = cleanup.find(result => !result.ok);
  if (failed && !failed.ok) {
    throw new Error(
      `Lead was archived but not deleted because Calendar cleanup failed: ${failed.error}`,
    );
  }

  await db.transaction().execute(async trx => {
    // Keep one lock order across the order/appointment workflow. Appointment
    // deletion updates linked order foreign keys, so lock orders first, then
    // appointments, then the lead.
    await trx.selectFrom("orders").select("id")
      .where(eb => eb.or([
        eb("lead_id", "=", p.lead_id),
        eb("appointment_id", "in",
          eb.selectFrom("appointments").select("id")
            .where("lead_id", "=", p.lead_id)),
      ]))
      .orderBy("id").forUpdate().execute();
    await trx.selectFrom("appointments").select("id")
      .where("lead_id", "=", p.lead_id)
      .orderBy("id").forUpdate().execute();
    const lead = await trx.selectFrom("leads").select("id")
      .where("id", "=", p.lead_id).forUpdate().executeTakeFirst();
    if (!lead) throw new Error("This lead no longer exists.");
    await trx.deleteFrom("lead_interactions").where("lead_id", "=", p.lead_id).execute();
    await trx.deleteFrom("lead_stage_events").where("lead_id", "=", p.lead_id).execute();
    await sql`delete from lead_import_baselines where lead_id = ${p.lead_id}`.execute(trx);
    await trx.deleteFrom("lead_legacy_import").where("lead_id", "=", p.lead_id).execute();
    await trx.deleteFrom("appointments").where("lead_id", "=", p.lead_id).execute();
    await trx.deleteFrom("leads").where("id", "=", p.lead_id).executeTakeFirstOrThrow();
  });
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
