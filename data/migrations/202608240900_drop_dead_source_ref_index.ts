import { sql, type Kysely } from "kysely";

/**
 * Drops `leads_source_ref_idx`.
 *
 * `source_ref` holds the spreadsheet's Lead ID verbatim and nothing reads it:
 * search, the lead detail header and the calendar event description all use
 * `lead_ref`. It was indexed on the assumption that it would become the
 * customer-facing identity, and it cannot be — 12 of the 244 imported rows
 * carry a bare 'TG', 'WA' or 'WA-SEM' rather than an id, which is why those
 * rows got a synthetic `lead_ref` in the first place. Eight leads all labelled
 * 'TG' is worse than eight labelled 'TG-row233'.
 *
 * The column stays. Once the spreadsheet is deleted it is the only surviving
 * record of what the sheet said, and the divergence between the two columns is
 * the audit trail for those 12 renames. It is provenance, not a lookup key.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists public.leads_source_ref_idx`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`create index leads_source_ref_idx on public.leads (source_ref)`.execute(
    db,
  );
}
