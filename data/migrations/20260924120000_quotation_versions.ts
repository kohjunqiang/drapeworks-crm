import { sql, type Kysely } from "kysely";

// A quotation stays editable until the deposit, and edits update the same Zoho
// estimate in place. This append-only table keeps each version the customer
// received so the history survives in-place edits.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("order_quotation_versions")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("quotation_id", "uuid", (column) => column.notNull().references("order_quotations.id").onDelete("cascade"))
    .addColumn("version", "integer", (column) => column.notNull())
    .addColumn("lines", "jsonb", (column) => column.notNull())
    .addColumn("quoted_total_cents", "bigint", (column) => column.notNull())
    .addColumn("pdf_storage_path", "text", (column) => column.notNull())
    .addColumn("created_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("restrict"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("order_quotation_versions_quotation_version_unique", ["quotation_id", "version"])
    .addCheckConstraint("order_quotation_versions_version_positive", sql`version > 0`)
    .addCheckConstraint("order_quotation_versions_lines_array", sql`jsonb_typeof(lines) = 'array'`)
    .addCheckConstraint("order_quotation_versions_total_nonnegative", sql`quoted_total_cents >= 0`)
    .execute();
  await db.schema.createIndex("order_quotation_versions_created_by_idx").on("order_quotation_versions").column("created_by").execute();

  await sql`alter table public.order_quotation_versions enable row level security`.execute(db);
  await sql`create policy "order_quotation_versions_select_authenticated" on public.order_quotation_versions for select to authenticated using (true)`.execute(db);
  await sql`revoke insert, update, delete on public.order_quotation_versions from anon, authenticated`.execute(db);

  // Version 1 for every quotation already sent, from what the customer got.
  await sql`
    insert into public.order_quotation_versions (quotation_id, version, lines, quoted_total_cents, pdf_storage_path, created_by, created_at)
    select id, 1, lines, quoted_total_cents, pdf_storage_path, sent_by, sent_at
    from public.order_quotations
    where status = 'sent'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("order_quotation_versions").execute();
}
