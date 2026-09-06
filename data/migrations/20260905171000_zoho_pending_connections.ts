import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable("zoho_pending_connections")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("environment", "text", (column) => column.notNull().unique())
    .addColumn("accounts_server", "text", (column) => column.notNull())
    .addColumn("api_domain", "text", (column) => column.notNull())
    .addColumn("candidate_organizations", "jsonb", (column) => column.notNull())
    .addColumn("requested_scopes", sql`text[]`, (column) => column.notNull())
    .addColumn("refresh_token_ciphertext", "text", (column) => column.notNull())
    .addColumn("refresh_token_nonce", "text", (column) => column.notNull())
    .addColumn("refresh_token_tag", "text", (column) => column.notNull())
    .addColumn("access_token_ciphertext", "text", (column) => column.notNull())
    .addColumn("access_token_nonce", "text", (column) => column.notNull())
    .addColumn("access_token_tag", "text", (column) => column.notNull())
    .addColumn("access_token_expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("initiated_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("cascade"))
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("zoho_pending_connections_expiry_idx").on("zoho_pending_connections").column("expires_at").execute();
  await sql`alter table public.zoho_pending_connections enable row level security`.execute(db);
  await sql`revoke all on public.zoho_pending_connections from anon, authenticated`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const pending = await sql<{ count: string }>`select count(*) as count from public.zoho_pending_connections`.execute(db);
  if (Number(pending.rows[0]?.count) > 0) throw new Error("Refusing rollback while pending Zoho OAuth grants exist; revoke them first");
  await db.schema.dropTable("zoho_pending_connections").execute();
}
