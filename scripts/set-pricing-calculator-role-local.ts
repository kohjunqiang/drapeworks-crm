/** Explicit local-only role fixture for calculator access QA.
 *
 * DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
 *   node --import tsx scripts/set-pricing-calculator-role-local.ts consultant
 * Repeat with ops; finish with restore. The first switch records the original
 * role in a local temp file, so restore does not assume the tester was admin.
 * Never imported by the app or included in its production image.
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

const TARGET_ID = "00000000-0000-4000-8000-000000000099";
const STATE_PATH = join(tmpdir(), "drapeworks-pricing-calculator-role-000000000099.json");
const ROLES = ["consultant", "ops", "admin"] as const;
type Role = typeof ROLES[number];
const isRole = (value: unknown): value is Role => typeof value === "string" && ROLES.includes(value as Role);
const command = process.argv[2];
if (!isRole(command) && command !== "restore") throw new Error("Choose consultant, ops, admin, or restore");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Pass the isolated local DATABASE_URL explicitly");
const target = new URL(connectionString);
if (!["postgresql:", "postgres:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-test destination");
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: false, max: 1 }) }) });

type SavedState = { profileId: string; database: string; role: Role; isPresalesOwner: boolean };
async function readState(): Promise<SavedState | null> {
  let text: string;
  try { text = await readFile(STATE_PATH, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("profileId" in value) || value.profileId !== TARGET_ID || !("database" in value) || value.database !== target.pathname || !("role" in value) || !isRole(value.role) || !("isPresalesOwner" in value) || typeof value.isPresalesOwner !== "boolean") throw new Error("Invalid saved role state; refusing to modify the profile");
  return value as SavedState;
}
async function main() {
  const saved = await readState();
  if (command === "restore" && !saved) throw new Error("No recorded role to restore; no changes made");
  await db.transaction().execute(async (trx) => {
    const current = await sql<{ role: Role; is_presales_owner: boolean; email: string }>`select role, is_presales_owner, email from public.profiles where id = ${TARGET_ID}::uuid for update`.execute(trx);
    if (current.rows.length !== 1 || !current.rows[0].email.endsWith("@example.test")) throw new Error("Expected synthetic fixture profile is missing; refusing change");
    const row = current.rows[0];
    if (!row.is_presales_owner) throw new Error("Synthetic fixture is not the selected local bypass profile");
    if (!saved) {
      const snapshot: SavedState = { profileId: TARGET_ID, database: target.pathname, role: row.role, isPresalesOwner: row.is_presales_owner };
      // Exclusive creation avoids overwriting a prior QA session's restore point.
      await writeFile(STATE_PATH, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
    }
    const nextRole = command === "restore" ? saved!.role : command;
    // Local owner is not postgres/service_role. Disable only this table trigger
    // within this transaction; rollback restores it if any subsequent step fails.
    await sql`alter table public.profiles disable trigger profiles_guard_role_update`.execute(trx);
    const changed = await sql`update public.profiles set role = ${nextRole}::public.user_role where id = ${TARGET_ID}::uuid`.execute(trx);
    if (changed.numAffectedRows !== BigInt(1)) throw new Error("Expected exactly one synthetic profile update");
    await sql`alter table public.profiles enable trigger profiles_guard_role_update`.execute(trx);
  });
  if (command === "restore") await unlink(STATE_PATH);
  console.log(command === "restore" ? `Synthetic QA profile restored to ${saved!.role}.` : `Synthetic QA profile now ${command}. Run this tool with restore after QA.`);
}
main().finally(() => db.destroy()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Local role switch failed"); process.exitCode = 1; });
