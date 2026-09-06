import { sql, type Kysely } from "kysely";

const BUCKET = "customer-quotations";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.quotation_status as enum ('local_draft','syncing','zoho_draft','sending','sent','superseded','sync_failed','conflict')`.execute(db);

  await db.schema.createTable("customer_zoho_links")
    .addColumn("customer_id", "uuid", (column) => column.primaryKey().references("customers.id").onDelete("cascade"))
    .addColumn("zoho_contact_id", "text", (column) => column.notNull().unique())
    .addColumn("confirmed_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("restrict"))
    .addColumn("confirmed_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("customer_zoho_links_confirmed_by_idx").on("customer_zoho_links").column("confirmed_by").execute();

  await db.schema.createTable("order_quotations")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("order_id", "uuid", (column) => column.notNull().references("orders.id").onDelete("cascade"))
    .addColumn("revision", "integer", (column) => column.notNull())
    .addColumn("crm_quote_key", "text", (column) => column.notNull().unique())
    .addColumn("status", sql`public.quotation_status`, (column) => column.notNull().defaultTo(sql`'local_draft'::public.quotation_status`))
    .addColumn("issue_date", "date", (column) => column.notNull())
    .addColumn("expiry_date", "date", (column) => column.notNull())
    .addColumn("lines", "jsonb", (column) => column.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("quoted_total_cents", "integer", (column) => column.notNull())
    .addColumn("customer_message", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("notes", "text")
    .addColumn("terms", "text")
    .addColumn("zoho_contact_id", "text")
    .addColumn("zoho_estimate_id", "text", (column) => column.unique())
    .addColumn("zoho_estimate_number", "text")
    .addColumn("zoho_status", "text")
    .addColumn("zoho_last_modified_time", "text")
    .addColumn("synced_payload_hash", "text")
    .addColumn("pdf_storage_path", "text")
    .addColumn("pdf_sha256", "text")
    .addColumn("synced_at", "timestamptz")
    .addColumn("sync_error", "text")
    .addColumn("sync_claim_token", "uuid")
    .addColumn("sync_claimed_at", "timestamptz")
    .addColumn("zoho_invoice_id", "text", (column) => column.unique())
    .addColumn("zoho_invoice_number", "text")
    .addColumn("invoice_created_at", "timestamptz")
    .addColumn("invoice_sync_state", "text", (column) => column.notNull().defaultTo("not_started"))
    .addColumn("invoice_sync_error", "text")
    .addColumn("invoice_claimed_at", "timestamptz")
    .addColumn("invoice_claim_token", "uuid")
    .addColumn("sent_at", "timestamptz")
    .addColumn("sent_by", "uuid", (column) => column.references("profiles.id").onDelete("restrict"))
    .addColumn("sent_channel", "text")
    .addColumn("sent_note", "text")
    .addColumn("superseded_at", "timestamptz")
    .addColumn("superseded_by", "uuid", (column) => column.references("profiles.id").onDelete("restrict"))
    .addColumn("created_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("restrict"))
    .addColumn("updated_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("restrict"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("order_quotations_order_revision_unique", ["order_id", "revision"])
    .addCheckConstraint("order_quotations_revision_positive", sql`revision > 0`)
    .addCheckConstraint("order_quotations_total_nonnegative", sql`quoted_total_cents >= 0`)
    .addCheckConstraint("order_quotations_dates_ordered", sql`expiry_date >= issue_date`)
    .addCheckConstraint("order_quotations_lines_array", sql`jsonb_typeof(lines) = 'array'`)
    .addCheckConstraint("order_quotations_invoice_sync_state", sql`invoice_sync_state in ('not_started','pending','created','failed')`)
    .addCheckConstraint("order_quotations_active_claim_consistent", sql`(status in ('syncing','sending') and sync_claim_token is not null and sync_claimed_at is not null) or (status not in ('syncing','sending') and sync_claim_token is null and sync_claimed_at is null)`)
    .addCheckConstraint("order_quotations_invoice_claim_consistent", sql`(invoice_sync_state = 'pending') = (invoice_claim_token is not null and invoice_claimed_at is not null)`)
    .addCheckConstraint("order_quotations_sent_complete", sql`status <> 'sent' or (sent_at is not null and sent_by is not null and sent_channel is not null and zoho_estimate_id is not null and pdf_storage_path is not null and pdf_sha256 is not null)`)
    .addCheckConstraint("order_quotations_superseded_complete", sql`status <> 'superseded' or (superseded_at is not null and superseded_by is not null)`)
    .addCheckConstraint("order_quotations_invoice_complete", sql`invoice_sync_state <> 'created' or (zoho_invoice_id is not null and invoice_created_at is not null)`)
    .execute();

  for (const column of ["order_id", "sent_by", "superseded_by", "created_by", "updated_by"] as const) {
    await db.schema.createIndex(`order_quotations_${column}_idx`).on("order_quotations").column(column).execute();
  }
  await sql`create unique index order_quotations_one_current_per_order on public.order_quotations(order_id) where superseded_at is null`.execute(db);
  await sql`create index order_quotations_active_status_idx on public.order_quotations(status, updated_at desc) where superseded_at is null`.execute(db);

  await sql`create trigger customer_zoho_links_set_updated_at before update on public.customer_zoho_links for each row execute function public.set_updated_at()`.execute(db);
  await sql`create trigger order_quotations_set_updated_at before update on public.order_quotations for each row execute function public.set_updated_at()`.execute(db);

  await sql`alter table public.customer_zoho_links enable row level security`.execute(db);
  await sql`create policy "customer_zoho_links_select_authenticated" on public.customer_zoho_links for select to authenticated using (true)`.execute(db);

  await sql`alter table public.order_quotations enable row level security`.execute(db);
  await sql`create policy "order_quotations_select_authenticated" on public.order_quotations for select to authenticated using (true)`.execute(db);
  // Writes must pass through the server actions, which protect remote IDs,
  // hashes and audit fields. Never grant browser roles direct mutation rights.
  await sql`revoke insert, update, delete on public.customer_zoho_links, public.order_quotations from anon, authenticated`.execute(db);

  await sql`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${BUCKET}, ${BUCKET}, false, ${10 * 1024 * 1024}, array['application/pdf']) on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from storage.objects where bucket_id = ${BUCKET}`.execute(db);
  await sql`delete from storage.buckets where id = ${BUCKET}`.execute(db);
  await db.schema.dropTable("order_quotations").execute();
  await db.schema.dropTable("customer_zoho_links").execute();
  await sql`drop type public.quotation_status`.execute(db);
}
