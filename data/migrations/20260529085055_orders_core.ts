import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.property_type as enum ('HDB', 'Condo', 'Landed', 'Commercial')`.execute(db);
  await sql`
    create type public.room_type as enum (
      'Living Room', 'Master Bedroom', 'Bedroom',
      'Master Toilet', 'Common Toilet',
      'Kitchen', 'Study Room', 'Balcony', 'Other'
    )
  `.execute(db);
  await sql`create type public.draw_direction as enum ('Double', 'Single Left', 'Single Right')`.execute(db);
  await sql`
    create type public.fulfilment_status as enum (
      'order_made', 'sent_logistic', 'shipping_sg',
      'delivered_checked', 'fulfilment', 'completed'
    )
  `.execute(db);

  // customers
  await db.schema
    .createTable("customers")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("mobile", "text", (col) => col.notNull())
    .addColumn("email", "text")
    .addColumn("created_by", "uuid")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create trigger customers_set_updated_at
      before update on public.customers
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("customers_mobile_idx")
    .on("customers")
    .column("mobile")
    .execute();

  await sql`create index customers_name_lower_idx on public.customers (lower(name))`.execute(db);

  // per-year order counter
  await db.schema
    .createTable("order_year_counters")
    .addColumn("year", "integer", (col) => col.primaryKey())
    .addColumn("last_seq", "integer", (col) => col.notNull().defaultTo(0))
    .execute();

  // orders
  await db.schema
    .createTable("orders")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("display_id", "text", (col) => col.notNull().unique())
    .addColumn("seq_year", "integer", (col) => col.notNull())
    .addColumn("seq_num", "integer", (col) => col.notNull())
    .addColumn("customer_id", "uuid", (col) =>
      col.notNull().references("customers.id").onDelete("restrict"),
    )
    .addColumn("consultant_id", "uuid")
    .addColumn("property_type", sql`public.property_type`)
    .addColumn("development", "text")
    .addColumn("unit_type", "text")
    .addColumn("move_in_date", "date")
    .addColumn("price_quoted_cents", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("deposit_cents", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn(
      "balance_cents",
      "integer",
      (col) =>
        col.generatedAlwaysAs(
          sql`greatest(price_quoted_cents - deposit_cents, 0)`,
        ).stored(),
    )
    .addColumn("current_status", sql`public.fulfilment_status`, (col) =>
      col.notNull().defaultTo(sql`'order_made'::public.fulfilment_status`),
    )
    .addColumn("general_notes", "text")
    .addColumn("is_draft", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create trigger orders_set_updated_at
      before update on public.orders
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("orders_current_status_idx")
    .on("orders")
    .column("current_status")
    .execute();
  await db.schema
    .createIndex("orders_consultant_idx")
    .on("orders")
    .column("consultant_id")
    .execute();
  await db.schema
    .createIndex("orders_move_in_idx")
    .on("orders")
    .column("move_in_date")
    .execute();
  await sql`create index orders_created_at_idx on public.orders (created_at desc)`.execute(db);

  await sql`
    create or replace function public.assign_order_display_id() returns trigger
    language plpgsql as $$
    declare
      v_year int := extract(year from now())::int;
      v_seq int;
    begin
      insert into public.order_year_counters (year, last_seq) values (v_year, 0)
        on conflict (year) do nothing;
      update public.order_year_counters
        set last_seq = last_seq + 1
        where year = v_year
        returning last_seq into v_seq;
      new.seq_year := v_year;
      new.seq_num := v_seq;
      new.display_id := 'DW-' || v_year || '-' || lpad(v_seq::text, 4, '0');
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger orders_assign_display_id
      before insert on public.orders
      for each row execute function public.assign_order_display_id()
  `.execute(db);

  // rooms
  await db.schema
    .createTable("rooms")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (col) =>
      col.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("type", sql`public.room_type`, (col) => col.notNull())
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("rooms_order_idx")
    .on("rooms")
    .columns(["order_id", "position"])
    .execute();

  // windows
  await db.schema
    .createTable("windows")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("room_id", "uuid", (col) =>
      col.notNull().references("rooms.id").onDelete("cascade"),
    )
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("width_cm", "integer")
    .addColumn("height_cm", "integer")
    .addColumn("install_width_cm", "integer")
    .addColumn("notes", "text")
    .addColumn("curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("day_curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("night_curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("draw", sql`public.draw_direction`)
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("windows_room_idx")
    .on("windows")
    .columns(["room_id", "position"])
    .execute();

  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.day_curtain_code is not null or new.night_curtain_code is not null or new.draw is not null then
          raise exception 'toilet windows must not have day_curtain_code/night_curtain_code/draw';
        end if;
      else
        if new.curtain_code is not null then
          raise exception 'non-toilet windows must not have curtain_code (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger windows_validate_shape
      before insert or update on public.windows
      for each row execute function public.validate_window_shape()
  `.execute(db);

  // order_status_events
  await db.schema
    .createTable("order_status_events")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (col) =>
      col.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("status", sql`public.fulfilment_status`, (col) => col.notNull())
    .addColumn("note", "text")
    .addColumn("created_by", "uuid")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create index order_status_events_order_idx
      on public.order_status_events (order_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function public.sync_order_current_status() returns trigger
    language plpgsql as $$
    begin
      update public.orders
        set current_status = new.status, updated_at = now()
        where id = new.order_id;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger order_status_events_sync
      after insert on public.order_status_events
      for each row execute function public.sync_order_current_status()
  `.execute(db);

  // Enable RLS (no policies — Kysely as postgres bypasses).
  await sql`alter table public.customers enable row level security`.execute(db);
  await sql`alter table public.orders enable row level security`.execute(db);
  await sql`alter table public.rooms enable row level security`.execute(db);
  await sql`alter table public.windows enable row level security`.execute(db);
  await sql`alter table public.order_status_events enable row level security`.execute(db);
  await sql`alter table public.order_year_counters enable row level security`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists order_status_events_sync on public.order_status_events`.execute(db);
  await sql`drop function if exists public.sync_order_current_status()`.execute(db);
  await db.schema.dropTable("order_status_events").ifExists().execute();

  await sql`drop trigger if exists windows_validate_shape on public.windows`.execute(db);
  await sql`drop function if exists public.validate_window_shape()`.execute(db);
  await db.schema.dropTable("windows").ifExists().execute();

  await db.schema.dropTable("rooms").ifExists().execute();

  await sql`drop trigger if exists orders_assign_display_id on public.orders`.execute(db);
  await sql`drop function if exists public.assign_order_display_id()`.execute(db);
  await sql`drop trigger if exists orders_set_updated_at on public.orders`.execute(db);
  await db.schema.dropTable("orders").ifExists().execute();
  await db.schema.dropTable("order_year_counters").ifExists().execute();

  await sql`drop trigger if exists customers_set_updated_at on public.customers`.execute(db);
  await db.schema.dropTable("customers").ifExists().execute();

  await sql`drop type if exists public.fulfilment_status`.execute(db);
  await sql`drop type if exists public.draw_direction`.execute(db);
  await sql`drop type if exists public.room_type`.execute(db);
  await sql`drop type if exists public.property_type`.execute(db);
}
