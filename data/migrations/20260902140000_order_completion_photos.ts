import { sql, type Kysely } from "kysely";

const BUCKET = "completion-photos";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("order_completion_photos")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (column) =>
      column.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("storage_path", "text", (column) => column.notNull().unique())
    .addColumn("mime_type", "text", (column) => column.notNull())
    .addColumn("size_bytes", "integer", (column) => column.notNull())
    .addColumn("original_name", "text")
    .addColumn("uploaded_by", "uuid", (column) =>
      column.references("profiles.id").onDelete("set null"),
    )
    .addColumn("position", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("order_completion_photos_order_idx")
    .on("order_completion_photos")
    .columns(["order_id", "position", "created_at"])
    .execute();

  await sql`alter table public.order_completion_photos enable row level security`.execute(db);
  await sql`
    create policy "order_completion_photos_select_authenticated"
      on public.order_completion_photos for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "order_completion_photos_write_ops_admin"
      on public.order_completion_photos for all to authenticated
      using (public.is_ops() or public.is_admin())
      with check (public.is_ops() or public.is_admin())
  `.execute(db);

  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      ${BUCKET}, ${BUCKET}, false,
      ${10 * 1024 * 1024},
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);

  const bucket = sql.raw(`'${BUCKET}'`);
  await sql`
    create policy "completion_photos_storage_select_authenticated"
      on storage.objects for select to authenticated
      using (bucket_id = ${bucket})
  `.execute(db);
  await sql`
    create policy "completion_photos_storage_insert_ops_admin"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = ${bucket}
        and (public.is_ops() or public.is_admin())
      )
  `.execute(db);
  await sql`
    create policy "completion_photos_storage_delete_ops_admin"
      on storage.objects for delete to authenticated
      using (
        bucket_id = ${bucket}
        and (public.is_ops() or public.is_admin())
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop policy if exists "completion_photos_storage_delete_ops_admin" on storage.objects`.execute(db);
  await sql`drop policy if exists "completion_photos_storage_insert_ops_admin" on storage.objects`.execute(db);
  await sql`drop policy if exists "completion_photos_storage_select_authenticated" on storage.objects`.execute(db);
  await sql`delete from storage.objects where bucket_id = ${BUCKET}`.execute(db);
  await sql`delete from storage.buckets where id = ${BUCKET}`.execute(db);
  await db.schema.dropTable("order_completion_photos").execute();
}
