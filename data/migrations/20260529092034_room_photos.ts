import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("room_photos")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("room_id", "uuid", (col) =>
      col.notNull().references("rooms.id").onDelete("cascade"),
    )
    .addColumn("storage_path", "text", (col) => col.notNull().unique())
    .addColumn("mime_type", "text", (col) => col.notNull())
    .addColumn("size_bytes", "integer", (col) => col.notNull())
    .addColumn("original_name", "text")
    .addColumn("uploaded_by", "uuid")
    .addColumn("position", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("room_photos_room_idx")
    .on("room_photos")
    .columns(["room_id", "position", "created_at"])
    .execute();

  await sql`alter table public.room_photos enable row level security`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("room_photos").ifExists().execute();
}
