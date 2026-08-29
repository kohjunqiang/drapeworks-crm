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
    global.__kyselyPool = new Pool({
      connectionString,
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
