import { sql, type Kysely } from "kysely";

// The 收货地址 becomes a record you can have more than one of.
//
// It was four columns on procurement_settings — one shipping mark, one
// warehouse address, one recipient, one phone — which said the business has
// exactly one place goods are delivered to, forever. It has one TODAY. The
// four columns are kept (nothing is hard-deleted here) but nothing reads them
// after this migration; the seeded row below carries their values forward.
//
// `label` is ours, for the admin screen — "which of these is this?" — and is
// deliberately NOT printed on the document. The samples print the mark, the
// address, the recipient and the phone, and nothing else; adding a company name
// to a Chinese delivery block would be content we invented.
//
// One row is the default. Every PO uses it. When a second address appears, an
// order will need a way to say which one it ships to — that is a separate piece
// of work, and until it exists a second row changes nothing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("delivery_vendors")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // What we call it. Not on the document.
    .addColumn("label", "text", (c) => c.notNull())
    // 空运唛头 — an AIR shipping mark; the mark itself ends in 空.
    .addColumn("shipping_mark_cn", "text")
    .addColumn("address_cn", "text")
    .addColumn("recipient_cn", "text")
    .addColumn("phone", "text")
    .addColumn("is_default", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // At most one default, enforced by the database rather than by the code that
  // happens to be setting it. Two defaults is not a state anything downstream
  // knows how to resolve: buildPos would have to pick one, and picking is
  // exactly what a default is supposed to have already decided.
  await sql`
    create unique index delivery_vendors_one_default
      on public.delivery_vendors (is_default)
      where is_default
  `.execute(db);

  await sql`
    create trigger delivery_vendors_set_updated_at
      before update on public.delivery_vendors
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Carry the one address the business has across, verbatim. Labelled
  // "Default", which is a description of its role and not a name anybody
  // invented for the warehouse — the admin renames it to whatever they call it.
  await sql`
    insert into public.delivery_vendors
      (label, shipping_mark_cn, address_cn, recipient_cn, phone, is_default)
    select
      'Default',
      air_shipping_mark,
      warehouse_address_cn,
      recipient_cn,
      delivery_phone,
      true
    from public.procurement_settings
    where singleton = true
  `.execute(db);

  // Same posture as every other table here: policies are written, and the
  // Server Action's requireRole is what actually enforces access. See
  // rules/data/rls.md.
  await sql`alter table public.delivery_vendors enable row level security`.execute(db);
  await sql`
    create policy "delivery_vendors_select_authenticated"
      on public.delivery_vendors for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "delivery_vendors_write_admin"
      on public.delivery_vendors for all to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("delivery_vendors").execute();
}
