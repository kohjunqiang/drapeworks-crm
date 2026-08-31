import "dotenv/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator, FileMigrationProvider } from "kysely/migration";
import { Pool } from "pg";

async function main() {
  const target = "20260831120000_lead_import_baselines";
  const db = new Kysely<unknown>({dialect:new PostgresDialect({pool:new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:{rejectUnauthorized:false}})})});
  try {
    const migrator = new Migrator({db,provider:new FileMigrationProvider({fs,path,migrationFolder:path.join(process.cwd(),"data/migrations")})});
    const migrations = await migrator.getMigrations();
    if (migrations.find(m=>m.name===target)?.executedAt) { console.log("Lead baseline migration already applied"); return; }
    const pending = migrations.filter(m=>!m.executedAt && m.name <= target);
    if (pending.length!==1 || pending[0].name!==target) throw new Error("Refusing to apply unrelated pending migrations");
    const result = await migrator.migrateTo(target);
    if (result.error) throw result.error;
    console.log(result.results);
  } finally { await db.destroy(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
