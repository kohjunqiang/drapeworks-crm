import { z } from "zod";
import { CLOSURE_REASONS, CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_DIRECTIONS, LEAD_OUTCOMES, LEAD_SOURCES, PRIMARY_PRODUCTS } from "@/lib/leads/funnel-types";
import { BUYING_STAGES, ENGAGEMENT_QUALITIES } from "@/lib/leads/priority";
import { canonicalizePhone } from "@/lib/phone";

// PATCH semantics: a field key present in the patch is applied ("" means clear
// to null for nullable fields); absent keys are left untouched.
const nullableText = (max: number) => z.preprocess(
  value => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(max).nullable(),
);
const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(
  value => value === "" ? null : value,
  z.enum(values).nullable(),
);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid date");
const nullableDate = z.preprocess(value => value === "" ? null : value, calendarDate.nullable());
const nullableBool = z.preprocess(
  value => value === "true" ? true : value === "false" ? false : value === "" ? null : value,
  z.boolean().nullable(),
);
const nullableQuote = z.preprocess(
  value => typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().min(0).max(1_000_000).nullable(),
);
// Same relaxed contract as the other lead paths: "" clears to null, a readable
// number canonicalises to E.164, anything else is stored verbatim.
const nullableMobile = z.preprocess(
  value => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(2000).transform(v => canonicalizePhone(v) ?? v).nullable(),
);

// Allowlisted manually editable fields only — strict, so calculated columns
// (lead_status, priority scores, timestamps) sent by a forged client are
// rejected instead of silently ignored.
export const leadBatchPatchSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(200).optional(),
  owner_id: z.string().uuid("Select an owner").optional(),
  funnel_stage: z.enum(FUNNEL_STAGES).optional(),
  closure_reason: nullableEnum(CLOSURE_REASONS).optional(),
  last_outcome: nullableEnum(LEAD_OUTCOMES).optional(),
  next_action_date: nullableDate.optional(),
  move_in_date: nullableDate.optional(),
  action_detail: nullableText(2000).optional(),
  mobile: nullableMobile.optional(),
  development: nullableText(2000).optional(),
  inbound_outbound: nullableEnum(LEAD_DIRECTIONS).optional(),
  contact_channel: z.enum(CONTACT_CHANNELS).optional(),
  source: nullableEnum(LEAD_SOURCES).optional(),
  primary_product: nullableEnum(PRIMARY_PRODUCTS).optional(),
  keys_collected: nullableBool.optional(),
  interaction_summary: nullableText(2000).optional(),
  quotation_breakdown: nullableText(20000).optional(),
  historical_summary: nullableText(20000).optional(),
  latest_quote_note: nullableText(2000).optional(),
  renovation_buying_stage: nullableEnum(BUYING_STAGES).optional(),
  engagement_quality: nullableEnum(ENGAGEMENT_QUALITIES).optional(),
  latest_quote_sgd: nullableQuote.optional(),
}).strict();

export const leadBatchSaveSchema = z.object({
  leads: z.array(z.object({
    id: z.string().uuid(),
    expected_updated_at: z.coerce.date(),
    patch: leadBatchPatchSchema,
  }).strict()).min(1).max(50)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate lead in batch"),
}).strict();

export const leadBatchFetchSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(50),
}).strict();
