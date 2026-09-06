import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.zoho_connection_status as enum ('pending_organization','connected','partial','reconnect_required','disconnecting','disconnected','error')`.execute(db);

  await db.schema.createTable("zoho_connections")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("environment", "text", (column) => column.notNull())
    .addColumn("status", sql`public.zoho_connection_status`, (column) => column.notNull())
    .addColumn("accounts_server", "text", (column) => column.notNull())
    .addColumn("api_domain", "text", (column) => column.notNull())
    .addColumn("organization_id", "text")
    .addColumn("organization_name", "text")
    .addColumn("currency_code", "text")
    .addColumn("country_code", "text")
    .addColumn("candidate_organizations", "jsonb", (column) => column.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("requested_scopes", sql`text[]`, (column) => column.notNull())
    .addColumn("verified_capabilities", "jsonb", (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("refresh_token_ciphertext", "text")
    .addColumn("refresh_token_nonce", "text")
    .addColumn("refresh_token_tag", "text")
    .addColumn("access_token_ciphertext", "text")
    .addColumn("access_token_nonce", "text")
    .addColumn("access_token_tag", "text")
    .addColumn("access_token_expires_at", "timestamptz")
    .addColumn("key_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("token_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("connected_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("restrict"))
    .addColumn("connected_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("last_verified_at", "timestamptz")
    .addColumn("last_error", "text")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("zoho_connections_environment_unique", ["environment"])
    .addCheckConstraint("zoho_connections_org_complete", sql`status not in ('connected','partial') or (organization_id is not null and organization_name is not null and currency_code is not null)`)
    .addCheckConstraint("zoho_connections_tokens_complete", sql`status = 'disconnected' or (refresh_token_ciphertext is not null and refresh_token_nonce is not null and refresh_token_tag is not null and access_token_ciphertext is not null and access_token_nonce is not null and access_token_tag is not null and access_token_expires_at is not null)`)
    .execute();

  await db.schema.createTable("zoho_oauth_states")
    .addColumn("state_hash", "text", (column) => column.primaryKey())
    .addColumn("environment", "text", (column) => column.notNull())
    .addColumn("accounts_server", "text", (column) => column.notNull())
    .addColumn("initiated_by", "uuid", (column) => column.notNull().references("profiles.id").onDelete("cascade"))
    .addColumn("return_path", "text", (column) => column.notNull())
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("used_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("zoho_oauth_states_expiry_idx").on("zoho_oauth_states").column("expires_at").execute();

  await db.schema.createTable("zoho_connection_events")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("environment", "text", (column) => column.notNull())
    .addColumn("event_type", "text", (column) => column.notNull())
    .addColumn("actor_id", "uuid", (column) => column.references("profiles.id").onDelete("set null"))
    .addColumn("details", "jsonb", (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("zoho_connection_events_env_created_idx").on("zoho_connection_events").columns(["environment", "created_at"]).execute();

  await sql`create trigger zoho_connections_set_updated_at before update on public.zoho_connections for each row execute function public.set_updated_at()`.execute(db);
  for (const table of ["zoho_connections", "zoho_oauth_states", "zoho_connection_events"] as const) {
    await sql`alter table ${sql.table(`public.${table}`)} enable row level security`.execute(db);
    await sql`revoke all on ${sql.table(`public.${table}`)} from anon, authenticated`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const connections = await sql<{ count: string }>`select count(refresh_token_ciphertext) as count from public.zoho_connections`.execute(db);
  if (Number(connections.rows[0]?.count) > 0) throw new Error("Refusing rollback while Zoho OAuth credentials exist; disconnect and revoke them first");
  await db.schema.dropTable("zoho_connection_events").execute();
  await db.schema.dropTable("zoho_oauth_states").execute();
  await db.schema.dropTable("zoho_connections").execute();
  await sql`drop type public.zoho_connection_status`.execute(db);
}
