import "server-only";

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DB } from "./schema";

declare global {
  var __kyselyPool: Pool | undefined;
  var __kyselyDb: Kysely<DB> | undefined;
}

// Pool is created on first query, not on module load. This matters during
// `next build` (page-data collection step) where DATABASE_URL isn't always
// available and we don't want to fail the build just because Next is
// importing the module to inspect it.
async function getPool(): Promise<Pool> {
  if (!global.__kyselyPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const configuredMax = Number.parseInt(
      process.env.DATABASE_POOL_MAX ?? "3",
      10,
    );
    const maxConnections =
      Number.isInteger(configuredMax) && configuredMax > 0
        ? configuredMax
        : 3;
    global.__kyselyPool = new Pool({
      connectionString,
      // Supabase session mode dedicates one backend connection to every pool
      // client. Keep this deliberately below its 15-session allowance so a
      // local dev server and the deployed app can coexist safely.
      max: maxConnections,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      application_name: "drapeworks-crm",
      ssl: /^postgres(?:ql)?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/)/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return global.__kyselyPool;
}

export const db: Kysely<DB> =
  global.__kyselyDb ??
  (global.__kyselyDb = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: getPool }),
  }));
