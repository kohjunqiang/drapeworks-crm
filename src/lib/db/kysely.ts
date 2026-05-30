import "server-only";

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DB } from "./schema";

declare global {
  var __kyselyPool: Pool | undefined;
  var __kyselyDb: Kysely<DB> | undefined;
}

function getPool(): Pool {
  if (!global.__kyselyPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    global.__kyselyPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return global.__kyselyPool;
}

export const db: Kysely<DB> =
  global.__kyselyDb ??
  (global.__kyselyDb = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: getPool() }),
  }));
