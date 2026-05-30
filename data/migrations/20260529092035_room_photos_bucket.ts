import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'room-photos', 'room-photos', false,
      ${10 * 1024 * 1024},
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from storage.buckets where id = 'room-photos'`.execute(db);
}
