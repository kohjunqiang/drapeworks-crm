import { sql, type Kysely } from "kysely";

// Phase 15 — the leads spreadsheet becomes a table. The eight formula columns
// (Action Required, Next Action, Effective Action Date, Due Status, Contact
// Priority, Queue Visibility, and the two Queue Seq columns) are deliberately
// NOT stored: every one of them depends on TODAY(), so a stored copy is stale
// the moment the clock rolls over. They are derived in src/lib/leads/queue-engine.ts.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type lead_source as enum ('telegram', 'whatsapp', 'manual')
  `.execute(db);

  await sql`
    create type lead_initiator as enum ('Customer', 'Us')
  `.execute(db);

  // Verbatim from the Lists sheet. Ugly overlaps (Won/Lost live here AND in
  // lead_status) are intentional — porting them faithfully is what lets the
  // import be diffed against the spreadsheet. Redesign is a later phase.
  await sql`
    create type lead_funnel_stage as enum (
      'New Lead',
      'Not Qualified',
      'Qualified / Pre-Appointment',
      'Appointment Booked',
      'Post-Appointment / Quote Pending',
      'Quote Sent',
      'Decision Pending',
      'Nurture',
      'Won',
      'Lost'
    )
  `.execute(db);

  await sql`
    create type lead_status as enum (
      'Active', 'Nurture', 'Ignore', 'Unresponsive', 'Won', 'Lost'
    )
  `.execute(db);

  // The last three are used by the data but absent from the Lists sheet.
  // 'Appointment Confirmed' drives branch 3 of the action cascade and
  // 'Follow-Up Sent' covers 63 rows — dropping them would fail the import.
  await sql`
    create type lead_outcome as enum (
      'Customer Replied',
      'No Response',
      'Ready to Book Appointment',
      'Barrier / Objection Raised',
      'Appointment Booked',
      'Appointment Completed',
      'Quote Requested',
      'Quote Sent',
      'Customer Needs Time',
      'Customer Declined',
      'Order Confirmed',
      'Appointment Confirmed',
      'Follow-Up Sent',
      'Renovation Delayed'
    )
  `.execute(db);

  await db.schema
    .createTable("leads")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Unique, but NOT the sheet's Lead ID: ten rows there carry a bare 'TG',
    // 'WA' or 'WA-SEM' with no identifier, so the raw value collides. The
    // import synthesises 'TG-row233' for those and keeps the original below.
    .addColumn("lead_ref", "text", (c) => c.notNull().unique())
    // The sheet's Lead ID verbatim. Deliberately not unique — it is the join
    // key back to the spreadsheet during the port, not an identity.
    .addColumn("source_ref", "text")
    .addColumn("source", sql`lead_source`, (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("mobile", "text")
    .addColumn("development", "text")
    .addColumn("initiator", sql`lead_initiator`)
    .addColumn("funnel_stage", sql`lead_funnel_stage`, (c) =>
      c.notNull().defaultTo("New Lead"),
    )
    .addColumn("lead_status", sql`lead_status`, (c) =>
      c.notNull().defaultTo("Active"),
    )
    .addColumn("last_outcome", sql`lead_outcome`)
    .addColumn("action_detail_override", "text")
    .addColumn("action_date", "date")
    .addColumn("first_initiated_at", "timestamptz")
    .addColumn("last_contact_at", "timestamptz")
    // Drives the 90-day stale exclusion. Nullable: 146 leads have never replied.
    .addColumn("last_customer_response_at", "timestamptz")
    .addColumn("interaction_summary", "text")
    .addColumn("historical_summary", "text")
    // Integer cents, per rules/code/typescript.md. Never numeric(_,2).
    .addColumn("latest_quote_cents", "integer")
    // Two sheet rows hold negotiation text where a number belongs ('780 -->
    // 660 after 15%'). The text goes here verbatim and the cents column stays
    // null — guessing which number is current would put a wrong figure in the
    // pipeline total, and writing it into interaction_summary would mean the
    // import inventing content in a hand-typed column.
    .addColumn("latest_quote_note", "text")
    // Free text on purpose: the sheet holds 'Mid-Sep', 'Early Jan 2027', 'ASAP'.
    // Coercing those to dates would be inventing data.
    .addColumn("buying_readiness", "text")
    .addColumn("keys_status", "text")
    .addColumn("expected_key_date", "text")
    .addColumn("owner_id", "uuid", (c) => c.references("profiles.id"))
    .addColumn("telegram_chat_id", "text")
    // Null until an appointment is booked — that is where a lead becomes a
    // customer. 146 of 244 leads have no mobile; they are conversations.
    .addColumn("customer_id", "uuid", (c) =>
      c.references("customers.id").onDelete("restrict"),
    )
    .addColumn("is_archived", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`create index leads_source_ref_idx on public.leads (source_ref)`.execute(
    db,
  );
  await sql`create index leads_funnel_stage_idx on public.leads (funnel_stage)`.execute(
    db,
  );
  await sql`create index leads_lead_status_idx on public.leads (lead_status)`.execute(
    db,
  );
  await sql`create index leads_owner_id_idx on public.leads (owner_id)`.execute(
    db,
  );
  await sql`create index leads_customer_id_idx on public.leads (customer_id)`.execute(
    db,
  );

  // Per rules/data/rls.md: the policy is written but not relied on. The app
  // connects as table owner and bypasses RLS entirely, so the Server Actions
  // in src/lib/actions/leads.ts are the real enforcement surface.
  await sql`alter table public.leads enable row level security`.execute(db);
  await sql`
    create policy "leads_select_authenticated"
      on public.leads for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "leads_write_authenticated"
      on public.leads for all to authenticated using (true) with check (true)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("leads").execute();
  await sql`drop type lead_outcome`.execute(db);
  await sql`drop type lead_status`.execute(db);
  await sql`drop type lead_funnel_stage`.execute(db);
  await sql`drop type lead_initiator`.execute(db);
  await sql`drop type lead_source`.execute(db);
}
