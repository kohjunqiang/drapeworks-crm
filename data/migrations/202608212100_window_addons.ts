import { sql, type Kysely } from "kysely";

// Phase 14 — which add-ons a window carries becomes rows, not columns. The two
// boolean columns are backfilled and dropped: leaving them would be two
// sources of truth for the same fact, which is how `blackout` sat in the admin
// screen for a phase and a half charging nobody.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("window_addons")
    .addColumn("window_id", "uuid", (c) =>
      c.notNull().references("windows.id").onDelete("cascade"),
    )
    // restrict, not cascade: add-ons are archived, never deleted, and one in
    // use must not be removable out from under a quoted order.
    .addColumn("addon_id", "uuid", (c) =>
      c.notNull().references("pricing_addons.id").onDelete("restrict"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("window_addons_pkey", ["window_id", "addon_id"])
    .execute();

  await sql`create index window_addons_addon_id_idx on public.window_addons (addon_id)`.execute(
    db,
  );

  // Affects 0 rows today. Written correctly anyway — this migration may run
  // against a database that has moved on.
  await sql`
    insert into public.window_addons (window_id, addon_id)
    select w.id, a.id from public.windows w
      join public.pricing_addons a on a.key = 's_fold'
     where w.add_s_fold
    union all
    select w.id, a.id from public.windows w
      join public.pricing_addons a on a.key = 'slim_tracks'
     where w.add_slim_tracks
  `.execute(db);

  await db.schema
    .alterTable("windows")
    .dropColumn("add_s_fold")
    .dropColumn("add_slim_tracks")
    .execute();

  // RLS mirrors the windows policies (202608181200). Per rules/data/rls.md the
  // policy is written but not relied on — the app connects as table owner, so
  // the Server Actions are the enforcement surface.
  await sql`alter table public.window_addons enable row level security`.execute(
    db,
  );
  await sql`
    create policy "window_addons_select_authenticated"
      on public.window_addons for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "window_addons_write_owner_admin"
      on public.window_addons for all to authenticated
      using (
        exists (
          select 1 from public.windows w
          join public.rooms rm on rm.id = w.room_id
          join public.orders o on o.id = rm.order_id
          where w.id = window_addons.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(o.id)
        )
      )
      with check (
        exists (
          select 1 from public.windows w
          join public.rooms rm on rm.id = w.room_id
          join public.orders o on o.id = rm.order_id
          where w.id = window_addons.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(o.id)
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("add_s_fold", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("add_slim_tracks", "boolean", (c) =>
      c.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    update public.windows w set add_s_fold = true
      from public.window_addons wa
      join public.pricing_addons a on a.id = wa.addon_id
     where wa.window_id = w.id and a.key = 's_fold'
  `.execute(db);
  await sql`
    update public.windows w set add_slim_tracks = true
      from public.window_addons wa
      join public.pricing_addons a on a.id = wa.addon_id
     where wa.window_id = w.id and a.key = 'slim_tracks'
  `.execute(db);

  await db.schema.dropTable("window_addons").execute();
}
