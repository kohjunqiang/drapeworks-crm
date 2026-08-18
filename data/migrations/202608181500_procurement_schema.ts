import { sql, type Kysely } from "kysely";

// Phase 13C — everything the Chinese purchase order (采购订单) needs that the
// CRM does not already hold.
//
// The guiding decision for the whole phase: the PO's letterhead, its delivery
// block, its vendor contact lines and its Chinese room names are all modelled
// as DATA THE BUSINESS FILLS IN, never as constants compiled into the renderer.
// These strings end up on a cutting table in Shenzhen. When one of them is
// wrong — a warehouse moves, a shipping mark changes, a room name reads badly
// to the factory — the fix has to be a form field, not a deploy. This is the
// same reasoning as the existing "catalogue labels are stored verbatim" rule,
// applied one layer further out.
//
// Nothing here is seeded. 202608181700_seed_procurement.ts loads only the
// values the three sample PDFs in resource/documents/ actually evidence.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── vendors: the lines the PO prints under 供应商 Vendor ─────────────────
  //
  // All four are nullable and none of them block generation. A vendor missing
  // its internal ref or phone simply prints fewer lines — these are contact
  // details, not manufacturing instructions, and refusing to produce a document
  // over a missing phone number would stop production for no safety gain.
  //
  // name_cn is SEPARATE from name rather than replacing it because the ShunJin
  // sample prints both lines, stacked:
  //
  //     顺金纺织窗材有限公司
  //     ShunJin Textile Pte Ltd
  //
  // …while the Rising and ZhuYingTai samples print the Latin name alone. One
  // column cannot express "print both"; two columns with a nullable Chinese one
  // reproduce all three samples exactly, and a null name_cn degrades to the
  // Latin-only layout the other two use.
  //
  // internal_ref (V005 / V006 / V007 on the samples) is the vendor's id in the
  // business's own numbering, printed as "Internal Ref: V006". It is
  // deliberately not `vendors.code` — code is ours to slug and index on, this
  // is a string the factory reads back to us.
  await db.schema
    .alterTable("vendors")
    .addColumn("internal_ref", "text")
    .addColumn("name_cn", "text")
    .addColumn("address_cn", "text")
    .addColumn("phone", "text")
    .execute();

  // ── procurement_settings ────────────────────────────────────────────────
  //
  // One row, guarded by the same `singleton boolean primary key check
  // (singleton)` trick pricing_assumptions uses: the primary key admits only
  // `true`, and the check constraint rejects `false`, so the table can hold at
  // most one row and no code has to remember which id to read.
  //
  // These are company facts, identical on all three samples, and they change on
  // a timescale of years — a letterhead, a Shenzhen consolidation warehouse, a
  // WeChat number. Per-order they would be noise; hardcoded they would be a
  // deploy.
  await db.schema
    .createTable("procurement_settings")
    .addColumn("singleton", "boolean", (c) =>
      c.primaryKey().defaultTo(true).check(sql`singleton`),
    )
    // Letterhead — top-left block, identical on all three samples.
    .addColumn("company_name", "text", (c) => c.notNull())
    .addColumn("company_uen", "text", (c) => c.notNull())
    .addColumn("address_line1", "text", (c) => c.notNull())
    .addColumn("address_line2", "text", (c) => c.notNull())
    .addColumn("phone", "text", (c) => c.notNull()) // 电话
    .addColumn("wechat", "text", (c) => c.notNull()) // 微信 — how the vendors are actually reached
    .addColumn("website", "text", (c) => c.notNull()) // 网站
    // 收货地址 Delivery Address block.
    //
    // Nullable, unlike the letterhead, because this block is freight-mode
    // dependent and only the AIR variant is evidenced. 空运唛头 is literally
    // "air shipping mark" and the mark itself ends in 空 (air); orders.freight_mode
    // is already `air | sea`, and what a sea order prints instead is an open
    // question in the spec (§8.3). A null here means "we do not know yet", which
    // is a truthful state; a not-null default would have forced us to invent one.
    .addColumn("air_shipping_mark", "text")
    .addColumn("warehouse_address_cn", "text") // 仓库地址
    .addColumn("recipient_cn", "text") // 收件人
    .addColumn("delivery_phone", "text") // 电话 (of the warehouse, not of us)
    // 订单资料 Order Details — curtain-only. Every one of these four labels is
    // printed but left BLANK on the Blinds sample, which is how we know they do
    // not apply to blinds. Nullable for the same reason: the samples print the
    // 窗帘离地 (floor clearance) label and its 厘米 CM unit with no number in it.
    //
    // The fourth of that block, 窗帘褶皱 (fullness, "2 倍"), is deliberately
    // absent here — it is already pricing_assumptions.style_multiplier and
    // duplicating it would let the quote and the factory instruction disagree.
    .addColumn("curtain_style_cn", "text") // 窗帘款式
    .addColumn("heat_setting_cn", "text") // 定型
    .addColumn("floor_clearance_cm", "integer") // 窗帘离地
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── room_type_labels ────────────────────────────────────────────────────
  //
  // The PO's first column is a Chinese room name AND a Latin code — `客厅 LR`,
  // `主卧 MB`. room_type is an English enum carrying neither.
  //
  // A lookup table rather than a map in TypeScript, for one reason: these are
  // factory-facing strings, and only five of them are evidenced by the samples.
  // The rest have to come from a Chinese-speaking human at the business. A
  // hardcoded map would make that human's contribution a pull request; a table
  // makes it a form. It also means the wrong term can be corrected the same
  // afternoon somebody at the factory queries it.
  //
  // Keyed on the enum itself, so a room type that does not exist cannot be
  // labelled, and — more usefully — a room type with NO row is detectable.
  // That absence is load-bearing: generation refuses, naming the unlabelled
  // room type, rather than printing an English word onto a Chinese cutting
  // instruction. See the seed migration, which populates only four rows.
  await db.schema
    .createTable("room_type_labels")
    .addColumn("room_type", sql`public.room_type`, (c) => c.primaryKey())
    .addColumn("name_cn", "text", (c) => c.notNull()) // 客厅
    .addColumn("code", "text", (c) => c.notNull()) // LR
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── manufacture_pos ─────────────────────────────────────────────────────
  //
  // One row per generated document: one per vendor per order, because the split
  // is by vendor (curtain_series.vendor_id already groups this way) — an order
  // whose day and night curtains share a vendor is ONE document, which is what
  // that vendor wants.
  //
  // po_number is a SNAPSHOT of orders.order_reference rather than a join to it.
  // order_reference stays editable after the order locks — deliberately, per
  // Phase 13A — and a PDF that has already been sent to Shenzhen cannot be
  // retroactively renamed by somebody tidying up a reference in the CRM. The
  // document must keep saying what it said when it was sent, and the row that
  // points at it must agree with the document. Same reasoning as
  // manufacture_measurements.source_width_cm: a record of what we told a vendor
  // has to stay truthful on its own terms.
  //
  // vendor_id is nullable and not cascading. A vendor is never hard-deleted in
  // this system, but if a PO row ever outlives its vendor pointer the DOCUMENT
  // is still the artefact of record and stays downloadable.
  await db.schema
    .createTable("manufacture_pos")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (c) =>
      c.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("vendor_id", "uuid", (c) => c.references("vendors.id"))
    .addColumn("po_number", "text", (c) => c.notNull())
    .addColumn("storage_path", "text", (c) => c.notNull())
    // The Night sample carries a free-text row in the table — 都要绑带, "all
    // need tie-backs". Per-document, not per-order: it is an instruction to one
    // vendor about their own work.
    .addColumn("notes", "text")
    // Set when an amendment regenerates. See the RLS note below.
    .addColumn("superseded_at", "timestamptz")
    .addColumn("generated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("generated_by", "uuid", (c) => c.references("profiles.id"))
    .execute();

  // Every read is "the POs for this order".
  await sql`
    create index manufacture_pos_order_idx on public.manufacture_pos (order_id)
  `.execute(db);

  await sql`
    create trigger procurement_settings_set_updated_at
      before update on public.procurement_settings
      for each row execute function public.set_updated_at()
  `.execute(db);
  await sql`
    create trigger room_type_labels_set_updated_at
      before update on public.room_type_labels
      for each row execute function public.set_updated_at()
  `.execute(db);

  // ── RLS ─────────────────────────────────────────────────────────────────
  //
  // NO DELETE POLICY ON ANY OF THESE THREE TABLES, and that is the point rather
  // than an omission.
  //
  // For manufacture_pos it is the no-hard-deletes rule applied to the thing a
  // factory is working from: when an amendment regenerates a document we set
  // superseded_at and write a NEW row. The old PDF stays retrievable because a
  // vendor may already be cutting fabric from it, and "what did we actually
  // send them, and when" is the only way to settle a dispute about a wrong
  // dimension. Deleting the superseded row would destroy exactly the evidence
  // that matters. superseded_at rather than an is_active flag because the
  // question asked afterwards is always *when* it stopped being current.
  //
  // For procurement_settings a delete would leave the letterhead unreadable and
  // block every future generation; the singleton is edited, never removed. For
  // room_type_labels a delete would silently start blocking generation for one
  // room type — corrections are updates.
  for (const table of [
    "procurement_settings",
    "room_type_labels",
    "manufacture_pos",
  ]) {
    await sql`alter table ${sql.raw(`public.${table}`)} enable row level security`.execute(
      db,
    );
    await sql`
      create policy ${sql.raw(`"${table}_select_authenticated"`)}
        on ${sql.raw(`public.${table}`)} for select to authenticated using (true)
    `.execute(db);
  }

  // Settings and labels are company-wide configuration: admin only, mirroring
  // pricing_assumptions.
  for (const table of ["procurement_settings", "room_type_labels"]) {
    await sql`
      create policy ${sql.raw(`"${table}_insert_admin"`)}
        on ${sql.raw(`public.${table}`)} for insert to authenticated
        with check (public.is_admin())
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_update_admin"`)}
        on ${sql.raw(`public.${table}`)} for update to authenticated
        using (public.is_admin()) with check (public.is_admin())
    `.execute(db);
  }

  // manufacture_pos is written by whoever runs the order: ops confirm the
  // measurements and generate the documents; admin can regenerate after an
  // amendment. Update is the same set because marking a row superseded is part
  // of regenerating it.
  await sql`
    create policy "manufacture_pos_insert_ops_admin"
      on public.manufacture_pos for insert to authenticated
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "manufacture_pos_update_ops_admin"
      on public.manufacture_pos for update to authenticated
      using (public.is_ops() or public.is_admin())
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Dropping each table takes its triggers, indexes and policies with it.
  await db.schema.dropTable("manufacture_pos").execute();
  await db.schema.dropTable("room_type_labels").execute();
  await db.schema.dropTable("procurement_settings").execute();

  await db.schema
    .alterTable("vendors")
    .dropColumn("internal_ref")
    .dropColumn("name_cn")
    .dropColumn("address_cn")
    .dropColumn("phone")
    .execute();
}
