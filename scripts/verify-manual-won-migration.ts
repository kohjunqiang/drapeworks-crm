import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { down, up } from "../data/migrations/20261127130000_allow_manual_won";

// Local-only verification for data/migrations/20261127130000_allow_manual_won.ts.
// Everything runs inside one transaction that is always rolled back: fixture
// rows, trigger drops and trigger recreations never persist.
//
//   DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
//     npx tsx scripts/verify-manual-won-migration.ts
//
// Covers: up() drops only the two deposit-prerequisite triggers, manual Won
// persists pre-deposit (unlinked and linked) with derived status, down()
// refuses rollback while a violating Won row exists, down() restores the
// latest function bodies and both constraint triggers, and the restored
// guards still enforce the deposited-order invariant that the app's
// order -> lead milestone sync in src/lib/actions/status.ts relies on.

const GUARD_TRIGGERS = ["leads_require_recorded_deposit", "orders_preserve_won_deposit"] as const;
const GUARD_FUNCTIONS = ["leads_require_recorded_deposit()", "orders_preserve_won_deposit()"] as const;

const guardTriggers = async (db: Kysely<unknown>) => (await sql<{ tgname: string }>`
    select t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('leads', 'orders')
       and not t.tgisinternal
       and t.tgname in ('leads_require_recorded_deposit', 'orders_preserve_won_deposit')
  `.execute(db)).rows.map(row => row.tgname);

const tableTriggers = async (db: Kysely<unknown>) => (await sql<{ tgname: string }>`
    select t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('leads', 'orders')
       and not t.tgisinternal
  `.execute(db)).rows.map(row => row.tgname);

const violatingWonLeads = async (db: Kysely<unknown>) => (await sql<{ id: string; lead_ref: string; name: string }>`
    select l.id, l.lead_ref, l.name
      from public.leads l
     where l.funnel_stage = 'Won'
       and not exists (
         select 1 from public.orders o
          where o.lead_id = l.id
            and o.current_status::text in (
              'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
              'shipping_sg', 'delivered_checked', 'fulfilment',
              'installation_completed', 'completed'
            )
       )
  `.execute(db)).rows;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/drapeworks_priority_local") {
    throw new Error("Refusing non-disposable database — expected postgresql://127.0.0.1:55439/drapeworks_priority_local");
  }
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: false, max: 1 }) }) });
  const checks: string[] = [];
  const pass = (message: string) => { checks.push(message); console.log(`  ✓ ${message}`); };

  await sql`begin`.execute(db);
  try {
    const owner = (await sql<{ id: string }>`select id from public.profiles limit 1`.execute(db)).rows[0];
    check(owner, "no profile exists to own the fixture rows");

    const preexistingViolations = await violatingWonLeads(db);
    if (preexistingViolations.length) {
      console.log(`  ! ${preexistingViolations.length} Won lead(s) already lack a deposited order: ${preexistingViolations.map(row => row.lead_ref).join(", ")}`);
    }

    // Normalise the baseline: if the migration is already applied locally,
    // reinstall the guards so the same assertions always run.
    if ((await guardTriggers(db)).length === 0) {
      await down(db);
      pass("down() re-installed both guards on an already-migrated database");
    }
    check((await guardTriggers(db)).length === 2, "expected both deposit guards present before verification");

    // up(): drops only the two prerequisite triggers — every other trigger on
    // leads/orders (status derivation, locks, syncs) must remain.
    const triggersBefore = await tableTriggers(db);
    await up(db);
    const triggersAfter = await tableTriggers(db);
    const dropped = triggersBefore.filter(name => !triggersAfter.includes(name));
    check((await guardTriggers(db)).length === 0, "up() should drop both deposit guards");
    check(dropped.sort().join(",") === GUARD_TRIGGERS.slice().sort().join(","), `up() should drop exactly the two guards, dropped: ${dropped.join(",")}`);
    pass("up() drops leads_require_recorded_deposit and orders_preserve_won_deposit only");

    // Manual Won now persists without a linked order and still derives status.
    const manualLeadId = randomUUID();
    await sql`
      insert into public.leads (id, lead_ref, name, contact_channel, owner_id, lead_status, funnel_stage, first_initiated_at)
      values (${manualLeadId}::uuid, 'VERIFY-MANUAL-WON', 'Manual Won verification', 'Other', ${owner.id}::uuid, 'Active', 'Won', now())
    `.execute(db);
    await sql`set constraints all immediate`.execute(db);
    const derived = (await sql<{ lead_status: string }>`select lead_status from public.leads where id = ${manualLeadId}::uuid`.execute(db)).rows[0]?.lead_status;
    check(derived === "Closed – Won", `manual Won should derive 'Closed – Won', got '${derived}'`);
    pass("manual Won persists unlinked pre-deposit and derives lead_status 'Closed – Won'");

    // A manual Won against a linked PRE-deposit order also persists, and the
    // lead update must leave the order itself — link, status and payment
    // fields — completely untouched.
    const preCustomerId = randomUUID();
    const preOrderId = randomUUID();
    const preLeadId = randomUUID();
    await sql`insert into public.customers (id, name, mobile, created_by) values (${preCustomerId}::uuid, 'Manual Won verification', '90000000', ${owner.id}::uuid)`.execute(db);
    await sql`
      insert into public.leads (id, customer_id, lead_ref, name, contact_channel, owner_id, lead_status, funnel_stage, first_initiated_at)
      values (${preLeadId}::uuid, ${preCustomerId}::uuid, 'VERIFY-PREDEPOSIT-WON', 'Predeposit Won verification', 'Other', ${owner.id}::uuid, 'Active', 'Decision Pending', now())
    `.execute(db);
    await sql`
      insert into public.orders (id, customer_id, consultant_id, lead_id, seq_year, seq_num, display_id, property_type, development, site_address, unit_type, price_quoted_cents, deposit_cents, freight_mode, channel, extra_install_sgd_cents, discount_bps, is_draft, product_line)
      values (${preOrderId}::uuid, ${preCustomerId}::uuid, ${owner.id}::uuid, ${preLeadId}::uuid, 2026, ${Math.floor(Math.random() * 900000000) + 100000000}, '', 'HDB', 'Synthetic', '1 Test Way', '4-room', 473000, 236500, 'air', 'standard', 0, 0, false, 'curtain')
    `.execute(db);
    await sql`insert into public.order_status_events (order_id, status, note, created_by) values (${preOrderId}::uuid, 'order_recorded', 'Manual Won verification', ${owner.id}::uuid)`.execute(db);
    const orderBefore = await sql<Record<string, unknown>>`select current_status::text, lead_id, deposit_cents, price_quoted_cents from public.orders where id = ${preOrderId}::uuid`.execute(db);
    await sql`update public.leads set funnel_stage = 'Won' where id = ${preLeadId}::uuid`.execute(db);
    await sql`set constraints all immediate`.execute(db);
    const orderAfter = await sql<Record<string, unknown>>`select current_status::text, lead_id, deposit_cents, price_quoted_cents from public.orders where id = ${preOrderId}::uuid`.execute(db);
    check(JSON.stringify(orderAfter.rows[0]) === JSON.stringify(orderBefore.rows[0]), "manual Won must not change the linked order's status, payment or link fields");
    pass("manual Won against a linked pre-deposit order persists and leaves the order row untouched");

    // Restore the fixture stage so the down() refusal below is driven only by
    // the unlinked manual Won row.
    await sql`update public.leads set funnel_stage = 'Decision Pending' where id = ${preLeadId}::uuid`.execute(db);

    // down() must refuse while a violating Won row exists.
    await sql`savepoint sp_refuse`.execute(db);
    let refused = "";
    try { await down(db); } catch (error) { refused = error instanceof Error ? error.message : String(error); }
    await sql`rollback to savepoint sp_refuse`.execute(db);
    check(refused.includes("linked order with a recorded deposit"), `down() should refuse with the deposit message, got: ${refused}`);
    pass("down() refuses rollback while a manual Won row violates the old invariant");

    await sql`delete from public.leads where id = ${manualLeadId}::uuid`.execute(db);

    if (preexistingViolations.length) {
      console.log("  ! down() success path skipped — pre-existing violating Won leads remain; reconcile them before a real rollback");
    } else {
      await down(db);
      check((await guardTriggers(db)).length === 2, "down() should recreate both deposit guards");
      for (const fn of GUARD_FUNCTIONS) {
        const body = (await sql<{ def: string }>`select pg_get_functiondef(${`public.${fn}`}::regprocedure) as def`.execute(db)).rows[0]?.def ?? "";
        check(body.includes("installation_completed"), `down() must restore the latest ${fn} body counting installation_completed as deposited`);
      }
      pass("down() restores both constraint triggers and the latest function bodies (installation_completed counts as deposited)");

      // The recreated leads guard enforces again at commit-time checks.
      await sql`savepoint sp_enforce`.execute(db);
      let enforced = "";
      try {
        await sql`
          insert into public.leads (id, lead_ref, name, contact_channel, owner_id, lead_status, funnel_stage, first_initiated_at)
          values (${randomUUID()}::uuid, 'VERIFY-ENFORCED-WON', 'Enforced Won verification', 'Other', ${owner.id}::uuid, 'Active', 'Won', now())
        `.execute(db);
        await sql`set constraints all immediate`.execute(db);
      } catch (error) { enforced = error instanceof Error ? error.message : String(error); }
      await sql`rollback to savepoint sp_enforce`.execute(db);
      check(enforced.includes("Record the deposit"), `restored leads guard should reject Won without a deposit, got: ${enforced}`);
      pass("restored leads guard rejects a Won lead without a recorded deposit");

      // The deposited-order invariant the app's order -> lead milestone sync
      // relies on: a lead linked to a deposited order may be set Won, and the
      // linked deposit cannot vanish. (The sync itself is app code in
      // src/lib/actions/status.ts; this only exercises the restored guards.)
      const customerId = randomUUID();
      const orderId = randomUUID();
      const wonLeadId = randomUUID();
      await sql`insert into public.customers (id, name, mobile, created_by) values (${customerId}::uuid, 'Manual Won verification', '90000000', ${owner.id}::uuid)`.execute(db);
      await sql`
        insert into public.leads (id, customer_id, lead_ref, name, contact_channel, owner_id, lead_status, funnel_stage, first_initiated_at)
        values (${wonLeadId}::uuid, ${customerId}::uuid, 'VERIFY-LINKED-WON', 'Linked Won verification', 'Other', ${owner.id}::uuid, 'Active', 'Decision Pending', now())
      `.execute(db);
      await sql`
        insert into public.orders (id, customer_id, consultant_id, lead_id, seq_year, seq_num, display_id, property_type, development, site_address, unit_type, price_quoted_cents, deposit_cents, freight_mode, channel, extra_install_sgd_cents, discount_bps, is_draft, product_line)
        values (${orderId}::uuid, ${customerId}::uuid, ${owner.id}::uuid, ${wonLeadId}::uuid, 2026, ${Math.floor(Math.random() * 900000000) + 100000000}, '', 'HDB', 'Synthetic', '1 Test Way', '4-room', 473000, 236500, 'air', 'standard', 0, 0, false, 'curtain')
      `.execute(db);
      for (const status of ["order_recorded", "quotation_sent", "deposit_received"]) {
        await sql`insert into public.order_status_events (order_id, status, note, created_by) values (${orderId}::uuid, ${status}, 'Manual Won verification', ${owner.id}::uuid)`.execute(db);
      }
      await sql`update public.leads set funnel_stage = 'Won' where id = ${wonLeadId}::uuid`.execute(db);
      await sql`set constraints all immediate`.execute(db);
      pass("restored guards accept a Won lead whose linked order has a recorded deposit");

      await sql`savepoint sp_preserve`.execute(db);
      let preserved = "";
      try {
        // Remove the ledger first so the order delete reaches the deferred
        // guard instead of failing on the status-event foreign key.
        await sql`delete from public.order_status_events where order_id = ${orderId}::uuid`.execute(db);
        await sql`delete from public.orders where id = ${orderId}::uuid`.execute(db);
        await sql`set constraints all immediate`.execute(db);
      } catch (error) { preserved = error instanceof Error ? error.message : String(error); }
      await sql`rollback to savepoint sp_preserve`.execute(db);
      check(preserved.includes("must retain an order with a recorded deposit"), `restored orders guard should preserve the deposit, got: ${preserved}`);
      pass("restored orders guard refuses to leave a Won lead without a deposited order");
    }

    console.log(`\nAll ${checks.length} manual-Won migration checks passed; rolling back the verification transaction.`);
  } finally {
    await sql`rollback`.execute(db);
    await db.destroy();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
