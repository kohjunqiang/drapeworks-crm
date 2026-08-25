// scripts/db-query.ts
//
// Throwaway query runner for the phase-15 import checks. Builds its own Kysely
// instance for the same reason data/migrate.ts does: @/lib/db/kysely is
// server-only and cannot be imported from a plain Node script.
//
// Usage: npx tsx scripts/db-query.ts "select count(*) from public.leads"

import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

async function main() {
  const statement = process.argv[2];
  if (!statement) throw new Error("Pass a SQL statement as the first argument");

  const db = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        ssl: { rejectUnauthorized: false },
      }),
    }),
  });

  const result = await sql.raw(statement).execute(db);
  console.table(result.rows);
  await db.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
