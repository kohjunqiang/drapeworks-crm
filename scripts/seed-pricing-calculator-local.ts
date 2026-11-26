/** Synthetic calculator fixtures only. Explicitly run against the existing local
 * QA database; never imported by the app and excluded from the application image.
 * Existing settings, profiles and tester edits are preserved. */
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../src/lib/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Pass the isolated local DATABASE_URL explicitly");
const target = new URL(connectionString);
if (!['postgresql:', 'postgres:'].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-test destination");
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: false, max: 1 }) }) });
const id = (n: number) => `ca1c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function seed() {
  await db.transaction().execute(async (trx) => {
    // Names keep the tier prefixes required by the existing package resolver.
    const series = [
      { id: id(1), name: "Essential (Calculator QA)", cost_rmb_cents: 2500, sale_sgd_cents: 6000, product_line: "curtain" as const },
      { id: id(2), name: "Performance (Calculator QA)", cost_rmb_cents: 4500, sale_sgd_cents: 12000, product_line: "curtain" as const },
      { id: id(3), name: "Roller (Calculator QA)", cost_rmb_cents: 5000, sale_sgd_cents: 15000, product_line: "blind" as const },
      { id: id(4), name: "Missing cost (Calculator QA)", cost_rmb_cents: null, sale_sgd_cents: 10000, product_line: "curtain" as const },
      { id: id(5), name: "Unpriced (Calculator QA)", cost_rmb_cents: 2000, sale_sgd_cents: null, product_line: "curtain" as const },
    ];
    for (const row of series) await trx.insertInto("curtain_series").values({ ...row, is_active: true }).onConflict((oc) => oc.column("id").doNothing()).execute();
    const types = [
      { id: id(11), series_id: id(1), label: "Calculator QA essential day", category: "Day" as const },
      { id: id(12), series_id: id(1), label: "Calculator QA essential night", category: "Night" as const },
      { id: id(13), series_id: id(2), label: "Calculator QA performance night", category: "Night" as const },
      { id: id(14), series_id: id(3), label: "Calculator QA roller", category: null },
      { id: id(15), series_id: id(4), label: "Calculator QA missing cost", category: "Night" as const },
      { id: id(16), series_id: id(5), label: "Calculator QA unpriced", category: "Night" as const },
    ];
    for (const row of types) await trx.insertInto("curtain_types").values({ ...row, status: "Active" }).onConflict((oc) => oc.column("id").doNothing()).execute();
    await trx.insertInto("pricing_property_tiers").values({ id: id(20), code: "calculator_qa", label: "Calculator QA 3 rooms", position: 99, room_set_count: 3, is_active: true }).onConflict((oc) => oc.column("id").doNothing()).execute();
    await trx.insertInto("curtain_packages").values({ id: id(21), name: "Calculator QA double package", property_tier_id: id(20), package_type: "double", price_sgd_cents: 180000, tier2_upgrade_sgd_cents: 30000, room_tier2_upgrade_sgd_cents: 10000, room_tier2_downgrade_sgd_cents: 10000, is_active: true }).onConflict((oc) => oc.column("id").doNothing()).execute();
    // Existing real rule keys are seeded by migrations. Do not replace them or
    // change global rates; add one isolated automatic-width test charge.
    await trx.insertInto("pricing_addons").values({ id: id(30), key: "calculator_qa_width", label: "Calculator QA wide-blind handling", cost_rmb_cents: 1000, sale_sgd_cents: 2000, basis: "per_unit", applies_to: "blind", auto_rule: "width_over", auto_width_over_cm: 200, is_active: true }).onConflict((oc) => oc.column("id").doNothing()).execute();
  });
  console.log("Calculator QA catalogue/package seeded. Existing settings and tester edits preserved. Open /pricing-calculator on the isolated local app.");
}
seed().finally(() => db.destroy()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; });
