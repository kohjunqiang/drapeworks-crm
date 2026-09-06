import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("zoho_pending_connections")
    .dropConstraint("zoho_pending_connections_environment_key")
    .execute();
  await db.schema.alterTable("zoho_pending_connections")
    .addColumn("status", "text", (column) => column.notNull().defaultTo("pending")).execute();
  await db.schema.alterTable("zoho_pending_connections").addColumn("claimed_at", "timestamptz").execute();
  await sql`alter table public.zoho_pending_connections add constraint zoho_pending_connections_status_check check (status in ('pending','claimed'))`.execute(db);
  await db.schema.createIndex("zoho_pending_connections_env_created_idx")
    .on("zoho_pending_connections").columns(["environment", "created_at"]).execute();

  await db.schema.alterTable("zoho_connections")
    .addColumn("estimate_crm_key_api_name", "text")
    .addColumn("estimate_crm_key_id", "text")
    .addColumn("estimate_template_id", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const pending = await sql<{ count: string }>`select count(*) as count from public.zoho_pending_connections`.execute(db);
  if (Number(pending.rows[0]?.count) > 0) throw new Error("Refusing rollback while pending Zoho OAuth grants exist; revoke them first");
  const connections = await sql<{ count: string }>`select count(refresh_token_ciphertext) as count from public.zoho_connections`.execute(db);
  if (Number(connections.rows[0]?.count) > 0) throw new Error("Refusing rollback while Zoho OAuth credentials exist; disconnect and revoke them first");
  await db.schema.alterTable("zoho_connections").dropColumn("estimate_template_id").execute();
  await db.schema.alterTable("zoho_connections").dropColumn("estimate_crm_key_id").execute();
  await db.schema.alterTable("zoho_connections").dropColumn("estimate_crm_key_api_name").execute();
  await db.schema.dropIndex("zoho_pending_connections_env_created_idx").execute();
  await db.schema.alterTable("zoho_pending_connections").dropConstraint("zoho_pending_connections_status_check").execute();
  await db.schema.alterTable("zoho_pending_connections").dropColumn("claimed_at").execute();
  await db.schema.alterTable("zoho_pending_connections").dropColumn("status").execute();
  await db.schema.alterTable("zoho_pending_connections").addUniqueConstraint("zoho_pending_connections_environment_key", ["environment"]).execute();
}
