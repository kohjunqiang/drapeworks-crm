"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { sql } from "kysely";
import { z } from "zod";
import { leadBatchFetchSchema, leadBatchPatchSchema, leadBatchSaveSchema } from "@/lib/validation/lead-batch";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import type { LeadBatchError, LeadBatchSnapshot } from "@/lib/leads/batch-draft";

const TERMINAL_STAGES = new Set(["Lost", "Not Qualified"]);
const MAX_BATCH = 50;

const revalidateLead = (id: string) => {
  revalidatePath("/queue"); revalidatePath("/leads");
  revalidatePath(`/leads/${id}`); revalidatePath(`/leads/${id}/edit`);
};

type SnapshotRow = Omit<LeadBatchSnapshot, "updated_at"> & { updated_at: Date };
const toSnapshot = (row: SnapshotRow): LeadBatchSnapshot => ({ ...row, updated_at: row.updated_at.toISOString() });

const editableSelect = [
  "id", "name", "funnel_stage", "closure_reason", "last_outcome",
  sql<string | null>`next_action_date::text`.as("next_action_date_text"),
  sql<string | null>`move_in_date::text`.as("move_in_date_text"),
  "action_detail", "mobile", "development", "inbound_outbound", "contact_channel",
  "source", "primary_product", "keys_collected", "interaction_summary",
  "quotation_breakdown", "historical_summary", "latest_quote_note",
  "renovation_buying_stage", "engagement_quality", "latest_quote_cents",
  "assigned_consultant_id", "owner_id", "is_archived", "updated_at",
] as const;

export async function getLeadBatchEditData(input: unknown): Promise<{ leads: LeadBatchSnapshot[] }> {
  await requireRole(["consultant", "admin"]);
  const p = leadBatchFetchSchema.parse(input);
  const ids = [...new Set(p.lead_ids)].slice(0, MAX_BATCH);
  if (!ids.length) return { leads: [] };
  const rows = await db.selectFrom("leads").select(editableSelect).where("id", "in", ids).orderBy("id").execute();
  return { leads: rows.map(row => toSnapshot(row as SnapshotRow)) };
}

type Patch = z.infer<typeof leadBatchPatchSchema>;

export async function saveLeadBatch(input: unknown): Promise<
  { ok: true; saved: string[]; skipped: string[] } | { ok: false; errors: LeadBatchError[] }
> {
  const session = await requireRole(["consultant", "admin"]);
  // Validation failures are a definitive no-write — return structured
  // lead/field errors so the UI can point at the offending control, rather
  // than throwing and surfacing as an unknown-commit-status error.
  const parsed = leadBatchSaveSchema.safeParse(input);
  if (!parsed.success) {
    const rawLeads = (input as { leads?: { id?: unknown }[] })?.leads;
    const errors = parsed.error.issues.map(issue => {
      const index = typeof issue.path[1] === "number" ? issue.path[1] : undefined;
      const leadId = typeof rawLeads?.[index ?? -1]?.id === "string" ? rawLeads[index as number].id as string : "";
      const field = issue.path[2] === "patch" && typeof issue.path[3] === "string" ? issue.path[3] : undefined;
      return { leadId, kind: "validation" as const, field, message: issue.message };
    });
    return { ok: false as const, errors };
  }
  const p = parsed.data;
  const items = [...p.leads].sort((a, b) => a.id.localeCompare(b.id));
  const outcome = await db.transaction().execute(async (trx) => {
    // Lock every row in id order so concurrent batches cannot deadlock.
    const beforeRows = await trx.selectFrom("leads").select(editableSelect)
      .where("id", "in", items.map(item => item.id)).orderBy("id").forUpdate().execute();
    const before = new Map(beforeRows.map(row => [row.id, row as SnapshotRow]));
    const errors: LeadBatchError[] = [];
    const applicable: { item: (typeof items)[number]; row: SnapshotRow; set: Record<string, unknown> }[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const row = before.get(item.id);
      if (!row) { errors.push({ leadId: item.id, kind: "missing", message: "This lead no longer exists." }); continue; }
      if (row.is_archived) { errors.push({ leadId: item.id, kind: "archived", message: "This lead was archived and can no longer be edited.", latest: toSnapshot(row) }); continue; }
      if (Math.floor(row.updated_at.getTime()) !== Math.floor(item.expected_updated_at.getTime())) {
        errors.push({ leadId: item.id, kind: "conflict", message: "Someone else saved this lead after you opened it.", latest: toSnapshot(row) }); continue;
      }
      const patch = item.patch as Patch;
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined && patch.name !== row.name) set.name = patch.name;
      if (patch.owner_id !== undefined) {
        const effectiveOwner = row.assigned_consultant_id ?? row.owner_id;
        if (patch.owner_id !== effectiveOwner) { set.owner_id = patch.owner_id; set.assigned_consultant_id = patch.owner_id; }
      }
      if (patch.funnel_stage !== undefined && patch.funnel_stage !== row.funnel_stage) set.funnel_stage = patch.funnel_stage;
      if (patch.closure_reason !== undefined && patch.closure_reason !== row.closure_reason) set.closure_reason = patch.closure_reason;
      if (patch.last_outcome !== undefined && patch.last_outcome !== row.last_outcome) set.last_outcome = patch.last_outcome;
      if (patch.next_action_date !== undefined && patch.next_action_date !== row.next_action_date_text) set.next_action_date = patch.next_action_date;
      if (patch.move_in_date !== undefined && patch.move_in_date !== row.move_in_date_text) set.move_in_date = patch.move_in_date;
      if (patch.action_detail !== undefined && patch.action_detail !== row.action_detail) set.action_detail = patch.action_detail;
      if (patch.mobile !== undefined && patch.mobile !== row.mobile) set.mobile = patch.mobile;
      if (patch.development !== undefined && patch.development !== row.development) set.development = patch.development;
      if (patch.inbound_outbound !== undefined && patch.inbound_outbound !== row.inbound_outbound) set.inbound_outbound = patch.inbound_outbound;
      if (patch.contact_channel !== undefined && patch.contact_channel !== row.contact_channel) set.contact_channel = patch.contact_channel;
      if (patch.source !== undefined && patch.source !== row.source) set.source = patch.source;
      if (patch.primary_product !== undefined && patch.primary_product !== row.primary_product) set.primary_product = patch.primary_product;
      if (patch.keys_collected !== undefined && patch.keys_collected !== row.keys_collected) set.keys_collected = patch.keys_collected;
      if (patch.interaction_summary !== undefined && patch.interaction_summary !== row.interaction_summary) set.interaction_summary = patch.interaction_summary;
      if (patch.quotation_breakdown !== undefined && patch.quotation_breakdown !== row.quotation_breakdown) set.quotation_breakdown = patch.quotation_breakdown;
      if (patch.historical_summary !== undefined && patch.historical_summary !== row.historical_summary) set.historical_summary = patch.historical_summary;
      if (patch.latest_quote_note !== undefined && patch.latest_quote_note !== row.latest_quote_note) set.latest_quote_note = patch.latest_quote_note;
      if (patch.renovation_buying_stage !== undefined && patch.renovation_buying_stage !== row.renovation_buying_stage) set.renovation_buying_stage = patch.renovation_buying_stage;
      if (patch.engagement_quality !== undefined && patch.engagement_quality !== row.engagement_quality) set.engagement_quality = patch.engagement_quality;
      if (patch.latest_quote_sgd !== undefined) {
        const cents = patch.latest_quote_sgd === null ? null : Math.round(patch.latest_quote_sgd * 100);
        if (cents !== row.latest_quote_cents) set.latest_quote_cents = cents;
      }
      // An unchanged record is skipped outright: no timestamp or audit writes,
      // and a legacy closed record missing its reason cannot block the batch.
      if (!Object.keys(set).length) { skipped.push(item.id); continue; }
      const effectiveStage = (set.funnel_stage as string | undefined) ?? row.funnel_stage;
      const effectiveReason = patch.closure_reason !== undefined ? patch.closure_reason : row.closure_reason;
      if (TERMINAL_STAGES.has(effectiveStage) && !effectiveReason) {
        errors.push({ leadId: item.id, kind: "validation", field: "closure_reason", message: "Closure reason is required when closing a lead" }); continue;
      }
      applicable.push({ item, row, set });
    }
    if (errors.length) return { ok: false as const, errors };

    const saved: string[] = [];
    for (const { item, row, set } of applicable) {
      const patch = item.patch as Patch;
      if (set.funnel_stage !== undefined || set.move_in_date !== undefined || set.last_outcome !== undefined) {
        set.dismissed_recommendations = sql`'{}'::text[]`;
      }
      set.updated_at = new Date();
      const updated = await trx.updateTable("leads").set(set).where("id", "=", item.id)
        .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${item.expected_updated_at}`)
        .returning("id").executeTakeFirst();
      if (!updated) throw new Error("This lead changed while the batch was saving. Nothing was written — retry the batch.");
      await trx.insertInto("lead_interactions").values({
        lead_id: item.id, occurred_at: new Date(), direction: null,
        interaction_type: "Note", note: "Lead details saved", created_by: session.user.id,
      }).execute();
      if (set.funnel_stage !== undefined) {
        await trx.insertInto("lead_stage_events").values({
          lead_id: item.id, from_stage: row.funnel_stage, to_stage: patch.funnel_stage!,
          changed_at: new Date(), changed_by: session.user.id, source: "user",
        }).execute();
      }
      saved.push(item.id);
    }
    return { ok: true as const, saved, skipped };
  });
  if (!outcome.ok) return outcome;
  for (const id of outcome.saved) revalidateLead(id);
  return outcome;
}
