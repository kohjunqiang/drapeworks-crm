import { promises as fs } from "node:fs";
import * as path from "node:path";

import "dotenv/config";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator, FileMigrationProvider } from "kysely/migration";
import { Pool } from "pg";

async function main() {
  const direction = process.argv[2] ?? "up";
  if (direction !== "up" && direction !== "down" && direction !== "latest") {
    console.error(`Unknown direction "${direction}". Use one of: latest, up, down.`);
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Add it to .env.");
    process.exit(1);
  }

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: false } }),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(process.cwd(), "data", "migrations"),
    }),
  });

  const { error, results } =
    direction === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();

  for (const it of results ?? []) {
    if (it.status === "Success") {
      console.log(`✓ ${it.direction === "Up" ? "applied" : "reverted"} ${it.migrationName}`);
    } else if (it.status === "Error") {
      console.error(`✗ failed   ${it.migrationName}`);
    } else {
      console.log(`-  skipped ${it.migrationName}`);
    }
  }

  if (error) {
    console.error("Migration failed:", error);
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
